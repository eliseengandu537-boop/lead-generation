import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, sameOrigin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { secret } from "@/lib/security";
import { organizationAccess } from "@/platform/core";
import { enqueueJob } from "@/platform/jobs";
import {
  beginGoogleConnection,
  googleConfigured,
} from "@/platform/mail/google";
import { senderMatchesWebsite } from "@/platform/mail/domain";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    return {
      configured: googleConfigured(),
      liveConfigured: process.env.LIVE_EMAIL_ENABLED === "true",
      items: await db.platformMailbox.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          provider: true,
          status: true,
          dailyLimit: true,
          minimumIntervalSeconds: true,
          lastSyncedAt: true,
          syncError: true,
          createdAt: true,
        },
      }),
    };
  });
}
const actionSchema = z.object({
  action: z.enum([
    "connect",
    "enable",
    "disable",
    "configure",
    "sync",
    "reconcile",
  ]),
  id: z.string().optional(),
  messageId: z.string().optional(),
  dailyLimit: z.number().int().min(1).max(1000).optional(),
  minimumIntervalSeconds: z.number().int().min(5).max(3600).optional(),
});
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    await sameOrigin();
    const { workspaceId } = await params;
    const { user, organization } = await organizationAccess(workspaceId, true);
    const input = actionSchema.parse(await json(request));
    if (input.action === "connect") {
      if (!organization.websiteUrl)
        throw new HttpError(
          400,
          "Connect this client's business website first",
        );
      const browser = secret();
      const url = await beginGoogleConnection(workspaceId, user.id, browser);
      (await cookies()).set("orbit-google-oauth", browser, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/platform/oauth/google/callback",
        maxAge: 600,
      });
      return { url };
    }
    const mailbox = await db.platformMailbox.findFirst({
      where: { id: input.id || "", workspaceId },
    });
    if (!mailbox) throw new HttpError(404, "Mailbox not found");
    if (input.action === "sync")
      return {
        queued: true,
        job: await enqueueJob(
          workspaceId,
          user.id,
          "SYNC_MAILBOX",
          { mailboxId: mailbox.id },
          `mail-sync:${mailbox.id}:${Math.floor(Date.now() / 60000)}`,
        ),
      };
    if (input.action === "reconcile") {
      const message = await db.platformMailMessage.findFirst({
        where: {
          workspaceId,
          mailboxId: mailbox.id,
          id: input.messageId || "",
          status: { in: ["SENDING", "REVIEW_REQUIRED"] },
        },
      });
      if (!message) throw new HttpError(404, "Uncertain message not found");
      return {
        queued: true,
        job: await enqueueJob(
          workspaceId,
          user.id,
          "RECONCILE_MAIL",
          { mailboxId: mailbox.id, messageId: message.id },
          `reconcile:${message.id}:${Math.floor(Date.now() / 60000)}`,
        ),
      };
    }
    if (input.action === "enable") {
      if (process.env.LIVE_EMAIL_ENABLED !== "true")
        throw new HttpError(
          409,
          "The platform administrator must enable live email delivery first",
        );
      if (mailbox.status === "RECONNECT_REQUIRED")
        throw new HttpError(409, "Reconnect the Google account first");
      if (
        !organization.profileApprovedAt ||
        !senderMatchesWebsite(mailbox.email, [organization.websiteUrl])
      )
        throw new HttpError(
          400,
          "Approve the website business profile and authorize its matching business email",
        );
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      await tx.platformMailbox.update({
        where: { id: mailbox.id },
        data:
          input.action === "configure"
            ? {
                ...(input.dailyLimit ? { dailyLimit: input.dailyLimit } : {}),
                ...(input.minimumIntervalSeconds
                  ? { minimumIntervalSeconds: input.minimumIntervalSeconds }
                  : {}),
              }
            : {
                status: input.action === "enable" ? "LIVE_ENABLED" : "DISABLED",
              },
      });
      await tx.platformActivity.create({
        data: {
          workspaceId,
          actorId: user.id,
          kind: `MAILBOX_${input.action.toUpperCase()}`,
          detail: `Authorized business mailbox ${mailbox.email}`,
        },
      });
    });
    if (input.action === "enable")
      await enqueueJob(
        workspaceId,
        user.id,
        "SYNC_MAILBOX",
        { mailboxId: mailbox.id },
        `mail-sync:${mailbox.id}:${Math.floor(Date.now() / 60000)}`,
      );
    return { ok: true };
  });
}
