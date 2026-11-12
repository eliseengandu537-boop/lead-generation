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
import {
  beginMicrosoftConnection,
  microsoftConfigured,
} from "@/platform/mail/microsoft";
import { senderAllowed, sendingDomain } from "@/platform/mail/domain";
import {
  readDomainHealth,
  refreshDomainHealth,
} from "@/platform/mail/authentication";
import {
  sentTodayByMailbox,
  warmupProgress,
} from "@/platform/mail/rotation";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { workspaceId } = await params;
    const { organization } = await organizationAccess(workspaceId);
    if (organization.onboardingStatus !== "DEMO")
      await refreshDomainHealth(workspaceId, 6 * 3600_000);
    const items = await db.platformMailbox.findMany({
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
        warmupStartedAt: true,
        domainHealth: true,
        domainCheckedAt: true,
      },
    });
    const sentToday = await sentTodayByMailbox(
      workspaceId,
      items.map((item) => item.id),
    );
    return {
      sendingDomains: organization.sendingDomains,
      websiteDomain: sendingDomain(organization.websiteUrl),
      configured: googleConfigured() || microsoftConfigured(),
      providers: {
        google: googleConfigured(),
        microsoft: microsoftConfigured(),
      },
      liveConfigured: process.env.LIVE_EMAIL_ENABLED === "true",
      items: items.map((item) => ({
        ...item,
        domainHealth: readDomainHealth(item.domainHealth),
        warmup: warmupProgress(item),
        sentToday: sentToday.get(item.id) ?? 0,
      })),
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
    "check-domain",
    "skip-warmup",
    "restart-warmup",
    "add-domain",
    "remove-domain",
  ]),
  id: z.string().optional(),
  domain: z.string().max(253).optional(),
  provider: z.enum(["GOOGLE", "MICROSOFT"]).default("GOOGLE"),
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
      const microsoft = input.provider === "MICROSOFT";
      const url = microsoft
        ? await beginMicrosoftConnection(workspaceId, user.id, browser)
        : await beginGoogleConnection(workspaceId, user.id, browser);
      (await cookies()).set(
        microsoft ? "orbit-microsoft-oauth" : "orbit-google-oauth",
        browser,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: microsoft
            ? "/api/platform/oauth/microsoft/callback"
            : "/api/platform/oauth/google/callback",
          maxAge: 600,
        },
      );
      return { url };
    }
    if (input.action === "add-domain" || input.action === "remove-domain") {
      const domain = sendingDomain(input.domain || "");
      if (!domain)
        throw new HttpError(400, "Enter a business domain such as getdcbspares.co.za (not Gmail or Outlook)");
      if (input.action === "remove-domain") {
        const inUse = (
          await db.platformMailbox.findMany({
            where: { workspaceId, status: { not: "DISABLED" } },
            select: { email: true },
          })
        ).some((item) => item.email.endsWith(`@${domain}`));
        if (inUse)
          throw new HttpError(409, "Disable the mailboxes on this domain before removing it");
      }
      const sendingDomains =
        input.action === "add-domain"
          ? [...new Set([...organization.sendingDomains, domain])]
          : organization.sendingDomains.filter((item) => item !== domain);
      await db.$transaction(async (tx) => {
        await tx.platformOrganization.update({
          where: { workspaceId },
          data: { sendingDomains },
        });
        await tx.platformActivity.create({
          data: {
            workspaceId,
            actorId: user.id,
            kind: input.action === "add-domain" ? "SENDING_DOMAIN_ADDED" : "SENDING_DOMAIN_REMOVED",
            detail: `Sending domain ${domain}`,
          },
        });
      });
      return { sendingDomains };
    }
    const mailbox = await db.platformMailbox.findFirst({
      where: { id: input.id || "", workspaceId },
    });
    if (!mailbox) throw new HttpError(404, "Mailbox not found");
    if (input.action === "check-domain") {
      await refreshDomainHealth(workspaceId, 0, [mailbox.id]);
      const checked = await db.platformMailbox.findUniqueOrThrow({
        where: { id: mailbox.id },
        select: { domainHealth: true },
      });
      return { domainHealth: readDomainHealth(checked.domainHealth) };
    }
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
        throw new HttpError(409, "Reconnect the email account first");
      if (
        !organization.profileApprovedAt ||
        !senderAllowed(mailbox.email, organization)
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
          input.action === "skip-warmup" || input.action === "restart-warmup"
            ? { warmupStartedAt: input.action === "skip-warmup" ? null : new Date() }
            : input.action === "configure"
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
          kind: `MAILBOX_${input.action.toUpperCase().replaceAll("-", "_")}`,
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
