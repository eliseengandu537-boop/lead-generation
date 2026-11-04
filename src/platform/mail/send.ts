import { randomUUID } from "node:crypto";
import type { PlatformMailMessage } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { hash, sign } from "@/lib/security";
import { senderMatchesWebsite } from "./domain";
import { gmailToken, googleRawMessage } from "./google";
import { pauseUnsafeCampaign } from "./events";
import { withinSendingWindow } from "./schedule";
import { personalizeFollowup } from "./content";

export class MailDeferredError extends Error {
  constructor(
    message: string,
    public retryAt: Date,
  ) {
    super(message);
  }
}
const future = (milliseconds = 60000) => new Date(Date.now() + milliseconds);
export function unsubscribeLink(messageId: string, oneClick = false) {
  if (!process.env.NEXTAUTH_SECRET || !process.env.NEXTAUTH_URL)
    throw new Error("Unsubscribe signing and public URL are required");
  const url = new URL("/api/platform/unsubscribe", process.env.NEXTAUTH_URL);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("Live production outreach requires HTTPS");
  url.searchParams.set("messageId", messageId);
  url.searchParams.set(
    "token",
    sign(`platform-unsubscribe:${messageId}`, process.env.NEXTAUTH_SECRET),
  );
  if (oneClick) url.searchParams.set("oneClick", "1");
  return url.href;
}
export async function sendCampaignMessage(
  workspaceId: string,
  campaignId: string,
  leadId: string,
  step: number,
  key: string,
  request: typeof fetch = fetch,
) {
  z.string().min(1).max(200).parse(key);
  z.number().int().min(0).max(20).parse(step);
  if (process.env.LIVE_EMAIL_ENABLED !== "true")
    throw new Error("Real email delivery is disabled in server configuration");
  const campaign = await db.platformCampaign.findFirstOrThrow({
    where: { id: campaignId, workspaceId },
  });
  if (!campaign.mailboxId)
    throw new Error("Connect this campaign to an authorized business mailbox");
  const dedupeKey = `campaign:${campaignId}:lead:${leadId}:step:${step}`;
  const token = await gmailToken(workspaceId, campaign.mailboxId, request);
  const reservation = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const [current, lead, recipient, mailbox, organization, workspace] =
        await Promise.all([
          tx.platformCampaign.findFirstOrThrow({
            where: { id: campaignId, workspaceId },
          }),
          tx.platformLead.findFirstOrThrow({
            where: { id: leadId, workspaceId },
          }),
          tx.platformCampaignRecipient.findFirstOrThrow({
            where: { campaignId, leadId, workspaceId },
          }),
          tx.platformMailbox.findFirstOrThrow({
            where: { id: campaign.mailboxId!, workspaceId },
          }),
          tx.platformOrganization.findUniqueOrThrow({ where: { workspaceId } }),
          tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
        ]);
      const followups = z
        .array(
          z.object({
            subject: z.string().min(1),
            body: z.string().min(1),
            delayDays: z.number().nonnegative(),
          }),
        )
        .parse(current.steps);
      const selected = step === 0 ? recipient : followups[step - 1];
      if (!selected?.subject || !selected.body || !lead.email)
        throw new Error(
          "Approved email content and recipient address are required",
        );
      const subject =
        step === 0
          ? selected.subject
          : personalizeFollowup(selected.subject, lead);
      const text =
        step === 0 ? selected.body : personalizeFollowup(selected.body, lead);
      const digest = hash(
        JSON.stringify({
          campaignId,
          leadId,
          step,
          from: mailbox.email,
          to: lead.email.toLowerCase(),
          subject,
          body: text,
        }),
      );
      const existing = await tx.platformMailMessage.findUnique({
        where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
      });
      if (existing) {
        if (
          existing.contentHash !== digest ||
          existing.mailboxId !== mailbox.id
        )
          throw new Error(
            "Message key conflicts with immutable approved content",
          );
        if (existing.status === "ACCEPTED")
          return { message: existing, duplicate: true };
        throw new Error(
          "A prior send outcome requires reconciliation; automatic resend is blocked",
        );
      }
      if (
        workspace.status !== "ACTIVE" ||
        current.mailboxId !== mailbox.id ||
        mailbox.status !== "LIVE_ENABLED"
      )
        throw new Error(
          "Client account or authorized sending mailbox is not active",
        );
      if (
        current.status !== "RUNNING" ||
        !current.approvedBy ||
        !current.approvedAt ||
        !recipient.approvedBy ||
        !recipient.approvedAt ||
        recipient.status !== "QUEUED" ||
        recipient.step !== step
      )
        throw new Error(
          "Campaign and recipient email approval are required before delivery",
        );
      if (
        !organization.profileApprovedAt ||
        !senderMatchesWebsite(mailbox.email, [organization.websiteUrl])
      )
        throw new Error(
          "Approve the website business profile and connect its matching business email",
        );
      const minimumScore = z
        .object({ minimumScore: z.number().min(0).max(100).optional() })
        .passthrough()
        .safeParse(organization.qualificationCriteria);
      if (
        lead.qualificationScore === null ||
        lead.qualificationScore <
          (minimumScore.success ? (minimumScore.data.minimumScore ?? 70) : 70)
      )
        throw new Error(
          "Lead does not meet this campaign's qualification threshold",
        );
      const suppression = await tx.platformMailSuppression.findUnique({
        where: {
          workspaceId_email: { workspaceId, email: lead.email.toLowerCase() },
        },
      });
      if (
        suppression ||
        lead.repliedAt ||
        lead.unsubscribedAt ||
        lead.eligibility !== "CONSENTED" ||
        !lead.consentSource ||
        !lead.consentAt ||
        lead.consentAt > new Date()
      )
        throw new Error(
          "Recipient is suppressed, has replied, or lacks recorded marketing permission",
        );
      if (
        lead.verificationStatus !== "VALID" ||
        !lead.verifiedAt ||
        lead.verifiedAt < new Date(Date.now() - 30 * 86400000)
      )
        throw new Error(
          "Live outreach requires a recently verified recipient address",
        );
      if (
        await pauseUnsafeCampaign(tx, workspaceId, campaignId).then(
          (result) => result.paused,
        )
      )
        return { deferred: "Campaign paused by email safety policy" };
      if (
        !mailbox.lastSyncedAt ||
        mailbox.lastSyncedAt < new Date(Date.now() - 60000)
      )
        throw new MailDeferredError(
          "Mailbox feedback must be synchronized before sending",
          future(),
        );
      if (current.scheduledAt && current.scheduledAt > new Date())
        throw new MailDeferredError(
          "Campaign is scheduled for later",
          current.scheduledAt,
        );
      if (recipient.nextAt > new Date())
        throw new MailDeferredError(
          "Recipient follow-up is scheduled for later",
          recipient.nextAt,
        );
      if (!withinSendingWindow(new Date(), workspace.timezone, current))
        throw new MailDeferredError(
          "Outside the client's sending schedule",
          future(15 * 60000),
        );
      if (
        mailbox.lastSentAt &&
        mailbox.lastSentAt.getTime() + mailbox.minimumIntervalSeconds * 1000 >
          Date.now()
      )
        throw new MailDeferredError(
          "Sender rate limit reached",
          new Date(
            mailbox.lastSentAt.getTime() +
              mailbox.minimumIntervalSeconds * 1000,
          ),
        );
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const [mailboxCount, campaignCount, tenantCount, subscription] =
        await Promise.all([
          tx.platformMailMessage.count({
            where: {
              workspaceId,
              mailboxId: mailbox.id,
              direction: "OUTBOUND",
              status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
              createdAt: { gte: since },
            },
          }),
          tx.platformMailMessage.count({
            where: {
              workspaceId,
              campaignId,
              direction: "OUTBOUND",
              status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
              createdAt: { gte: since },
            },
          }),
          tx.platformMailMessage.count({
            where: {
              workspaceId,
              direction: "OUTBOUND",
              status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
              createdAt: { gte: since },
            },
          }),
          tx.platformSubscription.findUnique({
            where: { workspaceId },
            include: { plan: true },
          }),
        ]);
      if (
        !subscription ||
        !["ACTIVE", "TRIAL"].includes(subscription.status) ||
        (subscription.periodEnd && subscription.periodEnd < new Date())
      )
        throw new Error(
          "An active subscription allowance is required for outreach",
        );
      if (
        mailboxCount >= mailbox.dailyLimit ||
        campaignCount >= current.dailyLimit ||
        tenantCount >= subscription.plan.dailyEmails
      )
        throw new MailDeferredError(
          "Daily sending allowance reached",
          new Date(since.getTime() + 86400000),
        );
      const id = randomUUID(),
        unsubscribeUrl = unsubscribeLink(id);
      const body = `${text}\n\n${workspace.name}\n${organization.websiteUrl}\nUnsubscribe: ${unsubscribeUrl}`;
      const message = await tx.platformMailMessage.create({
        data: {
          id,
          workspaceId,
          mailboxId: mailbox.id,
          leadId,
          campaignId,
          direction: "OUTBOUND",
          status: "SENDING",
          step,
          toEmail: lead.email.toLowerCase(),
          fromEmail: mailbox.email,
          subject,
          body,
          dedupeKey,
          contentHash: digest,
          rfcMessageId: `<${hash(`${workspaceId}:${dedupeKey}`)}@${mailbox.email.split("@")[1]}>`,
          approvedBy: recipient.approvedBy,
          approvedAt: recipient.approvedAt,
        },
      });
      await tx.platformMailbox.update({
        where: { id: mailbox.id },
        data: { lastSentAt: new Date() },
      });
      return { message, duplicate: false };
    },
    { timeout: 15000 },
  );
  if ("deferred" in reservation)
    throw new MailDeferredError(reservation.deferred!, future());
  if (reservation.duplicate)
    return {
      messageId: reservation.message.id,
      status: "ACCEPTED" as const,
      duplicate: true,
    };
  return deliverReservedMessage(reservation.message, token, request);
}

