import { z } from "zod";
import type { PlatformAssistantAction } from "@prisma/client";
import { controlDb, db } from "@/lib/db";
import { currentUser, HttpError, rateLimit } from "@/lib/auth";
import { decrypt, encrypt, hash } from "@/lib/security";
import { createClientLogin } from "../client-access";
import {
  organizationAccess,
  writeResource,
  leadSendBlocker,
  minimumQualificationScore,
} from "../core";
import { enqueueJob } from "../jobs";
import { senderAllowed } from "../mail/domain";
import { campaignReviewData } from "../mail/review";
import { verificationConfigured } from "../research/verification";
import { isSendingProvider, sendingProviders } from "../mail/provider";
import {
  assistantToolSchemas,
  requireUserEmail,
  type AssistantToolName,
} from "./tools";
import { safeAssistantText } from "./claude";
import { assertAssistantClientScope } from "./context";

export async function assistantAdmin() {
  const user = await currentUser();
  if (!user.agencyAdmin)
    throw new HttpError(403, "Platform administrator required");
  return user;
}
export const actionSummary = (action: PlatformAssistantAction) => ({
  id: action.id,
  runId: action.runId,
  type: action.type,
  summary: action.summary,
  status: action.status,
  targetBusinessId: action.targetBusinessId,
  error: action.error,
  createdAt: action.createdAt,
  expiresAt: action.expiresAt,
});
export function safeActionError(error: unknown) {
  return error instanceof HttpError || error instanceof z.ZodError
    ? safeAssistantText(error.message).slice(0, 1000)
    : "The action did not complete. Check its status before repeating the command.";
}
export async function prepareCampaignReview(
  workspaceId: string,
  campaignId: string,
) {
  const { organization, workspace } = await organizationAccess(
    workspaceId,
    true,
  );
  const campaign = await db.platformCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: { include: { lead: true } } },
  });
  if (!campaign) throw new HttpError(404, "Campaign not found");
  if (campaign.purpose === "PERMISSION_REQUEST")
    throw new HttpError(
      400,
      "Review and launch permission requests from the business Campaigns page.",
    );
  if (campaign.recipients.length > 100)
    throw new HttpError(
      400,
      "Review campaigns with more than 100 recipients from the business Campaigns page.",
    );
  const mailbox = campaign.mailboxId
    ? await db.platformMailbox.findUnique({
        where: { id: campaign.mailboxId },
        select: { id: true, email: true, provider: true, status: true },
      })
    : null;
  const preview = campaignReviewData(campaign, organization, mailbox);
  const blockers: string[] = [];
  if (process.env.LIVE_EMAIL_ENABLED !== "true")
    blockers.push("Live email sending is disabled in platform settings.");
  if (!organization.profileApprovedAt)
    blockers.push("The business profile and target market need approval.");
  if (
    !mailbox ||
    mailbox.status !== "LIVE_ENABLED" ||
    !isSendingProvider(mailbox.provider) ||
    !senderAllowed(mailbox.email, organization)
  )
    blockers.push(
      "Connect and activate this business's own domain-matched sending mailbox.",
    );
  if (!["DRAFT", "PAUSED", "APPROVED"].includes(campaign.status))
    blockers.push("This campaign is already running or finished.");
  if (campaign.safetyPausedAt)
    blockers.push("This campaign is held for a sending safety review.");
  if (
    !campaign.recipients.some((recipient) =>
      ["QUEUED", "PENDING"].includes(recipient.status),
    )
  )
    blockers.push("There are no pending recipients.");
  const subscription = await db.platformSubscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (
    !subscription ||
    !["ACTIVE", "TRIAL"].includes(subscription.status) ||
    (subscription.periodEnd && subscription.periodEnd < new Date()) ||
    subscription.plan.dailyEmails < 1
  )
    blockers.push("An active sending plan or trial is required.");
  const suppressed = new Set(
    (
      await db.platformMailSuppression.findMany({ select: { email: true } })
    ).map((item) => item.email.toLowerCase()),
  );
  for (const recipient of campaign.recipients.filter((item) =>
    ["QUEUED", "PENDING"].includes(item.status),
  )) {
    const blocker = leadSendBlocker(
      recipient.lead,
      minimumQualificationScore(organization.qualificationCriteria),
    );
    if (blocker) blockers.push(`${recipient.lead.company}: ${blocker}`);
    if (
      recipient.lead.email &&
      suppressed.has(recipient.lead.email.toLowerCase())
    )
      blockers.push(`${recipient.lead.company}: this address is suppressed.`);
  }
  return {
    ...preview,
    businessName: workspace.name,
    timezone: workspace.timezone,
    status: campaign.status,
    blockers: [...new Set(blockers)],
    footer:
      "Monettic adds the client's signed unsubscribe link when preparing each message for delivery.",
  };
}
export async function executeAssistantTool(
  runId: string,
  name: string,
  raw: unknown,
  userMessages: string[],
) {
  const admin = await assistantAdmin();
  if (!Object.hasOwn(assistantToolSchemas, name))
    throw new HttpError(400, "This assistant tool is not available.");
  const tool = name as AssistantToolName;
  const input = assistantToolSchemas[tool].parse(raw);
  const run = await controlDb.platformAssistantRun.findFirst({
    where: { id: runId, actorId: admin.id, status: "RUNNING" },
  });
  if (!run)
    throw new HttpError(409, "This assistant request is no longer active.");
  assertAssistantClientScope(decrypt(run.encryptedInput), input);
  if (tool === "list_clients") {
    return {
      clients: (
        await controlDb.platformOrganization.findMany({
          where: { onboardingStatus: { not: "DEMO" } },
          select: {
            workspaceId: true,
            websiteUrl: true,
            workspace: { select: { name: true, status: true } },
          },
          take: 100,
          orderBy: { createdAt: "desc" },
        })
      ).map((item) => ({
        workspaceId: item.workspaceId,
        name: item.workspace.name,
        status: item.workspace.status,
        website: item.websiteUrl,
      })),
    };
  }
  if ("workspaceId" in input && input.workspaceId)
    await organizationAccess(input.workspaceId, true);
  if (tool === "get_business") {
    const values = assistantToolSchemas.get_business.parse(input);
    const { organization, workspace } = await organizationAccess(
      values.workspaceId,
      true,
    );
    const [mailboxes, leads, campaigns, subscription] = await Promise.all([
      db.platformMailbox.findMany({
        select: { id: true, email: true, provider: true, status: true },
      }),
      db.platformLead.count(),
      db.platformCampaign.count(),
      db.platformSubscription.findUnique({
        where: { workspaceId: values.workspaceId },
        select: {
          status: true,
          periodEnd: true,
          plan: { select: { name: true, dailyEmails: true } },
        },
      }),
    ]);
    return {
      workspaceId: values.workspaceId,
      name: workspace.name,
      website: organization.websiteUrl,
      profile: organization.profile,
      targeting: organization.targetCriteria,
      profileApproved: Boolean(organization.profileApprovedAt),
      connections: {
        searchConfigured: Boolean(organization.encryptedSearchKey),
        businessResearchAiConfigured: Boolean(organization.encryptedAiKey),
        liveEmailEnabled: process.env.LIVE_EMAIL_ENABLED === "true",
      },
      mailboxes,
      leads,
      campaigns,
      subscription,
      websiteVisitorTracking: "Not connected",
    };
  }
  if (tool === "list_leads") {
    const values = assistantToolSchemas.list_leads.parse(input);
    return {
      total: await db.platformLead.count({
        where: { status: { not: "ARCHIVED" } },
      }),
      leads: await db.platformLead.findMany({
        where: {
          status: { not: "ARCHIVED" },
          ...(values.search
            ? {
                OR: [
                  { company: { contains: values.search, mode: "insensitive" } },
                  {
                    industry: { contains: values.search, mode: "insensitive" },
                  },
                  {
                    location: { contains: values.search, mode: "insensitive" },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          company: true,
          name: true,
          email: true,
          industry: true,
          location: true,
          eligibility: true,
          verificationStatus: true,
          qualificationScore: true,
        },
        take: 30,
        orderBy: { createdAt: "desc" },
      }),
    };
  }
  if (tool === "list_campaigns")
    return {
      campaigns: await db.platformCampaign.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          subject: true,
          body: true,
          mailboxId: true,
          _count: { select: { recipients: true } },
        },
        take: 20,
        orderBy: { updatedAt: "desc" },
      }),
    };
  const inputHash = hash(JSON.stringify({ tool, input }));
  const old = await controlDb.platformAssistantAction.findUnique({
    where: { runId_inputHash: { runId, inputHash } },
  });
  if (old)
    return {
      actionId: old.id,
      status: old.status,
      summary: old.summary,
      error: old.error,
      message: "This command was already recorded; it was not executed again.",
    };
  if (
    (await controlDb.platformAssistantAction.count({ where: { runId } })) >= 4
  )
    throw new HttpError(
      429,
      "Four actions have been prepared in this request. Check them before asking for the next step.",
    );
  if (tool === "create_client") {
    const values = assistantToolSchemas.create_client.parse(input);
    try {
      requireUserEmail(values.email, userMessages);
    } catch {
      throw new HttpError(
        400,
        "Ask the administrator for the client's exact email address before creating the login.",
      );
    }
  }
  const workspaceId = "workspaceId" in input ? input.workspaceId : undefined;
  const action = await controlDb.platformAssistantAction.create({
    data: {
      runId,
      type: tool,
      targetBusinessId: workspaceId,
      inputHash,
      encryptedInput: encrypt(JSON.stringify(input)),
      summary:
        tool === "create_client"
          ? "Create client portal login"
          : tool === "draft_campaign"
            ? "Prepare campaign"
            : tool === "pause_campaign"
              ? "Pause campaign"
              : tool === "prepare_campaign_launch"
                ? "Review campaign emails before sending"
                : "Queue business research",
    },
  });
  try {
    let result: unknown;
    if (tool === "create_client") {
      const created = await createClientLogin(input, action.id);
      return {
        actionId: action.id,
        status: "SUCCEEDED",
        client: created.client,
        workspace: created.workspace,
        message:
          "Client login created. The administrator can view the generated login in the private action card. The password is not available to the AI.",
      };
    } else if (tool === "draft_campaign") {
      const values = assistantToolSchemas.draft_campaign.parse(input);
      if (!/\b(?:opt.?out|unsubscribe|stop|remove)\b/i.test(values.body))
        throw new HttpError(
          400,
          "Include a clear opt-out sentence in the draft email.",
        );
      const saved = await writeResource(
        values.workspaceId,
        "campaigns",
        {
          action: values.campaignId ? "update" : "create",
          ...(values.campaignId ? { id: values.campaignId } : {}),
          name: values.name,
          subject: values.subject,
          body: values.body,
          leadIds: values.leadIds,
          ...(values.mailboxId ? { mailboxId: values.mailboxId } : {}),
          target: {
            niche: values.niche || "",
            location: values.location || "",
          },
          dailyLimit: values.dailyLimit,
          steps: values.steps,
        },
        { idempotencyKey: action.id },
      );
      result = {
        campaignId: saved.id,
        name: saved.name,
        status: saved.status,
        recipients: values.leadIds.length,
        message:
          "Draft saved in the real business workspace. No emails were approved or sent.",
      };
    } else if (tool === "pause_campaign") {
      const values = assistantToolSchemas.pause_campaign.parse(input);
      const saved = await writeResource(
        values.workspaceId,
        "campaigns",
        { action: "pause", id: values.campaignId },
        { idempotencyKey: action.id },
      );
      result = { campaignId: saved.id, status: saved.status };
    } else if (tool === "prepare_campaign_launch") {
      const values = assistantToolSchemas.prepare_campaign_launch.parse(input);
      const review = await prepareCampaignReview(
        values.workspaceId,
        values.campaignId,
      );
      await controlDb.platformAssistantAction.update({
        where: { id: action.id },
        data: {
          status: "REVIEW_REQUIRED",
          encryptedResult: encrypt(JSON.stringify(review)),
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      return {
        actionId: action.id,
        status: "REVIEW_REQUIRED",
        business: review.businessName,
        campaign: review.name,
        recipients: review.recipients.length,
        blockers: review.blockers,
        message:
          "A private review is ready. No email has been approved or sent; the administrator must review the sender, recipients and messages in the dashboard.",
      };
    } else {
      let kind: string, payload: Record<string, string | number>;
      const { organization } = await organizationAccess(workspaceId!, true);
      if (tool === "discover_leads") {
        const values = assistantToolSchemas.discover_leads.parse(input);
        if (
          !organization.profileApprovedAt ||
          !organization.targetCriteria ||
          !organization.encryptedSearchKey
        )
          throw new HttpError(
            409,
            "Approve the business profile and target market, and connect this business's Brave Search key before discovery.",
          );
        kind = "DISCOVER";
        payload = {
          industry: values.niche,
          location: values.location,
          maxResults: values.maxResults,
        };
      } else {
        const values = assistantToolSchemas.queue_research.parse(input);
        kind = values.task;
        payload = {};
        if (
          ["ANALYZE_WEBSITE", "QUALIFY", "DRAFT_EMAIL"].includes(kind) &&
          !organization.encryptedAiKey
        )
          throw new HttpError(
            409,
            "Connect this business's research AI key first. Claude chat is a separate connection.",
          );
        if (kind === "ANALYZE_WEBSITE" && !organization.websiteUrl)
          throw new HttpError(409, "Connect the company's real website first.");
        if (
          ["RESEARCH_LEAD", "QUALIFY", "VERIFY_EMAIL", "DRAFT_EMAIL"].includes(
            kind,
          )
        ) {
          if (
            !values.leadId ||
            !(await db.platformLead.findFirst({
              where: { id: values.leadId, status: { not: "ARCHIVED" } },
              select: { id: true },
            }))
          )
            throw new HttpError(
              404,
              "Choose an existing lead in this business.",
            );
          payload.leadId = values.leadId;
        }
        if (kind === "VERIFY_EMAIL" && !verificationConfigured())
          throw new HttpError(
            409,
            "The email verification provider is not connected.",
          );
        if (kind === "SYNC_MAILBOX") {
          if (
            !values.mailboxId ||
            !(await db.platformMailbox.findFirst({
              where: {
                id: values.mailboxId,
                provider: { in: [...sendingProviders] },
                status: { in: ["CONNECTED", "LIVE_ENABLED"] },
              },
              select: { id: true },
            }))
          )
            throw new HttpError(409, "Connect this business's mailbox first.");
          payload.mailboxId = values.mailboxId;
        }
      }
      const job = await enqueueJob(
        workspaceId!,
        admin.id,
        kind,
        payload,
        `assistant:${action.id}`,
      );
      result = {
        jobId: job.id,
        kind: job.kind,
        status: job.status,
        message:
          "Queued for the automation worker. This has not completed yet; the local worker must be running.",
      };
    }
    await controlDb.platformAssistantAction.update({
      where: { id: action.id },
      data: {
        status: "SUCCEEDED",
        encryptedResult: encrypt(JSON.stringify(result)),
        completedAt: new Date(),
      },
    });
    return { actionId: action.id, status: "SUCCEEDED", result };
  } catch (error) {
    const status =
      error instanceof HttpError || error instanceof z.ZodError
        ? "FAILED"
        : "REVIEW_REQUIRED";
    await controlDb.platformAssistantAction.updateMany({
      where: { id: action.id, status: "EXECUTING" },
      data: { status, error: safeActionError(error), completedAt: new Date() },
    });
    return { actionId: action.id, status, error: safeActionError(error) };
  }
}

export async function assistantAction(
  id: string,
  operation: "credentials" | "review" | "launch",
) {
  const admin = await assistantAdmin();
  await rateLimit(`assistant-action:${admin.id}`, 40, 60);
  const action = await controlDb.platformAssistantAction.findFirst({
    where: { id, run: { actorId: admin.id } },
  });
  if (!action) throw new HttpError(404, "Assistant action not found");
  if (operation === "credentials") {
    if (
      action.type !== "create_client" ||
      action.status !== "SUCCEEDED" ||
      !action.encryptedResult ||
      !action.expiresAt ||
      action.expiresAt < new Date()
    )
      throw new HttpError(
        410,
        "The private login details are no longer available here. Use the account's password recovery if needed.",
      );
    const result = JSON.parse(decrypt(action.encryptedResult));
    return {
      login: result.login,
      client: result.client,
      workspace: result.workspace,
    };
  }
  if (action.type !== "prepare_campaign_launch" || !action.encryptedResult)
    throw new HttpError(400, "This action has no campaign review.");
  const values = assistantToolSchemas.prepare_campaign_launch.parse(
    JSON.parse(decrypt(action.encryptedInput)),
  );
  await organizationAccess(values.workspaceId, true);
  if (operation === "review")
    return {
      action: actionSummary(action),
      review: JSON.parse(decrypt(action.encryptedResult)),
    };
  if (!action.expiresAt || action.expiresAt < new Date())
    throw new HttpError(
      410,
      "This email review expired. Ask the assistant to prepare a fresh review.",
    );
  if (action.status !== "REVIEW_REQUIRED" || action.error)
    throw new HttpError(
      409,
      "This review cannot be launched again. Check the campaign's actual status.",
    );
  const review = JSON.parse(decrypt(action.encryptedResult)) as Awaited<
    ReturnType<typeof prepareCampaignReview>
  >;
  const current = await prepareCampaignReview(
    values.workspaceId,
    values.campaignId,
  );
  if (current.fingerprint !== review.fingerprint)
    throw new HttpError(
      409,
      "The campaign changed. Prepare a fresh email review.",
    );
  if (current.blockers.length)
    throw new HttpError(409, current.blockers.join(" ").slice(0, 2000));
  const claim = await controlDb.platformAssistantAction.updateMany({
    where: { id, status: "REVIEW_REQUIRED", error: null },
    data: { status: "EXECUTING" },
  });
  if (claim.count !== 1)
    throw new HttpError(409, "This launch is already being processed.");
  try {
    await writeResource(
      values.workspaceId,
      "campaigns",
      { action: "approve", id: values.campaignId },
      {
        idempotencyKey: `${id}:approve`,
        campaignReviewHash: review.fingerprint,
      },
    );
    const started = await writeResource(
      values.workspaceId,
      "campaigns",
      { action: "start", id: values.campaignId },
      { idempotencyKey: `${id}:start`, campaignReviewHash: review.fingerprint },
    );
    await controlDb.platformAssistantAction.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        summary: "Campaign launched after your email review",
        completedAt: new Date(),
      },
    });
    return {
      status: started.status,
      campaignId: started.id,
      jobId: started.job?.id,
      message:
        "Campaign started and queued for the worker. Sending and delivery results appear after the provider processes the messages.",
    };
  } catch (error) {
    await controlDb.platformAssistantAction.update({
      where: { id },
      data: {
        status: "FAILED",
        error: safeActionError(error),
        completedAt: new Date(),
      },
    });
    throw new HttpError(
      error instanceof HttpError ? error.status : 500,
      safeActionError(error),
    );
  }
}
