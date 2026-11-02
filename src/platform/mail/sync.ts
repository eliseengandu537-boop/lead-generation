import { z } from "zod";
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
import { classifyReply } from "./policy";
import { recordMailEvent, suppressAddress } from "./events";

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
    const token = await gmailToken(workspaceId, mailboxId, request);
    const after = Math.floor(
      (Math.max(
        oldest.createdAt.getTime(),
        mailbox.lastSyncedAt?.getTime() || oldest.createdAt.getTime(),
      ) -
        300000) /
        1000,
    );
    let pageToken: string | undefined,
      recorded = 0,
      checked = 0,
      complete = false;
    for (let page = 0; page < 10; page++) {
      const url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      );
      url.searchParams.set("q", `after:${after} -in:sent`);
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
                mailboxId,
                direction: "OUTBOUND",
                status: "ACCEPTED",
                rfcMessageId: { in: feedback.originalMessageIds },
                toEmail: { equals: recipient.email, mode: "insensitive" },
                createdAt: { lte: receivedAt },
              },
            });
            if (!original) continue;
            const event = await recordMailEvent(workspaceId, mailboxId, {
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
        const references =
          `${gmailHeader(message.payload, "In-Reply-To")} ${gmailHeader(message.payload, "References")}`.match(
            /<[^<>\s]+@[^<>\s]+>/g,
          ) || [];
        if (!message.threadId && !references.length) continue;
        const original = await db.platformMailMessage.findFirst({
          where: {
            workspaceId,
            mailboxId,
            direction: "OUTBOUND",
            status: "ACCEPTED",
            toEmail: { equals: from, mode: "insensitive" },
            createdAt: { lte: receivedAt },
            OR: [
              ...(message.threadId
                ? [{ providerThreadId: message.threadId }]
                : []),
              ...(references.length
                ? [{ rfcMessageId: { in: references } }]
                : []),
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        });
        if (!original) continue;
        const body =
          gmailText(message.payload) ||
          "Formatted reply received; open the connected Gmail mailbox to view its original content.";
        const classification = classifyReply(body);
        const inbound = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
          const inserted = await tx.platformMailMessage.createMany({
            skipDuplicates: true,
            data: [
              {
                workspaceId,
                mailboxId,
                leadId: original.leadId,
                campaignId: original.campaignId,
                direction: "INBOUND",
                status: "RECEIVED",
                fromEmail: from,
                toEmail: mailbox.email,
                subject: gmailHeader(message.payload!, "Subject").slice(0, 500),
                body,
                dedupeKey: `inbound:${message.id}`,
                contentHash: hash(body),
                rfcMessageId: `<${hash(`${workspaceId}:${mailboxId}:${message.id}`)}@inbound.orbit.local>`,
                originalRfcMessageId: gmailHeader(
                  message.payload!,
                  "Message-ID",
                ).match(/<[^<>\s]+@[^<>\s]+>/)?.[0],
                providerMessageId: message.id,
                providerThreadId: message.threadId,
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
                createdAt: receivedAt,
              },
            ],
          });
          const saved = await tx.platformMailMessage.findUniqueOrThrow({
            where: {
              mailboxId_providerMessageId: {
                mailboxId,
                providerMessageId: message.id,
              },
            },
          });
          if (original.leadId) {
            await tx.platformCampaignRecipient.updateMany({
              where: { workspaceId, leadId: original.leadId },
              data: { status: "STOPPED" },
            });
            const positive = [
              "INTERESTED",
              "MORE_INFORMATION",
              "PRICING",
              "MEETING_REQUESTED",
            ].includes(classification);
            await tx.platformLead.updateMany({
              where: { workspaceId, id: original.leadId },
              data: {
                repliedAt: receivedAt,
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
            await suppressAddress(tx, workspaceId, from, "UNSUBSCRIBE");
          if (inserted.count)
            await tx.platformNotice.create({
              data: {
                workspaceId,
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
                message: `A response from ${from} is ready in the email inbox.`,
                dedupeKey: `mail-reply:${saved.id}`,
              },
            });
          return { saved, inserted: inserted.count };
        });
        const event = await recordMailEvent(workspaceId, mailboxId, {
          messageId: original.id,
          externalId: `gmail:reply:${message.id}`,
          kind: classification === "UNSUBSCRIBE" ? "UNSUBSCRIBE" : "REPLY",
          detail: `Reply classified provisionally as ${classification}`,
          occurredAt: receivedAt,
        });
        if (!event.duplicate || inbound.inserted) recorded++;
      }
      pageToken = result.nextPageToken;
      if (!pageToken) {
        complete = true;
        break;
      }
    }
    if (!complete)
      throw new Error(
        "Mailbox backlog exceeds 1000 messages; feedback checkpoint was not advanced. Review the backlog before enabling further outreach.",
      );
    await db.platformMailbox.update({
      where: { id: mailboxId },
      data: { lastSyncedAt: startedAt, syncError: null },
    });
    return { recorded, checked };
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
