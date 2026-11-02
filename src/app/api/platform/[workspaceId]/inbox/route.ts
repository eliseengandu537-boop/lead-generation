import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, sameOrigin } from "@/lib/auth";
import { hash } from "@/lib/security";
import { handle, json } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { enqueueJob } from "@/platform/jobs";
import { replyCategories } from "@/platform/mail/policy";
import { suppressAddress } from "@/platform/mail/events";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    const query = new URL(request.url).searchParams;
    const items = await db.platformMailMessage.findMany({
      where: {
        workspaceId,
        ...(query.get("leadId") ? { leadId: query.get("leadId")! } : {}),
        ...(query.get("mailboxId")
          ? { mailboxId: query.get("mailboxId")! }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { items };
  });
}
const inputSchema = z.object({
  action: z.enum(["draftReply", "editDraft", "approveReply", "classify"]),
  messageId: z.string().min(1),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(20000).optional(),
  classification: z.enum(replyCategories).optional(),
});
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    await sameOrigin();
    const { workspaceId } = await params;
    const { user } = await organizationAccess(workspaceId, true);
    const input = inputSchema.parse(await json(request));
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const message = await tx.platformMailMessage.findFirst({
        where: { id: input.messageId, workspaceId },
      });
      if (!message) throw new HttpError(404, "Message not found");
      if (input.action === "classify") {
        if (message.direction !== "INBOUND" || !input.classification)
          throw new HttpError(400, "Choose a reply classification");
        if (input.classification === "UNSUBSCRIBE")
          await suppressAddress(
            tx,
            workspaceId,
            message.fromEmail,
            "UNSUBSCRIBE",
          );
        await tx.platformMailMessage.update({
          where: { id: message.id },
          data: {
            classification: input.classification,
            classificationExplanation: `Reviewed by client administrator ${user.id}`,
          },
        });
        await tx.platformActivity.create({
          data: {
            workspaceId,
            actorId: user.id,
            leadId: message.leadId,
            kind: "REPLY_CLASSIFIED",
            detail: `${message.id}: ${input.classification}`,
          },
        });
        return { ok: true };
      }
      if (input.action === "draftReply") {
        if (message.direction !== "INBOUND")
          throw new HttpError(400, "Select an incoming prospect reply");
        const body = input.body || message.suggestedReply,
          subject =
            input.subject || `Re: ${message.subject.replace(/^Re:\s*/i, "")}`;
        if (!body)
          throw new HttpError(400, "Write the reply to review before sending");
        const id = randomUUID();
        const mailbox = await tx.platformMailbox.findFirstOrThrow({
          where: { id: message.mailboxId, workspaceId },
        });
        const draft = await tx.platformMailMessage.create({
          data: {
            id,
            workspaceId,
            mailboxId: mailbox.id,
            leadId: message.leadId,
            campaignId: message.campaignId,
            direction: "OUTBOUND",
            status: "DRAFT",
            fromEmail: mailbox.email,
            toEmail: message.fromEmail,
            subject,
            body,
            dedupeKey: `reply:${id}`,
            contentHash: hash(
              JSON.stringify({ subject, body, to: message.fromEmail }),
            ),
            rfcMessageId: `<${hash(`${workspaceId}:${id}`)}@${mailbox.email.split("@")[1]}>`,
            replyToMessageId: message.id,
          },
        });
        return { item: draft };
      }
      if (
        message.direction !== "OUTBOUND" ||
        message.status !== "DRAFT" ||
        !message.replyToMessageId
      )
        throw new HttpError(
          409,
          "Only an unsent reply draft can be edited or approved",
        );
      if (input.action === "editDraft") {
        const subject = input.subject || message.subject,
          body = input.body || message.body;
        const item = await tx.platformMailMessage.update({
          where: { id: message.id },
          data: {
            subject,
            body,
            contentHash: hash(
              JSON.stringify({ subject, body, to: message.toEmail }),
            ),
            approvedBy: null,
            approvedAt: null,
          },
        });
        return { item };
      }
      await tx.platformMailMessage.update({
        where: { id: message.id },
        data: {
          status: "APPROVED",
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
      const job = await enqueueJob(
        workspaceId,
        user.id,
        "SEND_REPLY",
        { messageId: message.id },
        `reply:${message.id}`,
        tx,
      );
      await tx.platformActivity.create({
        data: {
          workspaceId,
          actorId: user.id,
          leadId: message.leadId,
          kind: "REPLY_APPROVED",
          detail: `Approved exact reply content ${message.id}`,
        },
      });
      return { queued: true, job };
    });
  });
}