async function deliverReservedMessage(
  message: PlatformMailMessage,
  token: string,
  request: typeof fetch,
) {
  try {
    const original = message.replyToMessageId
      ? await db.platformMailMessage.findFirst({
          where: {
            workspaceId: message.workspaceId,
            id: message.replyToMessageId,
          },
        })
      : null;
    const raw = googleRawMessage({
      from: message.fromEmail,
      to: message.toEmail,
      subject: message.subject,
      body: message.body,
      rfcMessageId: message.rfcMessageId,
      ...(!message.replyToMessageId
        ? {
            unsubscribeUrl: unsubscribeLink(message.id),
            oneClickUrl: unsubscribeLink(message.id, true),
          }
        : {}),
      ...(original
        ? { inReplyTo: original.originalRfcMessageId || original.rfcMessageId }
        : {}),
    });
    const response = await request(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw,
          ...(original?.providerThreadId
            ? { threadId: original.providerThreadId }
            : {}),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error(`Gmail send returned HTTP ${response.status}`);
    const sent = z
      .object({ id: z.string().min(1), threadId: z.string().min(1) })
      .parse(await response.json());
    await db.$transaction(async (tx) => {
      await tx.platformMailMessage.update({
        where: { id: message.id },
        data: {
          status: "ACCEPTED",
          providerMessageId: sent.id,
          providerThreadId: sent.threadId,
          error: null,
        },
      });
      await tx.platformMailEvent.create({
        data: {
          workspaceId: message.workspaceId,
          mailboxId: message.mailboxId,
          messageId: message.id,
          externalId: `accepted:${message.id}`,
          kind: "SENT_ACCEPTED",
        },
      });
      await tx.platformUsage.create({
        data: {
          workspaceId: message.workspaceId,
          operationKey: `mail:${message.id}`,
          kind: "EMAIL",
          quantity: 1,
        },
      });
      if (message.leadId)
        await tx.platformLead.updateMany({
          where: {
            workspaceId: message.workspaceId,
            id: message.leadId,
            repliedAt: null,
            unsubscribedAt: null,
          },
          data: { status: "CONTACTED" },
        });
    });
    return {
      messageId: message.id,
      status: "ACCEPTED" as const,
      duplicate: false,
    };
  } catch {
    await db.platformMailMessage.updateMany({
      where: {
        workspaceId: message.workspaceId,
        id: message.id,
        status: "SENDING",
      },
      data: {
        status: "REVIEW_REQUIRED",
        error:
          "Send outcome is uncertain or rejected; reconcile with Gmail. Automatic resend is blocked.",
      },
    });
    throw new Error(
      "Gmail send requires reconciliation; automatic resend is blocked",
    );
  }
}

export async function reconcileMessage(
  workspaceId: string,
  mailboxId: string,
  messageId: string,
  request: typeof fetch = fetch,
) {
  const message = await db.platformMailMessage.findFirstOrThrow({
    where: {
      id: messageId,
      workspaceId,
      mailboxId,
      status: { in: ["SENDING", "REVIEW_REQUIRED"] },
    },
  });
  const token = await gmailToken(workspaceId, mailboxId, request);
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set(
    "q",
    `in:sent rfc822msgid:${message.rfcMessageId.slice(1, -1)}`,
  );
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Gmail reconciliation failed");
  const sent = z
    .object({
      messages: z
        .array(z.object({ id: z.string(), threadId: z.string() }))
        .optional(),
    })
    .parse(await response.json());
  if (sent.messages?.length !== 1)
    return {
      reconciled: false,
      message:
        "No unique sent message found; this does not prove non-delivery. Resend remains blocked.",
    };
  await db.$transaction(async (tx) => {
    await tx.platformMailMessage.update({
      where: { id: message.id },
      data: {
        status: "ACCEPTED",
        providerMessageId: sent.messages![0].id,
        providerThreadId: sent.messages![0].threadId,
        error: null,
      },
    });
    await tx.platformMailEvent.createMany({
      skipDuplicates: true,
      data: [
        {
          workspaceId,
          mailboxId,
          messageId,
          externalId: `accepted:${messageId}`,
          kind: "SENT_ACCEPTED",
          detail: "Acceptance recovered from Gmail Sent folder",
        },
      ],
    });
    await tx.platformUsage.upsert({
      where: {
        workspaceId_operationKey: {
          workspaceId,
          operationKey: `mail:${messageId}`,
        },
      },
      create: {
        workspaceId,
        operationKey: `mail:${messageId}`,
        kind: "EMAIL",
        quantity: 1,
      },
      update: {},
    });
  });
  return { reconciled: true };
}

export async function sendApprovedReply(
  workspaceId: string,
  messageId: string,
  request: typeof fetch = fetch,
) {
  if (process.env.LIVE_EMAIL_ENABLED !== "true")
    throw new Error("Real email delivery is disabled");
  const draft = await db.platformMailMessage.findFirstOrThrow({
    where: { id: messageId, workspaceId, direction: "OUTBOUND" },
  });
  const token = await gmailToken(workspaceId, draft.mailboxId, request);
  const message = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const current = await tx.platformMailMessage.findFirstOrThrow({
      where: { id: messageId, workspaceId },
    });
    if (current.status === "ACCEPTED") return current;
    if (
      current.status !== "APPROVED" ||
      !current.approvedAt ||
      !current.approvedBy ||
      !current.replyToMessageId
    )
      throw new Error(
        "Approve the exact reply draft before sending; prior attempts cannot resend",
      );
    const [mailbox, organization, workspace, suppression] = await Promise.all([
      tx.platformMailbox.findFirstOrThrow({
        where: { workspaceId, id: current.mailboxId },
      }),
      tx.platformOrganization.findUniqueOrThrow({ where: { workspaceId } }),
      tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      tx.platformMailSuppression.findUnique({
        where: {
          workspaceId_email: {
            workspaceId,
            email: current.toEmail.toLowerCase(),
          },
        },
      }),
    ]);
    if (
      mailbox.status !== "LIVE_ENABLED" ||
      workspace.status !== "ACTIVE" ||
      suppression ||
      !senderMatchesWebsite(mailbox.email, [organization.websiteUrl])
    )
      throw new Error("Reply sender or recipient is not eligible");
    if (
      hash(
        JSON.stringify({
          subject: current.subject,
          body: current.body,
          to: current.toEmail,
        }),
      ) !== current.contentHash
    )
      throw new Error("Approved reply content changed");
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const [subscription, tenantCount, mailboxCount] = await Promise.all([
      tx.platformSubscription.findUnique({
        where: { workspaceId },
        include: { plan: true },
      }),
      tx.platformMailMessage.count({
        where: {
          workspaceId,
          direction: "OUTBOUND",
          status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
          createdAt: { gte: since },
        },
      }),
      tx.platformMailMessage.count({
        where: {
          workspaceId,
          mailboxId: mailbox.id,
          direction: "OUTBOUND",
          status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
          createdAt: { gte: since },
        },
      }),
    ]);
    if (
      !subscription ||
      !["ACTIVE", "TRIAL"].includes(subscription.status) ||
      (subscription.periodEnd && subscription.periodEnd < new Date())
    )
      throw new Error("An active subscription is required for sending");
    if (
      tenantCount >= subscription.plan.dailyEmails ||
      mailboxCount >= mailbox.dailyLimit
    )
      throw new MailDeferredError(
        "Daily sending allowance reached",
        new Date(since.getTime() + 86400000),
      );
    if (
      mailbox.lastSentAt &&
      mailbox.lastSentAt.getTime() + mailbox.minimumIntervalSeconds * 1000 >
        Date.now()
    )
      throw new MailDeferredError(
        "Sender rate limit reached",
        new Date(
          mailbox.lastSentAt.getTime() + mailbox.minimumIntervalSeconds * 1000,
        ),
      );
    await tx.platformMailMessage.update({
      where: { id: current.id },
      data: { status: "SENDING" },
    });
    await tx.platformMailbox.update({
      where: { id: mailbox.id },
      data: { lastSentAt: new Date() },
    });
    return current;
  });
  if (message.status === "ACCEPTED")
    return { messageId, status: "ACCEPTED" as const, duplicate: true };
  return deliverReservedMessage(
    { ...message, status: "SENDING" },
    token,
    request,
  );
}
