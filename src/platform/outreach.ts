import { Prisma } from "@prisma/client";
import { z } from "zod";
import { controlDb, db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { withTenantDatabase } from "@/lib/tenancy";
import { organizationAccess } from "./core";
import { fetchWebsiteProspects, type ProspectCandidate } from "./calling/overture";
import { researchWebsite } from "./research/web";
import { verifyEmail } from "./research/service";
import {
  mailDomainCheck,
  verificationConfigured,
} from "./research/verification";
import {
  permissionAskedLeadIds,
  permissionRequestBlocker,
  withPermissionNotice,
} from "./mail/permission";
import { personalizeFollowup } from "./mail/content";
import {
  excluded,
  laneFor,
  laneSchema,
  lanesOf,
  outreachSettings,
  nextSearch,
  placeholdersLeft,
  profileOf,
  searchTargets,
  senderBusinessName,
  type OutreachLane,
  type OutreachSettings,
} from "./outreach-settings";

/*
 * Outreach autopilot. For each client: find businesses in the chosen niches (Overture Maps public
 * listings), read their websites for a published email, check the email, and queue the client's
 * email to them. Every send still passes the normal send-time checks (plan, approved details,
 * live inbox, verified address, POPIA one-time request, bounce safety, limits and hours).
 */

const DAY = 86400000;
const AUTOPILOT = "NICHE_MATCH";
const asJson = (value: OutreachSettings) => value as unknown as Prisma.InputJsonValue;
const titleCase = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** What still stops the autopilot from running, in the order to fix it. */
function startProblems(settings: OutreachSettings) {
  const problems: string[] = [];
  const lanes = lanesOf(settings);
  if (!lanes.length) problems.push("Add a campaign: who to email, and the email.");
  for (const lane of lanes) {
    const where = lanes.length > 1 ? `In "${lane.name}": ` : "";
    if (!lane.niches.length) problems.push(`${where}Add at least one niche to email.`);
    if (!lane.subject.trim() || !lane.body.trim())
      problems.push(`${where}Write the email subject and message.`);
    const left = placeholdersLeft(lane.subject, lane.body);
    if (left.length)
      problems.push(
        `${where}Replace the placeholder ${left.map((field) => `{{${field}}}`).join(", ")} in the email.`,
      );
    if (!lane.replyTo.length && !settings.replyTo.length)
      problems.push(`${where}Add at least one sales rep email to receive replies.`);
  }
  return problems;
}

export async function outreachRead(workspaceId: string) {
  const { organization, workspace } = await organizationAccess(workspaceId);
  const settings = outreachSettings(organization.outreach);
  const fresh = new Date(Date.now() - 30 * DAY);
  const mine = { workspaceId, qualificationCategory: AUTOPILOT };
  const since = new Date(Date.now() - 30 * DAY);
  const [
    found,
    withEmail,
    checked,
    waitingCheck,
    waitingEmail,
    sent,
    replies,
    saidYes,
    bounced,
    queued,
    mailboxes,
    subscription,
    recentReplies,
    daily,
  ] = await Promise.all([
    db.platformLead.count({ where: mine }),
    db.platformLead.count({ where: { ...mine, email: { not: null } } }),
    db.platformLead.count({
      where: { ...mine, verificationStatus: "VALID", verifiedAt: { gte: fresh } },
    }),
    db.platformLead.count({
      where: { ...mine, email: { not: null }, verificationStatus: "UNKNOWN" },
    }),
    db.platformLead.count({
      where: { ...mine, email: null, website: { not: "" }, websiteCheckedAt: null },
    }),
    db.platformMailMessage.count({
      where: { workspaceId, direction: "OUTBOUND", status: "ACCEPTED" },
    }),
    db.platformMailMessage.count({ where: { workspaceId, direction: "INBOUND" } }),
    db.platformLead.count({ where: { workspaceId, eligibility: "CONSENTED" } }),
    db.platformMailEvent.count({ where: { workspaceId, kind: "BOUNCE" } }),
    db.platformCampaignRecipient.count({
      where: { workspaceId, status: "QUEUED", campaign: { target: { path: ["autopilot"], equals: true } } },
    }),
    db.platformMailbox.findMany({
      where: { workspaceId },
      select: { id: true, email: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    db.platformSubscription.findUnique({
      where: { workspaceId },
      select: { status: true, periodEnd: true },
    }),
    db.platformMailMessage.findMany({
      where: { workspaceId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        fromEmail: true,
        subject: true,
        body: true,
        createdAt: true,
        leadId: true,
        classification: true,
      },
    }),
    db.$queryRaw<{ day: string; sent: number; replies: number }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg','YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE direction='OUTBOUND' AND status='ACCEPTED')::int AS sent,
        count(*) FILTER (WHERE direction='INBOUND')::int AS replies
      FROM "PlatformMailMessage" WHERE "workspaceId"=${workspaceId} AND "createdAt">=${since}
      GROUP BY day ORDER BY day`,
  ]);
  const leads = await db.platformLead.findMany({
    where: {
      workspaceId,
      id: { in: recentReplies.map((reply) => reply.leadId).filter((id): id is string => !!id) },
    },
    select: { id: true, company: true, eligibility: true },
  });
  const now = new Date();
  const planLive =
    !!subscription &&
    ["TRIAL", "ACTIVE"].includes(subscription.status) &&
    (!subscription.periodEnd || subscription.periodEnd > now);
  const lanes = lanesOf(settings);
  const laneCampaigns = lanes.map((lane) => lane.campaignId).filter((id): id is string => !!id);
  const perCampaign = laneCampaigns.length
    ? await db.$queryRaw<{ campaignId: string; sent: number; replies: number; queued: number }[]>`
        SELECT c.id AS "campaignId",
          (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."campaignId" = c.id AND m.direction = 'OUTBOUND' AND m.status = 'ACCEPTED') AS sent,
          (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."campaignId" = c.id AND m.direction = 'INBOUND') AS replies,
          (SELECT count(*)::int FROM "PlatformCampaignRecipient" r WHERE r."campaignId" = c.id AND r.status = 'QUEUED') AS queued
        FROM "PlatformCampaign" c WHERE c."workspaceId" = ${workspaceId} AND c.id IN (${Prisma.join(laneCampaigns)})`
    : [];
  const days = new Map(daily.map((row) => [row.day, row]));
  const series = Array.from({ length: 30 }, (_, index) => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
    }).format(new Date(Date.now() - (29 - index) * DAY));
    return { day, sent: days.get(day)?.sent ?? 0, replies: days.get(day)?.replies ?? 0 };
  });
  return {
    business: {
      name: senderBusinessName(organization.profile, workspace.name),
      website: organization.websiteUrl,
    },
    settings: {
      enabled: settings.enabled,
      lanes: lanes.map((lane) => {
        const counts = perCampaign.find((row) => row.campaignId === lane.campaignId);
        return {
          ...lane,
          stats: { sent: counts?.sent ?? 0, replies: counts?.replies ?? 0, queued: counts?.queued ?? 0 },
        };
      }),
      replyTo: settings.replyTo,
      exclude: settings.exclude,
      sendStartHour: settings.sendStartHour,
      sendEndHour: settings.sendEndHour,
      dailyLimit: settings.dailyLimit,
      approvedAt: settings.approvedAt,
      lastFind: settings.lastFind,
      nextFindAt: settings.nextFindAt,
    },
    problems: startProblems(settings),
    readiness: {
      plan: planLive,
      planDetail: !subscription
        ? "No plan assigned"
        : subscription.periodEnd && subscription.periodEnd <= now
          ? `Plan ended ${subscription.periodEnd.toISOString().slice(0, 10)}`
          : subscription.status,
      inbox: mailboxes.some((box) => box.status === "LIVE_ENABLED"),
      mailboxes,
      emailChecker: verificationConfigured(),
      liveSending: process.env.LIVE_EMAIL_ENABLED === "true",
    },
    stats: {
      found,
      withEmail,
      checked,
      waitingCheck,
      waitingEmail,
      queued,
      sent,
      replies,
      saidYes,
      bounced,
    },
    series,
    replies: recentReplies.map((reply) => {
      const lead = leads.find((item) => item.id === reply.leadId);
      return {
        id: reply.id,
        from: reply.fromEmail,
        company: lead?.company ?? null,
        saidYes: lead?.eligibility === "CONSENTED",
        subject: reply.subject,
        preview: reply.body.replace(/\s+/g, " ").trim().slice(0, 180),
        at: reply.createdAt,
      };
    }),
  };
}

const saveSchema = z
  .object({
    action: z.enum(["save", "start", "pause"]),
    lanes: z.array(laneSchema.omit({ campaignId: true })).max(8).optional(),
    exclude: z.array(z.string().trim().min(2).max(40)).max(30).optional(),
    sendStartHour: z.number().int().min(0).max(23).optional(),
    sendEndHour: z.number().int().min(1).max(24).optional(),
    dailyLimit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine(
    (input) => (input.sendStartHour ?? 0) < (input.sendEndHour ?? 24),
    "Sending must start before it ends.",
  )
  .refine(
    (input) => new Set((input.lanes ?? []).map((lane) => lane.id)).size === (input.lanes ?? []).length,
    "Each campaign needs its own id.",
  );

export async function outreachWrite(workspaceId: string, raw: unknown) {
  const { user, organization, workspace } = await organizationAccess(workspaceId, true);
  if (!user.agencyAdmin)
    throw new HttpError(403, "Only your agency can change a client's outreach.");
  if (organization.onboardingStatus === "DEMO")
    throw new HttpError(403, "This demo workspace is read-only.");
  const input = saveSchema.parse(raw);
  let settings = outreachSettings(organization.outreach);
  if (input.lanes) {
    // Campaigns keep their running email campaign by id; older single-campaign fields are retired.
    const before = lanesOf(settings);
    settings = {
      ...settings,
      lanes: input.lanes.map((lane) => ({
        ...lane,
        replyTo: [...new Set(lane.replyTo.map((value) => value.toLowerCase()))],
        campaignId: before.find((item) => item.id === lane.id)?.campaignId ?? null,
      })),
      niches: [],
      subject: "",
      body: "",
      campaignId: null,
    };
  }
  settings = {
    ...settings,
    ...(input.exclude ? { exclude: [...new Set(input.exclude.map((word) => word.toLowerCase()))] } : {}),
    ...(input.sendStartHour !== undefined ? { sendStartHour: input.sendStartHour } : {}),
    ...(input.sendEndHour !== undefined ? { sendEndHour: input.sendEndHour } : {}),
    ...(input.dailyLimit ? { dailyLimit: input.dailyLimit } : {}),
  };
  const now = new Date();
  let message = "Outreach settings saved.";
  if (input.action === "start") {
    const problems = startProblems(settings);
    if (problems.length) throw new HttpError(400, problems[0]);
    settings = {
      ...settings,
      enabled: true,
      approvedBy: user.id,
      approvedAt: now.toISOString(),
      nextFindAt: now.toISOString(),
    };
    message =
      "Outreach started. The first search for businesses runs within a few minutes on the sending computer.";
  }
  if (input.action === "pause") {
    settings = { ...settings, enabled: false };
    message = "Outreach paused. Nothing new is searched or sent until you start it again.";
  }
  await db.$transaction(async (tx) => {
    await tx.platformOrganization.update({
      where: { workspaceId },
      data: {
        outreach: asJson(settings),
        // Starting is the agency approving these business details and this email for sending.
        ...(input.action === "start" && !organization.profileApprovedAt
          ? {
              profileApprovedAt: now,
              profileApprovedBy: user.id,
              targetCriteria: searchTargets(lanesOf(settings))
                .map((item) => `${item.niche} in ${item.area}`)
                .join("; ")
                .slice(0, 2000),
              // Keep whatever the profile already says; only fill in a missing company name.
              profile: {
                ...profileOf(organization.profile),
                companyName: senderBusinessName(organization.profile, workspace.name),
              },
              onboardingStatus: "ACTIVE",
            }
          : {}),
      },
    });
    await tx.platformActivity.create({
      data: {
        workspaceId,
        actorId: user.id,
        kind: `OUTREACH_${input.action.toUpperCase()}`,
        detail: message.slice(0, 1000),
      },
    });
  });
  if (settings.approvedAt || input.action === "start")
    await syncCampaigns(
      workspaceId,
      settings,
      senderBusinessName(organization.profile, workspace.name),
    );
  return { message };
}

/**
 * Keeps one email campaign per autopilot campaign in line with the settings and live inboxes.
 * Campaigns that were removed are paused and their unsent emails withdrawn, so those businesses
 * can be picked up by the campaign they now belong to.
 */
async function syncCampaigns(
  workspaceId: string,
  settings: OutreachSettings,
  businessName: string,
) {
  const live = await db.platformMailbox.findMany({
    where: { workspaceId, status: "LIVE_ENABLED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const running = settings.enabled && !!settings.approvedAt && !!settings.approvedBy;
  const lanes = lanesOf(settings);
  const result = new Map<string, { campaignId: string; live: number; dailyLimit: number }>();
  const ids: (string | null)[] = [];
  for (const lane of lanes) {
    const inboxes = lane.mailboxIds.length
      ? live.filter((box) => lane.mailboxIds.includes(box.id))
      : live;
    const dailyLimit = Math.max(1, inboxes.length) * settings.dailyLimit;
    const data = {
      name: lanes.length > 1 || lane.id !== "main" ? `Outreach · ${lane.name}` : "Outreach autopilot",
      purpose: "PERMISSION_REQUEST",
      subject: lane.subject,
      body: lane.body,
      steps: [] as Prisma.InputJsonValue,
      dailyLimit,
      mailboxId: inboxes[0]?.id ?? null,
      extraMailboxIds: inboxes.slice(1).map((box) => box.id),
      target: {
        autopilot: true,
        lane: lane.id,
        niches: lane.niches,
        areas: lane.areas,
      } as Prisma.InputJsonValue,
      status: running ? "RUNNING" : "PAUSED",
      approvedAt: running ? new Date(settings.approvedAt!) : null,
      approvedBy: running ? settings.approvedBy : null,
      sendStartHour: settings.sendStartHour,
      sendEndHour: settings.sendEndHour,
      sendWeekdays: [1, 2, 3, 4, 5],
    };
    const existing = lane.campaignId
      ? await db.platformCampaign.findFirst({
          where: { workspaceId, id: lane.campaignId },
          select: { id: true },
        })
      : null;
    const campaign = existing
      ? await db.platformCampaign.update({ where: { id: existing.id }, data })
      : await db.platformCampaign.create({ data: { ...data, workspaceId } });
    ids.push(campaign.id);
    result.set(lane.id, { campaignId: campaign.id, live: inboxes.length, dailyLimit });
    // Emails still waiting to go out pick up the latest wording.
    const waiting = await db.platformCampaignRecipient.findMany({
      where: { workspaceId, campaignId: campaign.id, status: "QUEUED", step: 0 },
      select: { id: true, lead: true },
    });
    for (const recipient of waiting)
      await db.platformCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          subject: personalizeFollowup(lane.subject, recipient.lead),
          body: withPermissionNotice(personalizeFollowup(lane.body, recipient.lead), businessName),
          ...(running ? { approvedAt: data.approvedAt, approvedBy: data.approvedBy } : {}),
        },
      });
  }
  // Save new campaign ids (only when something changed, to keep each round cheap).
  if (lanes.some((lane, index) => lane.campaignId !== ids[index])) {
    const organization = await db.platformOrganization.findUniqueOrThrow({
      where: { workspaceId },
      select: { outreach: true },
    });
    const stored = outreachSettings(organization.outreach);
    const updated = settings.lanes.length
      ? { ...stored, lanes: stored.lanes.map((lane) => ({ ...lane, campaignId: result.get(lane.id)?.campaignId ?? lane.campaignId })) }
      : { ...stored, campaignId: result.get("main")?.campaignId ?? stored.campaignId };
    await db.platformOrganization.update({ where: { workspaceId }, data: { outreach: asJson(updated) } });
  }
  // Autopilot campaigns no longer in the settings: pause and withdraw their unsent emails.
  const orphans = await db.platformCampaign.findMany({
    where: {
      workspaceId,
      target: { path: ["autopilot"], equals: true },
      id: { notIn: [...result.values()].map((item) => item.campaignId) },
    },
    select: { id: true, status: true },
  });
  for (const orphan of orphans) {
    if (orphan.status !== "PAUSED")
      await db.platformCampaign.update({ where: { id: orphan.id }, data: { status: "PAUSED" } });
    await db.platformCampaignRecipient.deleteMany({
      where: { workspaceId, campaignId: orphan.id, status: "QUEUED", step: 0 },
    });
  }
  return result;
}

/** Step 1: find businesses in the next niche (public Overture Maps listings with a website). */
async function findBusinesses(
  workspaceId: string,
  settings: OutreachSettings,
  niche: { niche: string; area: string; lane: string },
  provider: typeof fetchWebsiteProspects,
) {
  const existing = await db.platformLead.findMany({
    where: { workspaceId },
    select: { sourceRecordId: true, email: true },
    take: 20000,
  });
  const ids = new Set(existing.map((row) => row.sourceRecordId).filter(Boolean));
  const emails = new Set(existing.map((row) => row.email).filter(Boolean));
  let candidates: ProspectCandidate[] = [];
  let error: string | undefined;
  try {
    ({ candidates } = await provider({
      industry: niche.niche,
      city: niche.area,
      exclude: [...ids].filter((id): id is string => !!id && id.startsWith("OVERTURE:")),
      limit: 60,
      requireMissingWebsite: false,
      // Runs on the background worker, so a slow connection gets 5 minutes instead of 2.5.
      timeoutMs: 300000,
    }));
  } catch (problem) {
    error = (problem as Error).message.slice(0, 300);
  }
  const now = new Date();
  const data: Prisma.PlatformLeadCreateManyInput[] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    if (ids.has(candidate.sourceRecordId) || (!candidate.website && !candidate.email))
      continue;
    const email = candidate.email && !emails.has(candidate.email) ? candidate.email : null;
    const category = String((candidate.evidence as { category?: unknown }).category ?? candidate.industry);
    if (excluded(settings.exclude, candidate.company, category)) {
      skipped++;
      continue;
    }
    data.push({
      workspaceId,
      company: candidate.company,
      phone: candidate.phone,
      email,
      industry: titleCase(niche.niche),
      location: candidate.location,
      sourceKind: "OVERTURE",
      sourceRecordId: candidate.sourceRecordId,
      sourceUrl: "https://docs.overturemaps.org/guides/places/",
      website: candidate.website,
      websitePresence: candidate.websitePresence,
      websiteEvidence: candidate.evidence as Prisma.InputJsonValue,
      createdById: settings.approvedBy,
      status: "QUALIFIED",
      qualificationCategory: AUTOPILOT,
      qualifiedAt: now,
      qualificationExplanation: `Found by the outreach autopilot: listed as "${category.replaceAll("_", " ")}" in public business listings for ${niche.area}, matching the niche "${niche.niche}".`,
      research: {
        autopilot: { niche: niche.niche, area: niche.area, lane: niche.lane, foundAt: now.toISOString() },
      },
      notes: "Found by the outreach autopilot from public business listings (Overture Maps). The email comes from the business's own website.",
    });
    ids.add(candidate.sourceRecordId);
    if (email) emails.add(email);
  }
  const added = data.length
    ? (await db.platformLead.createMany({ data, skipDuplicates: true })).count
    : 0;
  return {
    at: now.toISOString(),
    niche: niche.niche,
    area: niche.area,
    found: candidates.length,
    added,
    ...(skipped ? { skipped } : {}),
    ...(error ? { error } : {}),
  };
}

/** Step 2: read up to `limit` websites for a published email address. */
async function findEmails(workspaceId: string, limit: number) {
  const leads = await db.platformLead.findMany({
    where: {
      workspaceId,
      qualificationCategory: AUTOPILOT,
      email: null,
      website: { not: "" },
      websiteCheckedAt: null,
    },
    select: { id: true, website: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let found = 0;
  for (const lead of leads) {
    let email: string | null = null;
    try {
      email = (await researchWebsite(lead.website)).email?.toLowerCase() ?? null;
    } catch {
      /* Unreachable or blocked websites simply yield no email. */
    }
    const taken = email
      ? await db.platformLead.findFirst({
          where: { workspaceId, email, id: { not: lead.id } },
          select: { id: true },
        })
      : null;
    await db.platformLead.update({
      where: { workspaceId_id: { workspaceId, id: lead.id } },
      data: {
        websiteCheckedAt: new Date(),
        ...(email && !taken ? { email, verificationStatus: "UNKNOWN", verifiedAt: null } : {}),
      },
    });
    if (email && !taken) found++;
  }
  return found;
}

/** Step 3: check new emails. Without an email-checking service only the free domain check runs. */
async function checkEmails(workspaceId: string, limit: number) {
  const configured = verificationConfigured();
  const leads = await db.platformLead.findMany({
    where: {
      workspaceId,
      qualificationCategory: AUTOPILOT,
      email: { not: null },
      verificationStatus: "UNKNOWN",
      verifiedAt: null,
    },
    select: { id: true, email: true, research: true },
    orderBy: { createdAt: "asc" },
    take: limit * 3,
  });
  let checked = 0;
  for (const lead of leads) {
    if (checked >= limit) break;
    const research = (lead.research ?? {}) as { autopilot?: Record<string, unknown> };
    if (configured) {
      try {
        await verifyEmail(workspaceId, lead.id);
      } catch {
        /* A failed check leaves the lead unchecked; it is retried next round. */
      }
      checked++;
      continue;
    }
    if (research.autopilot?.domainCheckedAt) continue;
    const result = await mailDomainCheck(lead.email!);
    await db.platformLead.update({
      where: { workspaceId_id: { workspaceId, id: lead.id } },
      data: {
        ...(result ? { verificationStatus: result.status, verifiedAt: new Date() } : {}),
        research: {
          ...research,
          autopilot: { ...research.autopilot, domainCheckedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue,
      },
    });
    checked++;
  }
  return checked;
}

/**
 * Step 4: queue each campaign's email to checked businesses that belong to it and have never been
 * asked, up to two days' worth per campaign. Only campaigns with a live inbox queue anything.
 */
async function queueEmails(
  workspaceId: string,
  settings: OutreachSettings,
  campaigns: Map<string, { campaignId: string; live: number; dailyLimit: number }>,
  businessName: string,
  minimumScore: number,
) {
  const lanes = lanesOf(settings);
  const rooms = new Map<string, number>();
  for (const lane of lanes) {
    const campaign = campaigns.get(lane.id);
    if (!campaign?.live) continue;
    const queued = await db.platformCampaignRecipient.count({
      where: { workspaceId, campaignId: campaign.campaignId, status: "QUEUED" },
    });
    const room = Math.max(0, campaign.dailyLimit * 2 - queued);
    if (room) rooms.set(lane.id, room);
  }
  if (!rooms.size) return 0;
  const totalRoom = [...rooms.values()].reduce((sum, value) => sum + value, 0);
  const leads = await db.platformLead.findMany({
    where: {
      workspaceId,
      qualificationCategory: AUTOPILOT,
      email: { not: null },
      verificationStatus: "VALID",
      verifiedAt: { gte: new Date(Date.now() - 30 * DAY) },
      unsubscribedAt: null,
      repliedAt: null,
      status: { notIn: ["ARCHIVED", "UNSUBSCRIBED", "NOT_INTERESTED"] },
      eligibility: "UNKNOWN",
      recipients: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(2000, totalRoom * 4),
  });
  if (!leads.length) return 0;
  const [asked, suppressed] = await Promise.all([
    permissionAskedLeadIds(db, leads.map((lead) => lead.id)),
    db.platformMailSuppression.findMany({
      where: { workspaceId, email: { in: leads.map((lead) => lead.email!.toLowerCase()) } },
      select: { email: true },
    }),
  ]);
  const blockedEmails = new Set(suppressed.map((row) => row.email));
  const approvedAt = new Date(settings.approvedAt!);
  const data: Prisma.PlatformCampaignRecipientCreateManyInput[] = [];
  for (const lead of leads) {
    if (
      blockedEmails.has(lead.email!.toLowerCase()) ||
      excluded(settings.exclude, lead.company) ||
      permissionRequestBlocker(lead, minimumScore, asked.has(lead.id))
    )
      continue;
    const found = ((lead.research ?? {}) as { autopilot?: Record<string, unknown> }).autopilot;
    const lane: OutreachLane | null = laneFor(lanes, found);
    const room = lane ? (rooms.get(lane.id) ?? 0) : 0;
    if (!lane || !room) continue;
    rooms.set(lane.id, room - 1);
    data.push({
      workspaceId,
      campaignId: campaigns.get(lane.id)!.campaignId,
      leadId: lead.id,
      subject: personalizeFollowup(lane.subject, lead),
      body: withPermissionNotice(personalizeFollowup(lane.body, lead), businessName),
      approvedAt,
      approvedBy: settings.approvedBy,
    });
  }
  if (!data.length) return 0;
  return (await db.platformCampaignRecipient.createMany({ data, skipDuplicates: true })).count;
}

/** One autopilot round for every running client. Runs on the local worker. */
export async function outreachTick(provider = fetchWebsiteProspects) {
  const organizations = await controlDb.platformOrganization.findMany({
    where: { workspace: { status: "ACTIVE" }, onboardingStatus: { not: "DEMO" } },
    select: { workspaceId: true, outreach: true },
  });
  const results: Record<string, unknown>[] = [];
  for (const organization of organizations) {
    const settings = outreachSettings(organization.outreach);
    if (!settings.enabled || !settings.approvedAt || !settings.approvedBy) continue;
    results.push(
      await withTenantDatabase(organization.workspaceId, async () => {
        const workspaceId = organization.workspaceId;
        const [workspace, current] = await Promise.all([
          controlDb.workspace.findUniqueOrThrow({
            where: { id: workspaceId },
            select: { name: true },
          }),
          db.platformOrganization.findUniqueOrThrow({
            where: { workspaceId },
            select: { outreach: true, qualificationCriteria: true, profile: true },
          }),
        ]);
        const businessName = senderBusinessName(current.profile, workspace.name);
        let state = outreachSettings(current.outreach);
        const minimumScore = z
          .object({ minimumScore: z.number().optional() })
          .passthrough()
          .safeParse(current.qualificationCriteria);
        const threshold = minimumScore.success ? (minimumScore.data.minimumScore ?? 70) : 70;
        const waiting = await db.platformLead.count({
          where: {
            workspaceId,
            qualificationCategory: AUTOPILOT,
            recipients: { none: {} },
            status: { notIn: ["ARCHIVED", "UNSUBSCRIBED", "NOT_INTERESTED"] },
          },
        });
        let lastFind = null;
        const targets = searchTargets(lanesOf(state));
        // Search the next niche and area every 2 hours, but not while 300 found businesses still wait.
        if (
          targets.length &&
          waiting < 300 &&
          (!state.nextFindAt || new Date(state.nextFindAt) <= new Date())
        ) {
          const previous = state.lastFind;
          lastFind = await findBusinesses(
            workspaceId,
            state,
            targets[state.nicheCursor % targets.length],
            provider,
          );
          state = { ...state, ...nextSearch(state.nicheCursor, previous, lastFind), lastFind };
          await db.platformOrganization.update({
            where: { workspaceId },
            data: { outreach: asJson(state) },
          });
        }
        const emailsFound = await findEmails(workspaceId, 8);
        const emailsChecked = await checkEmails(workspaceId, 20);
        const campaigns = await syncCampaigns(workspaceId, state, businessName);
        const queued = await queueEmails(workspaceId, state, campaigns, businessName, threshold);
        const liveInboxes = Math.max(0, ...[...campaigns.values()].map((item) => item.live));
        return { workspaceId, lastFind, emailsFound, emailsChecked, queued, liveInboxes };
      }),
    );
  }
  return results;
}
