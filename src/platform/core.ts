import { Prisma, type PlatformLead } from "@prisma/client";
import { z } from "zod";
import { controlDb, db } from "@/lib/db";
import { currentUser, HttpError, tenant } from "@/lib/auth";
import { personalize, encrypt, decrypt, hash } from "@/lib/security";
import { campaignReviewData } from "./mail/review";
import { personalizeFollowup, unfilledEmailFields } from "./mail/content";
import { enqueueJob } from "./jobs";
import { senderMatchesWebsite } from "./mail/domain";
import { isSendingProvider } from "./mail/provider";
import { verificationConfigured } from "./research/verification";
import {
  campaignPurposes,
  permissionAskedLeadIds,
  permissionRequestBlocker,
  replyBlocksOutreach,
  withPermissionNotice,
} from "./mail/permission";
import { databaseContext } from "@/lib/tenancy";

export async function organizationAccess(
  workspaceId: string,
  manage = false,
  audience: "operations" | "client" = "operations",
) {
  const access = await tenant(workspaceId, manage);
  if (!access.user.agencyAdmin && access.user.staffRole === "CALLER") throw new HttpError(403, "Use your Monettic calling workspace for prospects, calls and meetings.");
  // A demo administrator may read the operator screens of a demo business only; tenant() already
  // refuses every write because DEMO_ADMIN cannot manage.
  const demoOperator =
    !access.user.agencyAdmin && access.role === "DEMO_ADMIN" && !manage;
  if (audience === "operations" && !access.user.agencyAdmin && !demoOperator)
    throw new HttpError(
      403,
      "Your client portal provides access to results. Workspace operations are managed by your account team.",
    );
  const organization = await db.platformOrganization.findUnique({
    where: { workspaceId },
  });
  if (!organization) throw new HttpError(404, "Organization not found");
  if (demoOperator && organization.onboardingStatus !== "DEMO")
    throw new HttpError(403, "Demo access only covers the demo business.");
  if (manage && organization.onboardingStatus === "DEMO")
    throw new HttpError(
      403,
      "This demo workspace is read-only. No emails can be sent.",
    );
  return { ...access, organization };
}

const website = z.union([z.url().max(2048), z.literal("")]).default("");
export const organizationInput = z.object({
  name: z.string().trim().min(2).max(160),
  timezone: z.string().max(100).default("Africa/Johannesburg"),
  websiteUrl: website,
});
type OrganizationInput = z.input<typeof organizationInput>;
type Actor = { id: string; name?: string; email?: string };

export async function createOrganizationInTransaction(
  transaction: Prisma.TransactionClient,
  user: Actor,
  input: OrganizationInput,
  activityActorId = user.id,
) {
  const data = organizationInput.parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.timezone });
  } catch {
    throw new HttpError(400, "Invalid timezone");
  }
  if (data.websiteUrl && new URL(data.websiteUrl).protocol !== "https:")
    throw new HttpError(400, "Use an HTTPS business website");
  const workspace = await transaction.workspace.create({
    data: {
      name: data.name,
      timezone: data.timezone,
      memberships: { create: { userId: user.id, role: "CLIENT_VIEWER" } },
    },
  });
  const organization = await transaction.platformOrganization.create({
    data: { workspaceId: workspace.id, websiteUrl: data.websiteUrl },
  });
  await transaction.platformSubscription.create({
    data: {
      workspaceId: workspace.id,
      planId: "TRIAL14",
      status: "TRIAL",
      periodEnd: new Date(Date.now() + 14 * 86400_000),
    },
  });
  await transaction.platformActivity.create({
    data: {
      workspaceId: workspace.id,
      actorId: activityActorId,
      kind: "ORGANIZATION_CREATED",
      detail: "Independent business account created",
    },
  });
  return {
    ...organization,
    name: workspace.name,
    timezone: workspace.timezone,
    status: workspace.status,
  };
}

