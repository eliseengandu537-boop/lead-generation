import { z } from "zod";
import { controlDb, db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { sign, safeEqual } from "@/lib/security";
import { withTenantDatabase } from "@/lib/tenancy";
import { recordMailEvent } from "./events";

const feedbackSchema = z
  .object({
    externalId: z.string().min(1).max(220),
    provider: z.literal("GMAIL"),
    providerMessageId: z.string().min(1).max(300).optional(),
    rfcMessageId: z.string().min(1).max(300).optional(),
    kind: z.enum([
      "DELIVERED",
      "BOUNCE",
      "SOFT_BOUNCE",
      "COMPLAINT",
      "UNSUBSCRIBE",
    ]),
    occurredAt: z.iso.datetime(),
    detail: z.string().max(2000).default(""),
  })
  .strict()
  .refine(
    (input) => input.providerMessageId || input.rfcMessageId,
    "A provider or RFC message ID is required",
  );
export function verifyFeedback(
  mailboxId: string,
  raw: string,
  timestamp: string,
  signature: string,
  key = process.env.EMAIL_FEEDBACK_SECRET || "",
  now = Date.now(),
) {
  return (
    key.length >= 32 &&
    /^\d{10}$/.test(timestamp) &&
    /^[a-f0-9]{64}$/.test(signature) &&
    Math.abs(now - Number(timestamp) * 1000) <= 300000 &&
    safeEqual(signature, sign(`${timestamp}.${mailboxId}.${raw}`, key))
  );
}
export async function ingestFeedback(mailboxId: string, data: unknown) {
  const input = feedbackSchema.parse(data);
  const mailbox = await controlDb.platformMailbox.findFirst({
    where: { id: mailboxId, provider: input.provider },
  });
  if (!mailbox) throw new HttpError(404, "Mailbox not found");
  return withTenantDatabase(mailbox.workspaceId, async () => {
    const messages = await db.platformMailMessage.findMany({
      where: {
        workspaceId: mailbox.workspaceId,
        mailboxId,
        direction: "OUTBOUND",
        status: "ACCEPTED",
        ...(input.providerMessageId
          ? { providerMessageId: input.providerMessageId }
          : {}),
        ...(input.rfcMessageId ? { rfcMessageId: input.rfcMessageId } : {}),
      },
      take: 2,
    });
    if (messages.length !== 1)
      throw new HttpError(
        404,
        "No unique accepted message matches this feedback",
      );
    return recordMailEvent(mailbox.workspaceId, mailboxId, {
      messageId: messages[0].id,
      externalId: `bridge:${input.externalId}`,
      kind: input.kind,
      detail: input.detail,
      occurredAt: new Date(input.occurredAt),
    });
  });
}

export async function unsubscribeMessage(messageId: string, token: string) {
  if (
    !process.env.NEXTAUTH_SECRET ||
    !safeEqual(
      token,
      sign(`platform-unsubscribe:${messageId}`, process.env.NEXTAUTH_SECRET),
    )
  )
    throw new HttpError(400, "Invalid unsubscribe link");
  const message = await controlDb.platformMailMessage.findFirst({
    where: { id: messageId, direction: "OUTBOUND" },
  });
  if (!message) throw new HttpError(404, "Message not found");
  return withTenantDatabase(message.workspaceId, () =>
    recordMailEvent(message.workspaceId, message.mailboxId, {
      messageId,
      externalId: `unsubscribe:${messageId}`,
      kind: "UNSUBSCRIBE",
      detail: "Recipient requested unsubscribe",
      occurredAt: new Date(),
    }),
  );
}
