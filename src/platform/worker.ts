import { Prisma, type PlatformJob } from "@prisma/client";
import { z } from "zod";
import { controlDb, db } from "@/lib/db";
import { withTenantDatabase } from "@/lib/tenancy";
import { HttpError } from "@/lib/auth";
import { enqueueJob, dispatchOneJob, orchestrationConfig } from "./jobs";
import {
  analyzeWebsite,
  discover,
  researchLead,
  qualify,
  verifyEmail,
  draftEmail,
  classifyReply,
  notice,
} from "./research/service";
import {
  sendCampaignMessage,
  syncMailbox,
  sendApprovedReply,
  reconcileMessage,
  MailDeferredError,
} from "./mail";
import { reportData } from "./analytics";
import { hasMarketingPermission, replyBlocksOutreach } from "./mail/permission";

async function campaignBatch(job: PlatformJob, campaignId: string) {
  const campaign = await db.platformCampaign.findFirst({
    where: { id: campaignId, workspaceId: job.workspaceId },
  });
  if (!campaign || campaign.status !== "RUNNING")
    return { summary: "Campaign is not running; no messages were sent." };
  if (!campaign.mailboxId)
    throw new HttpError(409, "Campaign needs an authorized business mailbox");
  if (campaign.scheduledAt && campaign.scheduledAt > new Date())
    throw new MailDeferredError(
      "Campaign start is scheduled for later",
      campaign.scheduledAt,
    );
  await syncMailbox(job.workspaceId, campaign.mailboxId);
  const recipients = await db.platformCampaignRecipient.findMany({
    where: {
      workspaceId: job.workspaceId,
      campaignId,
      status: "QUEUED",
      nextAt: { lte: new Date() },
    },
    include: { lead: true },
    orderBy: { nextAt: "asc" },
    take: 10,
  });
  let sent = 0,
    stopped = 0;
  for (const recipient of recipients) {
    const lead = recipient.lead;
    if (
      campaign.purpose === "PERMISSION_REQUEST"
        ? lead.repliedAt ||
          lead.unsubscribedAt ||
          lead.eligibility === "SUPPRESSED" ||
          hasMarketingPermission(lead)
        : replyBlocksOutreach(lead) ||
          lead.unsubscribedAt ||
          lead.eligibility !== "CONSENTED"
    ) {
      await db.platformCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "STOPPED" },
      });
      stopped++;
      continue;
    }
    await sendCampaignMessage(
      job.workspaceId,
      campaignId,
      recipient.leadId,
      recipient.step,
      job.id,
    );
    await db.$transaction(async (tx) => {
      const steps = z
        .array(
          z.object({
            delayDays: z.number(),
            subject: z.string(),
            body: z.string(),
          }),
        )
        .parse(campaign.steps);
      const nextStep = recipient.step + 1;
      const next = steps[nextStep - 1];
      await tx.platformCampaignRecipient.updateMany({
        where: {
          id: recipient.id,
          workspaceId: job.workspaceId,
          step: recipient.step,
          status: "QUEUED",
        },
        data: {
          step: nextStep,
          status: next ? "QUEUED" : "COMPLETE",
          nextAt: next
            ? new Date(Date.now() + next.delayDays * 86400000)
            : new Date(),
        },
      });
      if (recipient.step === 0)
        await tx.platformLead.updateMany({
          where: {
            id: recipient.leadId,
            workspaceId: job.workspaceId,
            status: { in: ["NEW", "QUALIFIED", "OUTREACH_SCHEDULED"] },
          },
          data: { status: "CONTACTED" },
        });
    });
    sent++;
  }
  const remaining = await db.platformCampaignRecipient.count({
    where: { workspaceId: job.workspaceId, campaignId, status: "QUEUED" },
  });
  if (!remaining) {
    await db.platformCampaign.updateMany({
      where: {
        id: campaignId,
        workspaceId: job.workspaceId,
        status: "RUNNING",
      },
      data: { status: "COMPLETED" },
    });
    await notice(
      job.workspaceId,
      `campaign-complete:${campaignId}`,
      "CAMPAIGN_COMPLETED",
      "Campaign completed",
      `${campaign.name} has finished its approved sequence.`,
    );
  }
  return {
    summary: `${sent} messages accepted by the provider; ${stopped} recipients stopped. Acceptance is not delivery confirmation.`,
  };
}
export async function performJob(job: PlatformJob) {
  const business = await db.workspace.findUnique({
    where: { id: job.workspaceId },
    select: { status: true },
  });
  if (business?.status !== "ACTIVE")
    throw new HttpError(403, "Organization is suspended");
  if (job.actorId) {
    const user = await controlDb.user.findUnique({
      where: { id: job.actorId },
      select: { agencyAdmin: true },
    });
    const member = await db.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: job.workspaceId,
          userId: job.actorId,
        },
      },
    });
    if (!user || (!user.agencyAdmin && member?.role !== "CLIENT_ADMIN"))
      throw new HttpError(
        403,
        "The requesting user no longer has management access",
      );
  }
  const input = z
    .object({
      leadId: z.string().optional(),
      mailboxId: z.string().optional(),
      messageId: z.string().optional(),
      campaignId: z.string().optional(),
    })
    .passthrough()
    .parse(job.payload);
  const required = (value: string | undefined) => {
    if (!value)
      throw new HttpError(400, "The queued operation is missing its record ID");
    return value;
  };
  switch (job.kind) {
    case "ANALYZE_WEBSITE":
      return analyzeWebsite(job.workspaceId, job.id);
    case "DISCOVER":
      return discover(job.workspaceId, job.actorId, job.id, job.payload);
    case "RESEARCH_LEAD":
      return researchLead(
        job.workspaceId,
        required(input.leadId),
        job.actorId,
        job.id,
      );
    case "QUALIFY":
      return qualify(job.workspaceId, required(input.leadId), job.id);
    case "VERIFY_EMAIL":
      return verifyEmail(job.workspaceId, required(input.leadId));
    case "DRAFT_EMAIL":
      return draftEmail(job.workspaceId, required(input.leadId), job.id);
    case "CLASSIFY_REPLY":
      return classifyReply(job.workspaceId, required(input.messageId), job.id);
    case "SEND_CAMPAIGN":
      return campaignBatch(job, required(input.campaignId));
    case "SEND_REPLY":
      return {
        ...(await sendApprovedReply(
          job.workspaceId,
          required(input.messageId),
        )),
        summary: "Approved reply accepted by the email provider.",
      };
    case "RECONCILE_MAIL":
      return {
        ...(await reconcileMessage(
          job.workspaceId,
          required(input.mailboxId),
          required(input.messageId),
        )),
        summary:
          "Sent-message reconciliation completed. Missing results never authorize automatic resending.",
      };
    case "SYNC_MAILBOX": {
      const result = await syncMailbox(
        job.workspaceId,
        required(input.mailboxId),
      );
      const organization = await db.platformOrganization.findUniqueOrThrow({
        where: { workspaceId: job.workspaceId },
      });
      if (organization.encryptedAiKey) {
        const messages = await db.platformMailMessage.findMany({
          where: {
            workspaceId: job.workspaceId,
            direction: "INBOUND",
            classificationExplanation: { startsWith: "Provisional" },
          },
          select: { id: true },
          take: 20,
        });
        for (const message of messages)
          await enqueueJob(
            job.workspaceId,
            null,
            "CLASSIFY_REPLY",
            { messageId: message.id },
            `ai-reply:${message.id}`,
          );
      }
      return {
        ...result,
        summary: `Mailbox synchronized: ${result.recorded} new events.`,
      };
    }
    case "REPORT": {
      const report = await reportData(job.workspaceId, {
        days:
          z
            .object({ period: z.enum(["DAILY", "WEEKLY"]).optional() })
            .parse(job.payload).period === "WEEKLY"
            ? 7
            : 1,
      });
      await notice(
        job.workspaceId,
        job.id,
        "REPORT_READY",
        "Your performance report is ready",
        "Open Analytics to review your recorded lead and outreach performance.",
      );
      return {
        summary: "Performance report generated from actual records.",
        report,
      };
    }
    default:
      throw new HttpError(400, "Unknown background operation");
  }
}
export async function processOneJob(workspaceId?: string) {
  await controlDb.platformJob.updateMany({
    where: {
      workspaceId,
      status: { in: ["RUNNING", "WAITING_AUTOMATION"] },
      leaseUntil: { lt: new Date() },
    },
    data: {
      status: "REVIEW_REQUIRED",
      error:
        "Execution lease expired. Inspect provider and workflow activity before retrying.",
    },
  });
  const job = await controlDb.$transaction(async (tx) => {
    const records = await tx.$queryRaw<
      { id: string }[]
    >`SELECT j.id FROM "PlatformJob" j JOIN "Workspace" w ON w.id=j."workspaceId" WHERE j.status='READY' AND j."runAt"<=CURRENT_TIMESTAMP AND w.status='ACTIVE' AND (${workspaceId ?? null}::text IS NULL OR j."workspaceId"=${workspaceId ?? null}) ORDER BY j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
    if (!records[0]) return null;
    return tx.platformJob.update({
      where: { id: records[0].id },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        leaseUntil: new Date(Date.now() + 20 * 60000),
        error: null,
      },
    });
  });
  if (!job) return false;
  await withTenantDatabase(job.workspaceId, async () => {
    try {
      const result = await performJob(job);
      await db.$transaction(async (tx) => {
        await tx.platformJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            result: JSON.parse(
              JSON.stringify(result),
            ) as Prisma.InputJsonObject,
            completedAt: new Date(),
            leaseUntil: null,
          },
        });
        await tx.platformActivity.create({
          data: {
            workspaceId: job.workspaceId,
            actorId: job.actorId,
            kind: job.kind,
            detail: result.summary,
          },
        });
      });
    } catch (error) {
      if (error instanceof MailDeferredError) {
        await db.platformJob.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            runAt: error.retryAt,
            leaseUntil: null,
            error: error.message,
          },
        });
        if (/allowance|limit/.test(error.message))
          await notice(
            job.workspaceId,
            `limit:${new Date().toISOString().slice(0, 10)}`,
            "SENDING_LIMIT",
            "Sending limit reached",
            "Remaining messages will wait for the next eligible sending period.",
          );
        return;
      }
      const message =
        error instanceof HttpError
          ? error.message
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "Background operation failed";
      await db.platformJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: message,
          completedAt: new Date(),
          leaseUntil: null,
        },
      });
      await notice(
        job.workspaceId,
        `failed:${job.id}`,
        "AUTOMATION_FAILED",
        "An operation needs attention",
        message,
        "WARNING",
      );
    }
  });
  return true;
}
export async function scheduleJobs() {
  if (!orchestrationConfig()) return;
  const organizations = await controlDb.platformOrganization.findMany({
    where: { workspace: { status: "ACTIVE" } },
    select: { workspaceId: true },
  });
  const minute = Math.floor(Date.now() / 60000),
    today = new Date().toISOString().slice(0, 10);
  for (const organization of organizations)
    await withTenantDatabase(organization.workspaceId, async () => {
      const mailboxes = await db.platformMailbox.findMany({
        where: { status: { in: ["CONNECTED", "LIVE_ENABLED"] } },
        select: { id: true },
      });
      for (const mailbox of mailboxes)
        if (
          !(await db.platformJob.count({
            where: {
              kind: "SYNC_MAILBOX",
              status: {
                in: ["QUEUED", "WAITING_AUTOMATION", "READY", "RUNNING"],
              },
              payload: { path: ["mailboxId"], equals: mailbox.id },
            },
          }))
        )
          await enqueueJob(
            organization.workspaceId,
            null,
            "SYNC_MAILBOX",
            { mailboxId: mailbox.id },
            `sync:${mailbox.id}:${minute}`,
          );
      if (process.env.LIVE_EMAIL_ENABLED === "true") {
        const campaigns = await db.platformCampaign.findMany({
          where: {
            status: "RUNNING",
            OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
          },
          select: { id: true },
        });
        for (const campaign of campaigns)
          if (
            !(await db.platformJob.count({
              where: {
                kind: "SEND_CAMPAIGN",
                status: {
                  in: ["QUEUED", "WAITING_AUTOMATION", "READY", "RUNNING"],
                },
                payload: { path: ["campaignId"], equals: campaign.id },
              },
            }))
          )
            await enqueueJob(
              organization.workspaceId,
              null,
              "SEND_CAMPAIGN",
              { campaignId: campaign.id },
              `send:${campaign.id}:${minute}`,
            );
      }
      await enqueueJob(
        organization.workspaceId,
        null,
        "REPORT",
        { period: "DAILY" },
        `daily:${today}`,
      );
      if (new Date().getUTCDay() === 1)
        await enqueueJob(
          organization.workspaceId,
          null,
          "REPORT",
          { period: "WEEKLY" },
          `weekly:${today}`,
        );
    });
}
export async function workerTick() {
  await scheduleJobs();
  for (let i = 0; i < 10; i++) if (!(await dispatchOneJob())) break;
  for (let i = 0; i < 5; i++) if (!(await processOneJob())) break;
}
