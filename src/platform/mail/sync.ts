import { z } from "zod";
import type { PlatformMailbox, PlatformMailMessage } from "@prisma/client";
import { db } from "@/lib/db";
import { hash } from "@/lib/security";
import { gmailToken } from "./google";
import {
  gmailMessageSchema,
  gmailHeader,
  gmailText,
  hydrateGmailFeedbackParts,
  parseGmailDeliveryStatus,
  senderAddress,
} from "./mime";
import {
  graphDeliveryFailure,
  graphHeader,
  graphMessage,
  graphMessageIds,
  microsoftToken,
} from "./microsoft";
import { classifyReply } from "./policy";
import { recordMailEvent, suppressAddress } from "./events";
import { clearConsentReply } from "./permission";

type Inbound = {
  provider: "gmail" | "microsoft";
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  body: string;
  messageIdHeader?: string;
  receivedAt: Date;
};
const messageIds = (value: string) =>
  value.match(/<[^<>\s]+@[^<>\s]+>/g) || [];
const backlogError = () =>
  new Error(
    "Mailbox backlog exceeds 1000 messages; feedback checkpoint was not advanced. Review the backlog before enabling further outreach.",
  );

/** The accepted outbound message an inbound message answers, by thread or Message-ID reference. */
async function findOriginal(
  workspaceId: string,
  mailboxId: string,
  inbound: {
    from?: string;
    threadId?: string;
    references: string[];
    receivedAt: Date;
  },
) {
  if (!inbound.threadId && !inbound.references.length) return null;
  return db.platformMailMessage.findFirst({
    where: {
      workspaceId,
      mailboxId,
      direction: "OUTBOUND",
      status: "ACCEPTED",
      ...(inbound.from
        ? { toEmail: { equals: inbound.from, mode: "insensitive" } }
        : {}),
      createdAt: { lte: inbound.receivedAt },
      OR: [
        ...(inbound.threadId ? [{ providerThreadId: inbound.threadId }] : []),
        ...(inbound.references.length
          ? [
              { rfcMessageId: { in: inbound.references } },
              { originalRfcMessageId: { in: inbound.references } },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

async function recordReply(
  workspaceId: string,
  mailbox: PlatformMailbox,
  original: PlatformMailMessage,
  inbound: Inbound,
) {
  const classification = classifyReply(inbound.body);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const inserted = await tx.platformMailMessage.createMany({
      skipDuplicates: true,
      data: [
        {
          workspaceId,
          mailboxId: mailbox.id,
          leadId: original.leadId,
          campaignId: original.campaignId,
          direction: "INBOUND",
          status: "RECEIVED",
          fromEmail: inbound.from,
          toEmail: mailbox.email,
          subject: inbound.subject.slice(0, 500),
          body: inbound.body,
          // Gmail keys keep their original format so earlier synchronizations stay deduplicated.
          dedupeKey:
            inbound.provider === "gmail"
              ? `inbound:${inbound.id}`
              : `inbound:${inbound.provider}:${inbound.id}`,
          contentHash: hash(inbound.body),
          rfcMessageId: `<${hash(`${workspaceId}:${mailbox.id}:${inbound.id}`)}@inbound.orbit.local>`,
          originalRfcMessageId: messageIds(inbound.messageIdHeader || "")[0],
          providerMessageId: inbound.id,
          providerThreadId: inbound.threadId,
          replyToMessageId: original.id,
          classification,
          classificationExplanation:
            "Provisional message-text classification; review before taking action.",
          suggestedReply: [
            "UNSUBSCRIBE",
            "NOT_INTERESTED",
            "OUT_OF_OFFICE",
            "AUTOMATIC_RESPONSE",
          ].includes(classification)
            ? null
            : "Thank you for your response. We will review your request and get back to you shortly.",
          createdAt: inbound.receivedAt,
        },
      ],
    });
    const saved = await tx.platformMailMessage.findUniqueOrThrow({
      where: {
        mailboxId_providerMessageId: {
          mailboxId: mailbox.id,
          providerMessageId: inbound.id,
        },
      },
    });
    const positive = [
      "INTERESTED",
      "MORE_INFORMATION",
      "PRICING",
      "MEETING_REQUESTED",
    ].includes(classification);
    if (original.leadId) {
      await tx.platformCampaignRecipient.updateMany({
        where: { workspaceId, leadId: original.leadId },
        data: { status: "STOPPED" },
      });
      await tx.platformLead.updateMany({
        where: { workspaceId, id: original.leadId },
        data: {
          repliedAt: inbound.receivedAt,
          status:
            classification === "UNSUBSCRIBE"
              ? "UNSUBSCRIBED"
              : classification === "NOT_INTERESTED"
                ? "NOT_INTERESTED"
                : positive
                  ? "INTERESTED"
                  : "REPLIED",
        },
      });
    }
    if (classification === "UNSUBSCRIBE")
      await suppressAddress(tx, workspaceId, inbound.from, "UNSUBSCRIBE");
    const campaign =
      original.campaignId && original.leadId
        ? await tx.platformCampaign.findFirst({
            where: { id: original.campaignId, workspaceId },
            select: { purpose: true },
          })
        : null;
    let notice = {
      kind:
        classification === "MEETING_REQUESTED"
          ? "MEETING_REQUESTED"
          : ["INTERESTED", "MORE_INFORMATION", "PRICING"].includes(
                classification,
              )
            ? "POSITIVE_REPLY"
            : "REPLY_RECEIVED",
      title:
        classification === "MEETING_REQUESTED"
          ? "A prospect requested a meeting"
          : "A prospect replied",
      message: `A response from ${inbound.from} is ready in the email inbox.`,
    };
    if (
      inserted.count &&
      campaign?.purpose === "PERMISSION_REQUEST" &&
      classification !== "UNSUBSCRIBE"
    ) {
      const agreement = clearConsentReply(inbound.body);
      const lead = await tx.platformLead.findFirst({
        where: { id: original.leadId!, workspaceId },
      });
      if (
        agreement &&
        lead &&
        !lead.unsubscribedAt &&
        lead.eligibility !== "SUPPRESSED"
      ) {
        // The reply is the consent evidence; consentAt equals repliedAt so this reply
        // does not count as a later response that stops outreach.
        await tx.platformLead.update({
          where: { id: lead.id },
          data: {
            eligibility: "CONSENTED",
            consentAt: inbound.receivedAt,
            consentSource: `Replied "${agreement.slice(0, 200)}" on ${inbound.receivedAt.toISOString()} to the one-time permission request "${original.subject.slice(0, 200)}" sent ${original.createdAt.toISOString()} from ${mailbox.email} (message ${original.id}).`,
            status: "INTERESTED",
          },
        });
        notice = {
          kind: "PERMISSION_GRANTED",
          title: "Permission recorded",
          message: `${lead.company} replied yes to your permission request. They can now be added to an outreach campaign.`,
        };
      } else
        notice = {
          kind: "PERMISSION_REVIEW",
          title: "A permission reply needs review",
          message: `${lead?.company || inbound.from} replied to your permission request. Read the reply and record permission on the lead only if they clearly agreed.`,
        };
    }
    if (inserted.count)
      await tx.platformNotice.create({
        data: { workspaceId, ...notice, dedupeKey: `mail-reply:${saved.id}` },
      });
    return { inserted: inserted.count };
  });
  const event = await recordMailEvent(workspaceId, mailbox.id, {
    messageId: original.id,
    externalId: `${inbound.provider}:reply:${inbound.id}`,
    kind: classification === "UNSUBSCRIBE" ? "UNSUBSCRIBE" : "REPLY",
    detail: `Reply classified provisionally as ${classification}`,
    occurredAt: inbound.receivedAt,
  });
  return !event.duplicate || result.inserted ? 1 : 0;
}

async function gmailJson(
  url: string | URL,
  token: string,
  request: typeof fetch,
) {
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      `Google mailbox synchronization failed (HTTP ${response.status})`,
    );
  return response.json();
}
async function syncGmail(
  workspaceId: string,
  mailbox: PlatformMailbox,
  after: Date,
  request: typeof fetch,
) {
  const token = await gmailToken(workspaceId, mailbox.id, request);
  let pageToken: string | undefined,
    recorded = 0,
    checked = 0;
  for (let page = 0; page < 10; page++) {
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    url.searchParams.set(
      "q",
      `after:${Math.floor(after.getTime() / 1000)} -in:sent`,
    );
    url.searchParams.set("includeSpamTrash", "true");
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = z
      .object({
        messages: z.array(z.object({ id: z.string() })).optional(),
        nextPageToken: z.string().optional(),
      })
      .parse(await gmailJson(url, token, request));
    for (const item of result.messages || []) {
      checked++;
      const message = gmailMessageSchema.parse(
        await gmailJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
          token,
          request,
        ),
      );
      if (!message.payload || message.labelIds?.includes("SENT")) continue;
      const receivedAt = new Date(Number(message.internalDate));
      if (!Number.isFinite(receivedAt.getTime()))
        throw new Error("Google returned an invalid message timestamp");
      if (parseGmailDeliveryStatus(message.payload)) {
        await hydrateGmailFeedbackParts(
          message.payload,
          async (id) =>
            z
              .object({ data: z.string() })
              .parse(
                await gmailJson(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(id)}`,
                  token,
                  request,
                ),
              ).data,
        );
        const feedback = parseGmailDeliveryStatus(message.payload)!;
        for (const recipient of feedback.recipients) {
          const original = await db.platformMailMessage.findFirst({
            where: {
              workspaceId,
              mailboxId: mailbox.id,
              direction: "OUTBOUND",
              status: "ACCEPTED",
              rfcMessageId: { in: feedback.originalMessageIds },
              toEmail: { equals: recipient.email, mode: "insensitive" },
              createdAt: { lte: receivedAt },
            },
          });
          if (!original) continue;
          const event = await recordMailEvent(workspaceId, mailbox.id, {
            messageId: original.id,
            externalId: `gmail:dsn:${message.id}:${original.id}`,
            kind: recipient.type,
            detail: `${recipient.status}${recipient.diagnostic ? ` ${recipient.diagnostic}` : ""}`,
            occurredAt: receivedAt,
          });
          if (!event.duplicate) recorded++;
        }
        continue;
      }
      const from = senderAddress(gmailHeader(message.payload, "From"));
      if (!from || from === mailbox.email.toLowerCase()) continue;
      const original = await findOriginal(workspaceId, mailbox.id, {
        from,
        threadId: message.threadId,
        references: messageIds(
          `${gmailHeader(message.payload, "In-Reply-To")} ${gmailHeader(message.payload, "References")}`,
        ),
        receivedAt,
      });
      if (!original) continue;
      recorded += await recordReply(workspaceId, mailbox, original, {
        provider: "gmail",
        id: message.id,
        threadId: message.threadId,
        from,
        subject: gmailHeader(message.payload, "Subject"),
        body:
          gmailText(message.payload) ||
          "Formatted reply received; open the connected Gmail mailbox to view its original content.",
        messageIdHeader: gmailHeader(message.payload, "Message-ID"),
        receivedAt,
      });
    }
    pageToken = result.nextPageToken;
    if (!pageToken) return { recorded, checked };
  }
  throw backlogError();
}

async function syncMicrosoft(
  workspaceId: string,
  mailbox: PlatformMailbox,
  after: Date,
  request: typeof fetch,
) {
  const token = await microsoftToken(workspaceId, mailbox.id, request);
  const { ids, complete } = await graphMessageIds(token, after, request);
  if (!complete) throw backlogError();
  let recorded = 0,
    checked = 0;
  for (const id of ids) {
    checked++;
    const message = await graphMessage(token, id, request);
    if (message.isDraft) continue;
    const receivedAt = new Date(message.receivedDateTime);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new Error("Microsoft returned an invalid message timestamp");
    const references = messageIds(
      `${graphHeader(message, "In-Reply-To")} ${graphHeader(message, "References")}`,
    );
    const failure = graphDeliveryFailure(message);
    if (failure) {
      // A non-delivery report comes from the mail system, so it is matched by conversation only.
      const original = await findOriginal(workspaceId, mailbox.id, {
        threadId: message.conversationId,
        references,
        receivedAt,
      });
      if (!original) continue;
      const event = await recordMailEvent(workspaceId, mailbox.id, {
        messageId: original.id,
        externalId: `microsoft:ndr:${message.id}`,
        kind: failure.kind,
        detail: failure.detail,
        occurredAt: receivedAt,
      });
      if (!event.duplicate) recorded++;
      continue;
    }
    const from = senderAddress(message.from?.emailAddress.address || "");
    if (!from || from === mailbox.email.toLowerCase()) continue;
    const original = await findOriginal(workspaceId, mailbox.id, {
      from,
      threadId: message.conversationId,
      references,
      receivedAt,
    });
    if (!original) continue;
    recorded += await recordReply(workspaceId, mailbox, original, {
      provider: "microsoft",
      id: message.id,
      threadId: message.conversationId,
      from,
      subject: message.subject || "",
      body:
        message.body?.content?.trim().slice(0, 20000) ||
        "Formatted reply received; open the connected Microsoft 365 mailbox to view its original content.",
      messageIdHeader: message.internetMessageId,
      receivedAt,
    });
  }
  return { recorded, checked };
}

export async function syncMailbox(
  workspaceId: string,
  mailboxId: string,
  request: typeof fetch = fetch,
) {
  const mailbox = await db.platformMailbox.findFirstOrThrow({
    where: {
      workspaceId,
      id: mailboxId,
      status: { in: ["LIVE_ENABLED", "CONNECTED"] },
    },
  });
  const startedAt = new Date();
  try {
    const oldest = await db.platformMailMessage.findFirst({
      where: {
        workspaceId,
        mailboxId,
        direction: "OUTBOUND",
        status: "ACCEPTED",
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (!oldest) {
      await db.platformMailbox.update({
        where: { id: mailboxId },
        data: { lastSyncedAt: startedAt, syncError: null },
      });
      return { recorded: 0, checked: 0 };
    }
    const after = new Date(
      Math.max(
        oldest.createdAt.getTime(),
        mailbox.lastSyncedAt?.getTime() || oldest.createdAt.getTime(),
      ) - 300000,
    );
    const result =
      mailbox.provider === "MICROSOFT"
        ? await syncMicrosoft(workspaceId, mailbox, after, request)
        : await syncGmail(workspaceId, mailbox, after, request);
    await db.platformMailbox.update({
      where: { id: mailboxId },
      data: { lastSyncedAt: startedAt, syncError: null },
    });
    return result;
  } catch (error) {
    await db.platformMailbox.updateMany({
      where: { id: mailboxId, workspaceId },
      data: {
        syncError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Mailbox synchronization failed",
        lastSyncedAt: null,
      },
    });
    await db.platformNotice.upsert({
      where: {
        dedupeKey: `mail-sync-failed:${mailboxId}:${new Date().toISOString().slice(0, 10)}`,
      },
      create: {
        workspaceId,
        kind: "EMAIL_INTEGRATION_FAILED",
        title: "Email integration needs attention",
        message:
          "Mailbox synchronization failed. Sending is held until fresh feedback is available.",
        severity: "WARNING",
        dedupeKey: `mail-sync-failed:${mailboxId}:${new Date().toISOString().slice(0, 10)}`,
      },
      update: {},
    });
    throw error;
  }
}