export async function platformSession() {
  const user = await currentUser();
  const organizations = await controlDb.platformOrganization.findMany({
    where: user.agencyAdmin
      ? {}
      : { workspace: { memberships: { some: { userId: user.id } } } },
    select: {
      workspaceId: true,
      websiteUrl: true,
      onboardingStatus: true,
      profileApprovedAt: true,
      workspace: {
        select: {
          name: true,
          timezone: true,
          status: true,
          memberships: { where: { userId: user.id }, select: { role: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    user: { ...user, superAdmin: user.agencyAdmin },
    organizations: organizations.map(({ workspace, ...organization }) => ({
      ...(user.staffRole === "CALLER" && !user.agencyAdmin ? { workspaceId: organization.workspaceId } : organization),
      name: user.staffRole === "CALLER" && !user.agencyAdmin ? "Monettic" : workspace.name,
      timezone: workspace.timezone,
      status: workspace.status,
      role: user.agencyAdmin ? "AGENCY_ADMIN" : workspace.memberships[0]?.role,
      isDemo: organization.onboardingStatus === "DEMO",
    })),
  };
}

const email = z
  .email()
  .max(320)
  .transform((value) => value.toLowerCase().trim())
  .nullable();
const leadFields = z.object({
  company: z.string().trim().min(1).max(240),
  name: z.string().trim().max(160).default(""),
  email: email.optional(),
  phone: z.string().max(80).default(""),
  industry: z.string().max(160).default(""),
  location: z.string().max(240).default(""),
  website,
  sourceUrl: website,
  sourceKind: z
    .enum(["MANUAL", "CSV", "PUBLIC_WEB", "WEBSITE_ENQUIRY"])
    .default("MANUAL"),
  contactRole: z.string().max(160).default(""),
  notes: z.string().max(20_000).default(""),
  status: z
    .enum([
      "NEW",
      "QUALIFIED",
      "OUTREACH_SCHEDULED",
      "CONTACTED",
      "REPLIED",
      "INTERESTED",
      "MEETING_BOOKED",
      "CONVERTED",
      "NOT_INTERESTED",
      "UNQUALIFIED",
      "UNSUBSCRIBED",
    ])
    .default("NEW"),
  ownerId: z.string().max(100).nullable().optional(),
  eligibility: z
    .enum(["UNKNOWN", "CONSENTED", "SUPPRESSED"])
    .default("UNKNOWN"),
  consentSource: z.string().trim().max(1000).nullable().optional(),
  consentAt: z.iso.datetime().nullable().optional(),
  draftSubject: z
    .string()
    .max(998)
    .refine((value) => !/[\r\n]/.test(value), "Subject must be one line")
    .default(""),
  draftBody: z.string().max(50_000).default(""),
});
const subject = z
  .string()
  .trim()
  .min(1)
  .max(998)
  .refine((value) => !/[\r\n]/.test(value), "Subject must be one line");
const body = z.string().trim().min(1).max(50_000);
const step = z.object({
  delayDays: z.number().int().min(1).max(365),
  subject,
  body,
});
const campaignFields = z.object({
  name: z.string().trim().min(2).max(160),
  subject: subject.optional(),
  body: body.optional(),
  mailboxId: z.string().max(100).nullable().optional(),
  templateId: z.string().max(100).nullable().optional(),
  leadIds: z.array(z.string().max(100)).max(1000).default([]),
  steps: z.array(step).max(8).default([]),
  target: z.record(z.string(), z.json()).default({}),
  // No default: Zod applies defaults inside partial updates, which would silently reset it.
  purpose: z.enum(campaignPurposes).optional(),
  dailyLimit: z.number().int().min(1).max(10000).default(25),
  scheduledAt: z.iso.datetime().nullable().optional(),
  sendStartHour: z.number().int().min(0).max(23).default(8),
  sendEndHour: z.number().int().min(1).max(24).default(17),
  sendWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5]),
});
const templateFields = z.object({
  name: z.string().trim().min(2).max(160),
  subject,
  body,
  category: z.enum(["OUTREACH", "FOLLOW_UP", "REPLY"]).default("OUTREACH"),
});

async function composeCampaignReview(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  input: unknown,
) {
  const values = campaignFields.parse(input);
  if (!values.subject || !values.body)
    throw new HttpError(400, "Campaign subject and message are required");
  if (new Set(values.leadIds).size !== values.leadIds.length)
    throw new HttpError(400, "Choose each lead only once");
  if (values.sendStartHour === values.sendEndHour)
    throw new HttpError(400, "Sending start and end hours must differ");
  const permissionRequest = values.purpose === "PERMISSION_REQUEST";
  if (permissionRequest && values.steps.length)
    throw new HttpError(
      400,
      "A permission request is a single email. Remove the follow-ups; POPIA allows only one request.",
    );
  const [organization, mailbox, leads, subscription, suppressions, workspace] =
    await Promise.all([
      transaction.platformOrganization.findUniqueOrThrow({
        where: { workspaceId },
      }),
      values.mailboxId
        ? transaction.platformMailbox.findUnique({
            where: { id: values.mailboxId },
          })
        : null,
      transaction.platformLead.findMany({
        where: { id: { in: values.leadIds }, status: { not: "ARCHIVED" } },
        orderBy: { id: "asc" },
      }),
      transaction.platformSubscription.findUnique({
        where: { workspaceId },
        include: { plan: true },
      }),
      transaction.platformMailSuppression.findMany({ select: { email: true } }),
      transaction.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { timezone: true, name: true },
      }),
    ]);
  if (leads.length !== values.leadIds.length)
    throw new HttpError(
      400,
      "One or more leads do not belong to this business",
    );
  if (values.mailboxId && !mailbox)
    throw new HttpError(400, "Mailbox does not belong to this business");
  const blockers: { message: string; view: string; leadId?: string }[] = [];
  if (process.env.LIVE_EMAIL_ENABLED !== "true")
    blockers.push({
      message: "Live campaign sending has not been enabled on the platform.",
      view: "mailboxes",
    });
  if (!organization.profileApprovedAt)
    blockers.push({
      message: "Review and approve the business profile and targeting.",
      view: "business",
    });
  if (
    !mailbox ||
    mailbox.status !== "LIVE_ENABLED" ||
    !isSendingProvider(mailbox.provider) ||
    !senderMatchesWebsite(mailbox.email, [organization.websiteUrl])
  )
    blockers.push({
      message: "Connect and activate this client's own sending mailbox.",
      view: "mailboxes",
    });
  if (
    !subscription ||
    !["ACTIVE", "TRIAL"].includes(subscription.status) ||
    (subscription.periodEnd && subscription.periodEnd < new Date()) ||
    subscription.plan.dailyEmails < 1
  )
    blockers.push({
      message: "An active plan or trial with email sending is required.",
      view: "billing",
    });
  if (!leads.length)
    blockers.push({
      message:
        "Select at least one eligible recipient. Add and qualify leads if this list is empty.",
      view: "leads",
    });
  const suppressed = new Set(
    suppressions.map((entry) => entry.email.toLowerCase()),
  );
  const minimum = minimumQualificationScore(organization.qualificationCriteria);
  const asked = permissionRequest
    ? await permissionAskedLeadIds(transaction, values.leadIds)
    : new Set<string>();
  const recipients = leads.map((lead) => {
    const reason = permissionRequest
      ? permissionRequestBlocker(lead, minimum, asked.has(lead.id))
      : leadSendBlocker(lead, minimum);
    if (reason)
      blockers.push({
        message: `${lead.company}: ${reason}`,
        view: "leads",
        leadId: lead.id,
      });
    if (lead.email && suppressed.has(lead.email.toLowerCase()))
      blockers.push({
        message: `${lead.company}: this address is suppressed.`,
        view: "leads",
        leadId: lead.id,
      });
    const contact = {
      name: lead.name,
      company: lead.company,
      email: lead.email || "",
    };
    const subject = personalize(values.subject!, contact);
    const personalized = personalize(values.body!, contact);
    const body = permissionRequest
      ? withPermissionNotice(personalized, workspace.name)
      : personalized;
    const steps = values.steps.map((step) => ({
      ...step,
      subject: personalizeFollowup(step.subject, lead),
      body: personalizeFollowup(step.body, lead),
    }));
    const missing = unfilledEmailFields(subject, body, ...steps.flatMap((step) => [step.subject, step.body]));
    if (missing.length)
      blockers.push({ message: `${lead.company}: fill in email fields ${missing.join(", ")} before launch.`, view: "campaigns" });
    return {
      leadId: lead.id,
      company: lead.company,
      email: lead.email,
      subject,
      body,
      steps,
    };
  });
  const preview = {
    purpose: values.purpose ?? "OUTREACH",
    sender: mailbox?.email || null,
    timezone: workspace.timezone,
    recipients,
    blockers,
    scheduledAt: values.scheduledAt,
    sendStartHour: values.sendStartHour,
    sendEndHour: values.sendEndHour,
    dailyLimit: values.dailyLimit,
  };
  return {
    ...preview,
    fingerprint: hash(
      JSON.stringify({
        workspaceId,
        values,
        preview,
        profileApprovedAt: organization.profileApprovedAt,
        qualificationCriteria: organization.qualificationCriteria,
        mailboxStatus: mailbox?.status,
        leadEligibility: leads.map((lead) => ({
          id: lead.id,
          status: lead.status,
          eligibility: lead.eligibility,
          verificationStatus: lead.verificationStatus,
          verifiedAt: lead.verifiedAt,
          consentAt: lead.consentAt,
          consentSource: lead.consentSource,
          qualificationScore: lead.qualificationScore,
          repliedAt: lead.repliedAt,
          unsubscribedAt: lead.unsubscribedAt,
        })),
      }),
    ),
  };
}

export function minimumQualificationScore(criteria: Prisma.JsonValue) {
  const value =
    criteria && typeof criteria === "object" && !Array.isArray(criteria)
      ? criteria.minimumScore
      : undefined;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 70;
}

export function leadSendBlocker(
  lead: Pick<
    PlatformLead,
    | "status"
    | "email"
    | "verificationStatus"
    | "verifiedAt"
    | "qualificationScore"
    | "eligibility"
    | "consentSource"
    | "consentAt"
    | "repliedAt"
    | "unsubscribedAt"
  >,
  minimumScore: number,
  now = new Date(),
) {
  if (lead.status === "ARCHIVED") return "Lead is archived";
  if (!lead.email) return "Lead has no email address";
  if (
    lead.verificationStatus !== "VALID" ||
    !lead.verifiedAt ||
    lead.verifiedAt > now ||
    lead.verifiedAt.getTime() < now.getTime() - 30 * 86400_000
  )
    return "Lead needs recent valid email verification";
  if (
    lead.qualificationScore === null ||
    lead.qualificationScore < minimumScore
  )
    return "Lead does not meet the approved qualification threshold";
  if (
    lead.eligibility !== "CONSENTED" ||
    !lead.consentSource?.trim() ||
    !lead.consentAt ||
    lead.consentAt > now
  )
    return "Lead needs documented consent";
  if (replyBlocksOutreach(lead))
    return "Lead has replied; follow-ups are stopped";
  if (lead.unsubscribedAt) return "Lead has opted out";
  return null;
}

async function audit(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  kind: string,
  detail: string,
  extra?: { leadId?: string; campaignId?: string },
) {
  await transaction.platformActivity.create({
    data: { workspaceId, actorId, kind, detail, ...extra },
  });
}

export async function readResource(workspaceId: string, resource: string) {
  const { user, role, workspace, organization } =
    await organizationAccess(workspaceId);
  switch (resource) {
    case "leads":
      return {
        members: await db.membership.findMany({
          where: { workspaceId },
          select: { userId: true, user: { select: { name: true } } },
        }),
        items: await db.platformLead.findMany({
          where: { status: { not: "ARCHIVED" } },
          orderBy: { createdAt: "desc" },
          take: 1000,
        }),
      };
    case "campaigns":
      return {
        sending: {
          enabled: process.env.LIVE_EMAIL_ENABLED === "true",
          profileApproved: Boolean(organization.profileApprovedAt),
        },
        items: await db.platformCampaign.findMany({
          include: {
            _count: { select: { recipients: true } },
            recipients: {
              select: {
                leadId: true,
                status: true,
                step: true,
                approvedAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      };
    case "templates":
      return {
        items: await db.platformTemplate.findMany({
          orderBy: { updatedAt: "desc" },
          take: 500,
        }),
      };
    case "team":
      return {
        items: await db.membership.findMany({
          where: { workspaceId },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      };
    case "notifications":
      return {
        items: (
          await db.platformNotice.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
          })
        ).map((notice) => ({
          ...notice,
          readAt: notice.readBy.includes(user.id) ? notice.createdAt : null,
        })),
        userId: user.id,
      };
    case "activity":
      return {
        items: await db.platformActivity.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      };
    case "settings":
      return {
        name: workspace.name,
        timezone: workspace.timezone,
        websiteUrl: organization.websiteUrl,
        status: workspace.status,
        role,
        retentionDays: organization.retentionDays,
      };
    case "billing": {
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCHours(0, 0, 0, 0);
      return {
        subscription: await db.platformSubscription.findUnique({
          where: { workspaceId },
          include: { plan: true },
        }),
        plans: await db.platformPlan.findMany({
          where: { available: true },
          orderBy: { monthlyProspects: "asc" },
        }),
        usage: await db.platformUsage.groupBy({
          by: ["kind"],
          where: { createdAt: { gte: month } },
          _sum: { quantity: true },
        }),
        checkoutAvailable: false,
      };
    }
    default:
      throw new HttpError(404, "Unknown platform resource");
  }
}

export async function writeResource(
  workspaceId: string,
  resource: string,
  input: unknown,
  operation?: { idempotencyKey?: string; campaignReviewHash?: string },
) {
  const access = await organizationAccess(
    workspaceId,
    resource !== "notifications",
  );
  return mutateAuthorizedResource(access, resource, input, operation);
}

/** Internal mutation service. Authorization and a matching tenant capability
 * are mandatory; this is not an alternate HTTP authentication mechanism. */
export async function mutateAuthorizedResource(
  access: Awaited<ReturnType<typeof organizationAccess>>,
  resource: string,
  input: unknown,
  operation?: { idempotencyKey?: string; campaignReviewHash?: string },
) {
  const workspaceId = access.organization.workspaceId;
  const callerOperator =
    resource === "campaigns" &&
    access.user.staffRole === "CALLER" &&
    access.role === "CALLER" &&
    Boolean(
      (
        await controlDb.membership.findUnique({
          where: {
            workspaceId_userId: { workspaceId, userId: access.user.id },
          },
        })
      )?.callerCanSend,
    );
  if (
    (!access.user.agencyAdmin && !callerOperator) ||
    (access.role !== "AGENCY_ADMIN" && !callerOperator) ||
    access.workspace.id !== workspaceId ||
    access.workspace.status !== "ACTIVE" ||
    databaseContext()?.workspaceId !== workspaceId
  )
    throw new HttpError(
      403,
      "An authorized administrator and matching business context are required.",
    );
  const envelope = z
    .object({
      action: z.string().default("update"),
      id: z.string().max(100).optional(),
    })
    .parse(input);
  const { user, organization } = access;
  if (organization.onboardingStatus === "DEMO")
    throw new HttpError(
      403,
      "This demo workspace is read-only. No emails can be sent.",
    );
  if (resource === "leads" && envelope.action === "verify-all") {
    // Unverified or stale addresses only; a recent result is not paid for twice.
    const leads = await db.platformLead.findMany({
      where: {
        email: { not: null },
        status: { notIn: ["ARCHIVED", "UNSUBSCRIBED"] },
        OR: [
          { verifiedAt: null },
          { verifiedAt: { lt: new Date(Date.now() - 30 * 86400_000) } },
        ],
      },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    const day = new Date().toISOString().slice(0, 10);
    for (const lead of leads)
      await enqueueJob(
        workspaceId,
        user.id,
        "VERIFY_EMAIL",
        { leadId: lead.id },
        `verify-all:${lead.id}:${lead.email}:${day}`,
      );
    return { queued: leads.length, provider: verificationConfigured() };
  }
  if (
    resource === "leads" &&
    ["research", "qualify", "verify", "draft"].includes(envelope.action)
  ) {
    const leadId = z.string().min(1).parse(envelope.id);
    if (
      !(await db.platformLead.findFirst({
        where: { id: leadId, status: { not: "ARCHIVED" } },
      }))
    )
      throw new HttpError(404, "Lead not found");
    const kinds = {
      research: "RESEARCH_LEAD",
      qualify: "QUALIFY",
      verify: "VERIFY_EMAIL",
      draft: "DRAFT_EMAIL",
    } as const;
    return {
      job: await enqueueJob(
        workspaceId,
        user.id,
        kinds[envelope.action as keyof typeof kinds],
        { leadId },
      ),
    };
  }
  return db.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const organization =
      await transaction.platformOrganization.findUniqueOrThrow({
        where: { workspaceId },
      });
    const operationKey = operation?.idempotencyKey;
    const scopeHash = hash(
      JSON.stringify({
        resource,
        input,
        review: operation?.campaignReviewHash,
      }),
    );
    if (operationKey) {
      const receipt = await transaction.platformOperationReceipt.findUnique({
        where: { workspaceId_operationKey: { workspaceId, operationKey } },
      });
      if (receipt) {
        if (receipt.scopeHash !== scopeHash)
          throw new HttpError(
            409,
            "This action identifier was already used for a different request.",
          );
        return JSON.parse(decrypt(receipt.encryptedResult));
      }
    }
    const originalInput = input;
    const perform = async (input: unknown = originalInput): Promise<object> => {
      const envelope = z
        .object({
          action: z.string().default("update"),
          id: z.string().max(100).optional(),
        })
        .parse(input);
      if (resource === "leads") {
        if (envelope.action === "import") {
          const inputRows = z
            .object({ items: z.array(leadFields).min(1).max(100) })
            .parse(input).items;
          const imported = await transaction.platformLead.createMany({
            skipDuplicates: true,
            data: inputRows.map((row) => ({
              workspaceId,
              company: row.company,
              name: row.name,
              email: row.email,
              website: row.website,
              phone: row.phone,
              industry: row.industry,
              location: row.location,
              sourceKind: "CSV",
              eligibility: "UNKNOWN",
            })),
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "LEADS_IMPORTED",
            `${imported.count} CSV businesses imported without implied marketing consent`,
          );
          return {
            message: `${imported.count} businesses imported. ${inputRows.length - imported.count} duplicate addresses skipped. Review marketing permission before outreach.`,
          };
        }
        if (envelope.action === "delete" || envelope.action === "archive") {
          const lead = await transaction.platformLead.findUnique({
            where: { id: envelope.id || "" },
          });
          if (!lead) throw new HttpError(404, "Lead not found");
          if (lead.email)
            await transaction.platformMailSuppression.upsert({
              where: { workspaceId_email: { workspaceId, email: lead.email } },
              create: {
                workspaceId,
                email: lead.email,
                reason: "Lead archived by client",
              },
              update: {},
            });
          const archived = await transaction.platformLead.update({
            where: { id: lead.id },
            data: { status: "ARCHIVED", eligibility: "SUPPRESSED" },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "LEAD_ARCHIVED",
            lead.company,
            { leadId: lead.id },
          );
          return archived;
        }
        if (!["create", "update"].includes(envelope.action))
          throw new HttpError(400, "Unknown lead action");
        const existing =
          envelope.action === "update"
            ? await transaction.platformLead.findUnique({
                where: { id: envelope.id || "" },
              })
            : null;
        if (envelope.action === "update" && !existing)
          throw new HttpError(404, "Lead not found");
        const data =
          envelope.action === "create"
            ? leadFields.parse(input)
            : leadFields.partial().parse(input);
        if (
          data.ownerId &&
          !(await transaction.membership.findUnique({
            where: {
              workspaceId_userId: { workspaceId, userId: data.ownerId },
            },
          }))
        )
          throw new HttpError(400, "Owner must be a member of this business");
        const eligibility = data.eligibility ?? existing?.eligibility;
        const consentSource =
          data.consentSource === undefined
            ? existing?.consentSource
            : data.consentSource;
        const consentAt =
          data.consentAt === undefined
            ? existing?.consentAt
            : data.consentAt
              ? new Date(data.consentAt)
              : null;
        if (
          eligibility === "CONSENTED" &&
          (!consentSource?.trim() || !consentAt || consentAt > new Date())
        )
          throw new HttpError(
            400,
            "Document the actual consent source and date before marking consented",
          );
        const changingEmail =
          existing && data.email !== undefined && data.email !== existing.email;
        const converted = {
          ...data,
          consentAt,
          ...(data.status === "UNSUBSCRIBED"
            ? { eligibility: "SUPPRESSED", unsubscribedAt: new Date() }
            : {}),
          ...(changingEmail
            ? {
                eligibility: "UNKNOWN",
                consentSource: null,
                consentAt: null,
                verificationStatus: "UNKNOWN",
                verifiedAt: null,
                qualificationScore: null,
                qualificationCategory: null,
                qualificationExplanation: null,
                qualifiedAt: null,
                draftSubject: "",
                draftBody: "",
              }
            : {}),
        };
        const lead = existing
          ? await transaction.platformLead.update({
              where: { id: existing.id },
              data: converted,
            })
          : await transaction.platformLead.create({
              data: {
                ...leadFields.parse(input),
                ...converted,
                workspaceId,
                company: data.company!,
              },
            });
        if (
          existing &&
          Object.keys(data).some((key) => !["notes", "ownerId"].includes(key))
        ) {
          await transaction.platformCampaignRecipient.updateMany({
            where: { leadId: lead.id },
            data: { approvedAt: null, approvedBy: null },
          });
          await transaction.platformCampaign.updateMany({
            where: {
              recipients: { some: { leadId: lead.id } },
              status: { in: ["APPROVED", "RUNNING", "PAUSED"] },
            },
            data: { status: "PAUSED", approvedAt: null, approvedBy: null },
          });
        }
        await audit(
          transaction,
          workspaceId,
          user.id,
          existing ? "LEAD_UPDATED" : "LEAD_CREATED",
          lead.company,
          { leadId: lead.id },
        );
        return lead;
      }
      if (resource === "templates") {
        const existing =
          envelope.action !== "create"
            ? await transaction.platformTemplate.findUnique({
                where: { id: envelope.id || "" },
              })
            : null;
        if (envelope.action !== "create" && !existing)
          throw new HttpError(404, "Template not found");
        if (envelope.action === "approve") {
          const result = await transaction.platformTemplate.update({
            where: { id: existing!.id },
            data: {
              approvalStatus: "APPROVED",
              approvedAt: new Date(),
              approvedBy: user.id,
            },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "TEMPLATE_APPROVED",
            result.name,
          );
          return result;
        }
        if (envelope.action === "delete") {
          if (
            await transaction.platformCampaign.count({
              where: { templateId: existing!.id },
            })
          )
            throw new HttpError(
              409,
              "This template is referenced by a campaign",
            );
          await transaction.platformTemplate.delete({
            where: { id: existing!.id },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "TEMPLATE_DELETED",
            existing!.name,
          );
          return { ok: true };
        }
        if (!["create", "update"].includes(envelope.action))
          throw new HttpError(400, "Unknown template action");
        const values =
          envelope.action === "create"
            ? templateFields.parse(input)
            : templateFields.partial().parse(input);
        const result = existing
          ? await transaction.platformTemplate.update({
              where: { id: existing.id },
              data: {
                ...values,
                approvalStatus: "DRAFT",
                approvedAt: null,
                approvedBy: null,
              },
            })
          : await transaction.platformTemplate.create({
              data: { ...templateFields.parse(input), workspaceId },
            });
        await audit(
          transaction,
          workspaceId,
          user.id,
          "TEMPLATE_SAVED",
          result.name,
        );
        return result;
      }
      if (resource === "campaigns") {
        if (callerOperator) {
          const selected = z
            .object({ leadIds: z.array(z.string()).optional() })
            .parse(input).leadIds;
          if (
            selected &&
            (await transaction.platformLead.count({
              where: {
                id: { in: selected },
                OR: [{ ownerId: user.id }, { ownerId: null }],
                status: { not: "ARCHIVED" },
              },
            })) !== selected.length
          )
            throw new HttpError(
              403,
              "Choose leads assigned to you or available in this business's queue.",
            );
        }
        if (
          envelope.action === "preview" ||
          envelope.action === "create-and-send"
        ) {
          const preview = await composeCampaignReview(
            transaction,
            workspaceId,
            input,
          );
          if (envelope.action === "preview") return preview;
          const confirmation = z
            .object({
              permissionConfirmed: z.literal(true),
              previewHash: z.string().length(64),
            })
            .parse(input);
          if (!operation?.idempotencyKey)
            throw new HttpError(
              400,
              "A unique request identifier is required to launch a campaign.",
            );
          if (preview.blockers.length)
            throw new HttpError(
              409,
              preview.blockers.map((item) => item.message).join(" "),
            );
          if (preview.fingerprint !== confirmation.previewHash)
            throw new HttpError(
              409,
              "The campaign or sending setup changed. Review the updated messages before sending.",
            );
          const campaign = z.object({ id: z.string() }).parse(
            await perform({
              ...campaignFields.parse(input),
              action: "create",
            }),
          );
          await perform({
            action: "approve",
            id: campaign.id,
            useCampaignMessage: true,
          });
          const launched = await perform({ action: "start", id: campaign.id });
          return {
            ...launched,
            message:
              "Campaign launched. Messages are queued for your connected sending worker; delivery follows the sending schedule and daily limit.",
          };
        }
        const existing =
          envelope.action !== "create"
            ? await transaction.platformCampaign.findUnique({
                where: { id: envelope.id || "" },
                include: { recipients: { include: { lead: true } } },
              })
            : null;
        if (envelope.action !== "create" && !existing)
          throw new HttpError(404, "Campaign not found");
        if (callerOperator && existing && existing.createdById !== user.id)
          throw new HttpError(
            403,
            "Only the creator or an administrator can change this email campaign.",
          );
        if (operation?.campaignReviewHash && existing) {
          const currentOrganization =
            await transaction.platformOrganization.findUniqueOrThrow({
              where: { workspaceId },
            });
          const currentMailbox = existing.mailboxId
            ? await transaction.platformMailbox.findUnique({
                where: { id: existing.mailboxId },
                select: { id: true, email: true, provider: true, status: true },
              })
            : null;
          if (
            campaignReviewData(existing, currentOrganization, currentMailbox)
              .fingerprint !== operation.campaignReviewHash
          )
            throw new HttpError(
              409,
              "The campaign, sender or recipients changed after review. Prepare a fresh email review before sending.",
            );
        }
        if (["create", "update"].includes(envelope.action)) {
          if (
            existing &&
            !["DRAFT", "APPROVED", "PAUSED"].includes(existing.status)
          )
            throw new HttpError(409, "Pause this campaign before editing");
          if (
            existing &&
            (await transaction.platformMailMessage.count({
              where: { campaignId: existing.id, direction: "OUTBOUND" },
            }))
          )
            throw new HttpError(
              409,
              "Campaigns with send history cannot be rewritten; create a new campaign",
            );
          const values = existing
            ? campaignFields.partial().parse(input)
            : campaignFields.parse(input);
          // Zod fills defaults inside partial schemas; an update must only change the fields it
          // was given, or an omitted leadIds/steps would silently clear recipients and follow-ups.
          if (existing)
            for (const key of Object.keys(values) as (keyof typeof values)[])
              if (!(key in (input as object))) delete values[key];
          const purpose = values.purpose ?? existing?.purpose ?? "OUTREACH";
          if (
            purpose === "PERMISSION_REQUEST" &&
            (values.steps ?? z.array(step).parse(existing?.steps ?? [])).length
          )
            throw new HttpError(
              400,
              "A permission request is a single email. Remove the follow-ups; POPIA allows only one request.",
            );
          if (
            values.mailboxId &&
            !(await transaction.platformMailbox.findUnique({
              where: { id: values.mailboxId },
            }))
          )
            throw new HttpError(
              400,
              "Mailbox does not belong to this business",
            );
          const template = values.templateId
            ? await transaction.platformTemplate.findFirst({
                where: { id: values.templateId, approvalStatus: "APPROVED" },
              })
            : null;
          if (values.templateId && !template)
            throw new HttpError(
              400,
              "Choose an approved template from this business",
            );
          const subjectValue =
            values.subject ?? template?.subject ?? existing?.subject;
          const bodyValue = values.body ?? template?.body ?? existing?.body;
          if (!subjectValue || !bodyValue)
            throw new HttpError(
              400,
              "Campaign subject and message are required",
            );
          const { leadIds, scheduledAt, target, ...stored } = values;
          if (
            (values.sendStartHour ?? existing?.sendStartHour ?? 8) ===
            (values.sendEndHour ?? existing?.sendEndHour ?? 17)
          )
            throw new HttpError(400, "Sending start and end hours must differ");
          if (leadIds && new Set(leadIds).size !== leadIds.length)
            throw new HttpError(400, "Choose each lead only once");
          if (
            leadIds &&
            (await transaction.platformLead.count({
              where: { id: { in: leadIds }, status: { not: "ARCHIVED" } },
            })) !== leadIds.length
          )
            throw new HttpError(
              400,
              "One or more leads do not belong to this business",
            );
          const data = {
            ...stored,
            subject: subjectValue,
            body: bodyValue,
            ...(target ? { target: target as Prisma.InputJsonValue } : {}),
            ...(scheduledAt !== undefined
              ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }
              : {}),
            status: "DRAFT",
            approvedAt: null,
            approvedBy: null,
          };
          const campaign = existing
            ? await transaction.platformCampaign.update({
                where: { id: existing.id },
                data,
              })
            : await transaction.platformCampaign.create({
                data: {
                  ...data,
                  name: values.name!,
                  workspaceId,
                  createdById: user.id,
                },
              });
          if (leadIds) {
            await transaction.platformCampaignRecipient.deleteMany({
              where: { campaignId: campaign.id },
            });
            if (leadIds.length)
              await transaction.platformCampaignRecipient.createMany({
                data: leadIds.map((leadId) => ({
                  workspaceId,
                  campaignId: campaign.id,
                  leadId,
                })),
              });
          } else if (existing) {
            await transaction.platformCampaignRecipient.updateMany({
              where: { campaignId: existing.id },
              data: { approvedAt: null, approvedBy: null },
            });
          }
          await audit(
            transaction,
            workspaceId,
            user.id,
            "CAMPAIGN_SAVED",
            campaign.name,
            { campaignId: campaign.id },
          );
          return campaign;
        }
        if (envelope.action === "approve") {
          const useCampaignMessage =
            z
              .object({ useCampaignMessage: z.boolean().optional() })
              .parse(input).useCampaignMessage === true;
          if (!["DRAFT", "PAUSED", "APPROVED"].includes(existing!.status))
            throw new HttpError(
              409,
              "Campaign cannot be approved in its current state",
            );
          if (!organization.profileApprovedAt)
            throw new HttpError(
              409,
              "Review and approve the business profile first",
            );
          if (!existing!.recipients.length)
            throw new HttpError(400, "Select at least one lead");
          const permissionRequest = existing!.purpose === "PERMISSION_REQUEST";
          if (permissionRequest && z.array(step).parse(existing!.steps).length)
            throw new HttpError(
              409,
              "A permission request is a single email. Remove the follow-ups before approval.",
            );
          const approvedAt = new Date();
          for (const recipient of existing!.recipients) {
            // Lead drafts are outreach copy; a permission request always uses its own message.
            const hasDraft =
              !useCampaignMessage &&
              !permissionRequest &&
              !!recipient.lead.draftSubject.trim() &&
              !!recipient.lead.draftBody.trim();
            const contact = {
              name: recipient.lead.name,
              company: recipient.lead.company,
              email: recipient.lead.email || "",
            };
            const subject = hasDraft ? recipient.lead.draftSubject : personalize(existing!.subject, contact);
            const personalized = hasDraft ? recipient.lead.draftBody : personalize(existing!.body, contact);
            const body = permissionRequest
              ? withPermissionNotice(personalized, access.workspace.name)
              : personalized;
            const missing = unfilledEmailFields(subject, body, ...z.array(step).parse(existing!.steps)
              .flatMap((item) => [personalizeFollowup(item.subject, recipient.lead), personalizeFollowup(item.body, recipient.lead)]));
            if (missing.length)
              throw new HttpError(409, `${recipient.lead.company}: fill in email fields ${missing.join(", ")} before approval.`);
            await transaction.platformCampaignRecipient.update({
              where: { id: recipient.id },
              data: {
                subject,
                body,
                approvedAt,
                approvedBy: user.id,
              },
            });
          }
          const result = await transaction.platformCampaign.update({
            where: { id: existing!.id },
            data: { status: "APPROVED", approvedAt, approvedBy: user.id },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "CAMPAIGN_APPROVED",
            result.name,
            { campaignId: result.id },
          );
          return result;
        }
        if (envelope.action === "pause" || envelope.action === "cancel") {
          if (["COMPLETED", "CANCELLED"].includes(existing!.status))
            throw new HttpError(409, "Campaign is already finished");
          const result = await transaction.platformCampaign.update({
            where: { id: existing!.id },
            data: {
              status: envelope.action === "pause" ? "PAUSED" : "CANCELLED",
            },
          });
          if (envelope.action === "cancel")
            await transaction.platformCampaignRecipient.updateMany({
              where: { campaignId: result.id, status: "QUEUED" },
              data: { status: "CANCELLED" },
            });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "CAMPAIGN_" + result.status,
            result.name,
            { campaignId: result.id },
          );
          return result;
        }
        if (envelope.action === "start" || envelope.action === "resume") {
          if (
            !["APPROVED", "PAUSED"].includes(existing!.status) ||
            !existing!.approvedAt ||
            !existing!.approvedBy
          )
            throw new HttpError(409, "Approve this campaign before starting");
          if (process.env.LIVE_EMAIL_ENABLED !== "true")
            throw new HttpError(
              503,
              "Live sending is not enabled by the platform administrator",
            );
          if (!organization.profileApprovedAt)
            throw new HttpError(409, "Business profile approval is required");
          if (existing!.safetyPausedAt)
            throw new HttpError(
              409,
              "Campaign is held for a sending safety review",
            );
          const mailbox = existing!.mailboxId
            ? await transaction.platformMailbox.findUnique({
                where: { id: existing!.mailboxId },
              })
            : null;
          if (
            !mailbox ||
            mailbox.status !== "LIVE_ENABLED" ||
            !isSendingProvider(mailbox.provider) ||
            !senderMatchesWebsite(mailbox.email, [organization.websiteUrl])
          )
            throw new HttpError(
              409,
              "Connect and activate this business's domain-matched mailbox",
            );
          const subscription =
            await transaction.platformSubscription.findUnique({
              where: { workspaceId },
              include: { plan: true },
            });
          if (
            !subscription ||
            !["ACTIVE", "TRIAL"].includes(subscription.status) ||
            (subscription.periodEnd && subscription.periodEnd < new Date())
          )
            throw new HttpError(
              403,
              "An active subscription or trial is required",
            );
          if (subscription.plan.dailyEmails < 1)
            throw new HttpError(
              403,
              "This plan does not include email sending",
            );
          const minimum = minimumQualificationScore(
            organization.qualificationCriteria,
          );
          const pending = existing!.recipients.filter((recipient) =>
            ["QUEUED", "PENDING"].includes(recipient.status),
          );
          if (!pending.length)
            throw new HttpError(409, "No pending recipients remain");
          const permissionRequest = existing!.purpose === "PERMISSION_REQUEST";
          const asked = permissionRequest
            ? await permissionAskedLeadIds(
                transaction,
                pending.map((recipient) => recipient.leadId),
                existing!.id,
              )
            : new Set<string>();
          for (const recipient of pending) {
            if (
              callerOperator &&
              recipient.lead.ownerId &&
              recipient.lead.ownerId !== user.id
            )
              throw new HttpError(
                409,
                "A recipient is now assigned to another caller. Update the campaign recipients.",
              );
            if (
              !recipient.approvedAt ||
              !recipient.approvedBy ||
              !recipient.subject ||
              !recipient.body
            )
              throw new HttpError(
                409,
                "Every recipient needs an approved message",
              );
            const blocker = permissionRequest
              ? permissionRequestBlocker(
                  recipient.lead,
                  minimum,
                  asked.has(recipient.leadId),
                )
              : leadSendBlocker(recipient.lead, minimum);
            if (blocker)
              throw new HttpError(409, `${recipient.lead.company}: ${blocker}`);
            if (
              await transaction.platformMailSuppression.findUnique({
                where: {
                  workspaceId_email: {
                    workspaceId,
                    email: recipient.lead.email!,
                  },
                },
              })
            )
              throw new HttpError(409, "A selected recipient is suppressed");
          }
          const result = await transaction.platformCampaign.update({
            where: { id: existing!.id },
            data: { status: "RUNNING" },
          });
          const job = await enqueueJob(
            workspaceId,
            user.id,
            "SEND_CAMPAIGN",
            { campaignId: result.id },
            `campaign:${result.id}:${Date.now()}`,
            transaction,
          );
          await audit(
            transaction,
            workspaceId,
            user.id,
            "CAMPAIGN_STARTED",
            result.name,
            { campaignId: result.id },
          );
          return { ...result, job };
        }
        throw new HttpError(400, "Unknown campaign action");
      }
      if (resource === "notifications") {
        if (envelope.action === "read-all") {
          await transaction.$executeRaw`UPDATE "PlatformNotice" SET "readBy" = array_append("readBy",${user.id}) WHERE "workspaceId"=${workspaceId} AND NOT (${user.id}=ANY("readBy"))`;
          return { read: true };
        }
        if (envelope.action !== "read")
          throw new HttpError(400, "Unknown notification action");
        const notice = await transaction.platformNotice.findUnique({
          where: { id: envelope.id || "" },
        });
        if (!notice) throw new HttpError(404, "Notification not found");
        return transaction.platformNotice.update({
          where: { id: notice.id },
          data: { readBy: [...new Set([...notice.readBy, user.id])] },
        });
      }
      if (resource === "team") {
        const values = z
          .object({
            email: z.email().optional(),
            userId: z.string().optional(),
            role: z.enum(["CLIENT_VIEWER"]).optional(),
          })
          .parse(input);
        const target = values.userId
          ? await transaction.user.findUnique({
              where: { id: values.userId },
              select: { id: true, name: true, email: true },
            })
          : values.email
            ? await transaction.user.findUnique({
                where: { email: values.email.toLowerCase().trim() },
                select: { id: true, name: true, email: true },
              })
            : null;
        if (!target)
          throw new HttpError(
            404,
            "This user must register and verify their account first",
          );
        const identity = await controlDb.user.findUnique({
          where: { id: target.id },
          select: { requiresVerification: true, emailVerifiedAt: true },
        });
        if (
          !identity ||
          (identity.requiresVerification && !identity.emailVerifiedAt)
        )
          throw new HttpError(400, "This user must verify their account first");
        const membership = await transaction.membership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: target.id } },
        });
        if (!membership && envelope.action !== "add")
          throw new HttpError(404, "Team member not found");
        if (envelope.action === "remove") {
          await transaction.membership.delete({
            where: { workspaceId_userId: { workspaceId, userId: target.id } },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "MEMBER_REMOVED",
            target.email,
          );
          return { ok: true };
        }
        if (!["add", "update"].includes(envelope.action) || !values.role)
          throw new HttpError(400, "Choose an action and role");
        if (!membership) {
          const subscription =
            await transaction.platformSubscription.findUnique({
              where: { workspaceId },
              include: { plan: true },
            });
          if (
            !subscription ||
            (await transaction.membership.count({ where: { workspaceId } })) >=
              subscription.plan.teamMembers
          )
            throw new HttpError(
              403,
              "This business has reached its team member limit",
            );
        }
        const result = await transaction.membership.upsert({
          where: { workspaceId_userId: { workspaceId, userId: target.id } },
          create: { workspaceId, userId: target.id, role: values.role },
          update: { role: values.role },
        });
        await audit(
          transaction,
          workspaceId,
          user.id,
          "MEMBER_UPDATED",
          `${target.email}: ${values.role}`,
        );
        return result;
      }
      if (resource === "settings") {
        if (envelope.action === "redact-archived") {
          z.object({ confirmed: z.literal(true) }).parse(input);
          const cutoff = new Date(
            Date.now() - organization.retentionDays * 86400000,
          );
          const leads = await transaction.platformLead.findMany({
            where: { status: "ARCHIVED", updatedAt: { lt: cutoff } },
            select: { id: true },
          });
          const leadIds = leads.map((lead) => lead.id);
          const messages = await transaction.platformMailMessage.updateMany({
            where: {
              leadId: { in: leadIds },
              createdAt: { lt: cutoff },
              status: { in: ["ACCEPTED", "RECEIVED"] },
            },
            data: {
              body: "[Content removed by client retention policy]",
              suggestedReply: null,
              classificationExplanation: null,
            },
          });
          await transaction.platformLead.updateMany({
            where: { id: { in: leadIds } },
            data: {
              name: "",
              phone: "",
              contactRole: "",
              notes: "",
              evidence: [],
              research: Prisma.DbNull,
              draftSubject: "",
              draftBody: "",
              qualificationExplanation: null,
            },
          });
          await audit(
            transaction,
            workspaceId,
            user.id,
            "RETENTION_APPLIED",
            `${leads.length} archived lead profiles and ${messages.count} old message bodies redacted; suppression and delivery identifiers retained`,
          );
          return {
            message: `${leads.length} archived profiles and ${messages.count} message bodies redacted. Suppression and delivery identifiers retained.`,
          };
        }
        const values = z
          .object({
            name: z.string().trim().min(2).max(160).optional(),
            timezone: z.string().max(100).optional(),
            retentionDays: z.number().int().min(30).max(3650).optional(),
          })
          .parse(input);
        if (values.timezone) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: values.timezone });
          } catch {
            throw new HttpError(400, "Invalid timezone");
          }
        }
        const { retentionDays, ...workspaceValues } = values;
        if (retentionDays !== undefined)
          await transaction.platformOrganization.update({
            where: { workspaceId },
            data: { retentionDays },
          });
        const result = await transaction.workspace.update({
          where: { id: workspaceId },
          data: workspaceValues,
        });
        await audit(
          transaction,
          workspaceId,
          user.id,
          "SETTINGS_UPDATED",
          "Business account settings updated",
        );
        return result;
      }
      throw new HttpError(404, "Unknown platform resource");
    };
    const result = await perform();
    if (operationKey)
      await transaction.platformOperationReceipt.create({
        data: {
          workspaceId,
          operationKey,
          scopeHash,
          encryptedResult: encrypt(JSON.stringify(result)),
        },
      });
    return result;
  });
}

export async function adminRead() {
  const user = await currentUser();
  if (!user.agencyAdmin)
    throw new HttpError(403, "Platform administrator required");
  const organizations = await controlDb.platformOrganization.findMany({
    select: {
      workspaceId: true,
      websiteUrl: true,
      onboardingStatus: true,
      createdAt: true,
      workspace: {
        select: {
          name: true,
          status: true,
          _count: { select: { memberships: true } },
          memberships: {
            where: {
              user: {
                agencyAdmin: false,
                OR: [{ staffRole: null }, { staffRole: { not: "CALLER" } }],
              },
            },
            select: { user: { select: { id: true, name: true, email: true } } },
            take: 20,
          },
        },
      },
      _count: { select: { leads: true, campaigns: true } },
      subscription: { include: { plan: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    organizations: organizations.map(
      ({ workspace, _count, ...organization }) => ({
        ...organization,
        name: workspace.name,
        status: workspace.status,
        clientLogins: workspace.memberships.map(
          (membership) => membership.user,
        ),
        counts: {
          leads: _count.leads,
          campaigns: _count.campaigns,
          members: workspace._count.memberships,
        },
      }),
    ),
    plans: await controlDb.platformPlan.findMany({
      orderBy: { monthlyProspects: "asc" },
    }),
    metrics: {
      organizations: organizations.length,
      activeOrganizations: organizations.filter(
        (organization) => organization.workspace.status === "ACTIVE",
      ).length,
      leads: organizations.reduce(
        (sum, organization) => sum + organization._count.leads,
        0,
      ),
      campaigns: organizations.reduce(
        (sum, organization) => sum + organization._count.campaigns,
        0,
      ),
    },
  };
}

export async function adminWrite(input: unknown) {
  const user = await currentUser();
  if (!user.agencyAdmin)
    throw new HttpError(403, "Platform administrator required");
  const envelope = z
    .object({ action: z.string(), workspaceId: z.string().optional() })
    .parse(input);
  if (envelope.action === "plan") {
    const plan = z
      .object({
        id: z.string().regex(/^[A-Z0-9_-]{2,40}$/),
        name: z.string().min(2).max(160),
        priceMinor: z.number().int().nonnegative().nullable().optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default("ZAR"),
        monthlyProspects: z.number().int().nonnegative().max(10_000_000),
        dailyEmails: z.number().int().nonnegative().max(100_000),
        dailyAi: z.number().int().nonnegative().max(1_000_000),
        teamMembers: z.number().int().min(1).max(1000),
        features: z.array(z.string().max(100)).max(100).default([]),
        available: z.boolean().default(false),
      })
      .parse(input);
    return controlDb.platformPlan.upsert({
      where: { id: plan.id },
      create: plan,
      update: plan,
    });
  }
  const workspaceId = z.string().min(1).parse(envelope.workspaceId);
  if (
    !(await controlDb.platformOrganization.findUnique({
      where: { workspaceId },
    }))
  )
    throw new HttpError(404, "Organization not found");
  return controlDb.$transaction(async (transaction) => {
    if (envelope.action === "organization-status") {
      const { status } = z
        .object({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
        .parse(input);
      const result = await transaction.workspace.update({
        where: { id: workspaceId },
        data: { status },
      });
      if (status === "SUSPENDED")
        await transaction.platformCampaign.updateMany({
          where: { workspaceId, status: "RUNNING" },
          data: { status: "PAUSED" },
        });
      await audit(
        transaction,
        workspaceId,
        user.id,
        "ORGANIZATION_" + status,
        "Platform administrator changed account access",
      );
      return result;
    }
    if (envelope.action === "subscription") {
      const values = z
        .object({
          planId: z.string().max(40),
          status: z.enum([
            "ACTIVE",
            "TRIAL",
            "SUSPENDED",
            "CANCELLED",
            "EXPIRED",
          ]),
          periodEnd: z.iso.datetime().nullable().optional(),
          providerReference: z.string().max(240).nullable().optional(),
        })
        .parse(input);
      if (
        !(await transaction.platformPlan.findUnique({
          where: { id: values.planId },
        }))
      )
        throw new HttpError(400, "Plan not found");
      if (values.status === "ACTIVE" && !values.providerReference?.trim())
        throw new HttpError(
          400,
          "A verified billing reference is required for active paid subscriptions",
        );
      const data = {
        ...values,
        periodEnd: values.periodEnd ? new Date(values.periodEnd) : null,
      };
      const result = await transaction.platformSubscription.upsert({
        where: { workspaceId },
        create: { ...data, workspaceId },
        update: data,
      });
      await audit(
        transaction,
        workspaceId,
        user.id,
        "SUBSCRIPTION_UPDATED",
        `${values.planId}: ${values.status}`,
      );
      return result;
    }
    throw new HttpError(400, "Unknown administrator action");
  });
}
