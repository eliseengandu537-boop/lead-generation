import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { assessMailSafety } from "./policy";
import { isSendingProvider, providerName } from "./provider";

export async function campaignMailSafety(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  campaignId: string,
) {
  const campaign = await tx.platformCampaign.findFirstOrThrow({
    where: { id: campaignId, workspaceId },
  });
  const messages = await tx.platformMailMessage.findMany({
    where: {
      workspaceId,
      campaignId,
      direction: "OUTBOUND",
      status: "ACCEPTED",
      createdAt: {
        gte: new Date(Date.now() - campaign.safetyWindowHours * 3600000),
      },
    },
    select: { id: true },
  });
  const events = messages.length
    ? await tx.platformMailEvent.findMany({
        where: {
          workspaceId,
          messageId: { in: messages.map((message) => message.id) },
          kind: { in: ["BOUNCE", "COMPLAINT"] },
        },
        select: { messageId: true, kind: true },
      })
    : [];
  const counts = {
    accepted: messages.length,
    bounces: new Set(
      events
        .filter((event) => event.kind === "BOUNCE")
        .map((event) => event.messageId),
    ).size,
    complaints: new Set(
      events
        .filter((event) => event.kind === "COMPLAINT")
        .map((event) => event.messageId),
    ).size,
  };
  return { campaign, ...assessMailSafety(campaign, counts) };
}
export async function pauseUnsafeCampaign(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  campaignId: string,
) {
  const stats = await campaignMailSafety(tx, workspaceId, campaignId);
  if (!stats.reason) return { paused: false, ...stats };
  const changed = await tx.platformCampaign.updateMany({
    where: { id: campaignId, workspaceId, status: "RUNNING" },
    data: {
      status: "PAUSED",
      safetyPausedAt: new Date(),
      safetyPauseReason: stats.reason,
    },
  });
  if (changed.count) {
    const detail = JSON.stringify({
      campaignId,
      reason: stats.reason,
      accepted: stats.accepted,
      bounces: stats.bounces,
      complaints: stats.complaints,
    });
    await tx.platformActivity.create({
      data: { workspaceId, campaignId, kind: "EMAIL_SAFETY_PAUSED", detail },
    });
    await tx.platformNotice.create({
      data: {
        workspaceId,
        kind: "EMAIL_SAFETY_PAUSED",
        title: "Campaign paused for email safety",
        message: `${stats.campaign.name}: ${stats.reason === "BOUNCE_RATE" ? "bounce" : "complaint"} threshold reached. Review the audience and sender account before resuming.`,
        severity: "WARNING",
        dedupeKey: `mail-safety:${campaignId}:${stats.campaign.updatedAt.getTime()}`,
      },
    });
  }
  return { paused: true, ...stats };
}
export async function suppressAddress(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  email: string,
  reason: string,
) {
  email = email.toLowerCase();
  await tx.platformMailSuppression.upsert({
    where: { workspaceId_email: { workspaceId, email } },
    create: { workspaceId, email, reason },
    update: { reason },
  });
  const leads = await tx.platformLead.findMany({
    where: { workspaceId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  await tx.platformCampaignRecipient.updateMany({
    where: { workspaceId, leadId: { in: leads.map((lead) => lead.id) } },
    data: { status: "STOPPED" },
  });
  if (["UNSUBSCRIBE", "COMPLAINT"].includes(reason))
    await tx.platformLead.updateMany({
      where: { workspaceId, id: { in: leads.map((lead) => lead.id) } },
      data: {
        eligibility: "SUPPRESSED",
        unsubscribedAt: new Date(),
        status: "UNSUBSCRIBED",
      },
    });
}
const eventSchema = z.object({
  messageId: z.string(),
  externalId: z.string().min(1).max(240),
  kind: z.enum([
    "DELIVERED",
    "REPLY",
    "BOUNCE",
    "SOFT_BOUNCE",
    "COMPLAINT",
    "UNSUBSCRIBE",
  ]),
  detail: z.string().max(2000).default(""),
  occurredAt: z.date().default(() => new Date()),
});
export async function recordMailEvent(
  workspaceId: string,
  mailboxId: string,
  data: unknown,
) {
  const input = eventSchema.parse(data);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const mailbox = await tx.platformMailbox.findFirstOrThrow({
        where: { id: mailboxId, workspaceId },
      });
      const message = await tx.platformMailMessage.findFirst({
        where: { id: input.messageId, workspaceId, mailboxId },
      });
      if (!message)
        throw new HttpError(404, "Message not found for this mailbox");
      if (input.kind === "DELIVERED" && isSendingProvider(mailbox.provider))
        throw new HttpError(
          400,
          `${providerName(mailbox.provider)} does not provide confirmed message delivery`,
        );
      if (
        input.occurredAt.getTime() > Date.now() + 300000 ||
        input.occurredAt < message.createdAt
      )
        throw new HttpError(400, "Invalid email event time");
      const duplicate = await tx.platformMailEvent.findUnique({
        where: {
          mailboxId_externalId: { mailboxId, externalId: input.externalId },
        },
      });
      if (duplicate) {
        if (duplicate.messageId !== message.id || duplicate.kind !== input.kind)
          throw new HttpError(409, "Provider event ID changed message or kind");
        return { id: duplicate.id, duplicate: true };
      }
      const event = await tx.platformMailEvent.create({
        data: { ...input, workspaceId, mailboxId },
      });
      if (["BOUNCE", "COMPLAINT", "UNSUBSCRIBE"].includes(input.kind))
        await suppressAddress(tx, workspaceId, message.toEmail, input.kind);
      if (["REPLY", "SOFT_BOUNCE"].includes(input.kind) && message.leadId) {
        await tx.platformCampaignRecipient.updateMany({
          where: { workspaceId, leadId: message.leadId },
          data: { status: "STOPPED" },
        });
        if (input.kind === "REPLY")
          await tx.platformLead.updateMany({
            where: { id: message.leadId, workspaceId },
            data: { repliedAt: input.occurredAt },
          });
      }
      await tx.platformActivity.create({
        data: {
          workspaceId,
          leadId: message.leadId,
          campaignId: message.campaignId,
          kind: `MAIL_${input.kind}`,
          detail: input.detail || input.kind,
        },
      });
      if (message.campaignId && ["BOUNCE", "COMPLAINT"].includes(input.kind))
        await pauseUnsafeCampaign(tx, workspaceId, message.campaignId);
      return { id: event.id, duplicate: false };
    },
    { timeout: 15000 },
  );
}
