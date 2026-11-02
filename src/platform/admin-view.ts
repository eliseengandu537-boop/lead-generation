import { z } from "zod";
import { controlDb } from "@/lib/db";
import { currentUser, HttpError } from "@/lib/auth";
import { orchestrationConfig } from "./jobs";

type Totals = {
  clients: number;
  activeClients: number;
  websites: number;
  leads: number;
  discovered: number;
  qualified: number;
  sent: number;
  delivered: number;
  replies: number;
  positive: number;
  meetings: number;
  bounces: number;
  complaints: number;
  campaigns: number;
  activeCampaigns: number;
  executions: number;
  succeeded: number;
  failed: number;
  pending: number;
  usage: number;
};
type DirectoryRow = {
  workspaceId: string;
  name: string;
  status: string;
  websiteUrl: string;
  onboardingStatus: string;
  profileApprovedAt: Date | null;
  profile: unknown;
  targetCriteria: string;
  createdAt: Date;
  accountEmail: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  leads: number;
  discovered: number;
  qualified: number;
  sent: number;
  replies: number;
  positive: number;
  activeCampaigns: number;
  failedJobs: number;
  lastActivity: Date;
};
type SeriesRow = {
  day: string;
  sent: number;
  delivered: number;
  replies: number;
  positive: number;
  bounces: number;
  leads: number;
  clients: number;
  websites: number;
  executions: number;
  failed: number;
  usage: number;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const content = (value: unknown, fallback = "") =>
  typeof value === "string"
    ? value.slice(0, 2000)
    : Array.isArray(value)
      ? value
          .filter((entry) => typeof entry === "string")
          .slice(0, 15)
          .join(", ")
          .slice(0, 2000)
      : fallback;
function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export async function adminInsights(query: URLSearchParams) {
  const user = await currentUser();
  if (!user.agencyAdmin)
    throw new HttpError(403, "Platform administrator required");
  const schema = z.object({
    days: z.coerce.number().int().min(1).max(366).default(30),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    workspaceId: z.string().min(1).max(100).optional(),
  });
  const input = schema.parse(Object.fromEntries(query));
  const until = input.to
    ? new Date(`${input.to}T00:00:00+02:00`)
    : new Date(`${dateKey(new Date())}T00:00:00+02:00`);
  until.setUTCDate(until.getUTCDate() + 1);
  const since = input.from
    ? new Date(`${input.from}T00:00:00+02:00`)
    : new Date(until.getTime() - input.days * 86400000);
  const requestedEnd = new Date(until.getTime() - 86400000);
  if (
    !Number.isFinite(since.getTime()) ||
    !Number.isFinite(until.getTime()) ||
    (input.from && dateKey(since) !== input.from) ||
    (input.to && dateKey(requestedEnd) !== input.to) ||
    since >= until ||
    until.getTime() - since.getTime() > 366 * 86400000
  )
    throw new HttpError(400, "Choose a valid date range of up to 366 days");
  const workspaceId = input.workspaceId ?? null;
  const [
    totalsRows,
    directoryRows,
    timeSeries,
    campaignRows,
    jobRows,
    usageRows,
    leadGroups,
    mailboxGroups,
    activityRows,
  ] = await Promise.all([
    controlDb.$queryRaw<Totals[]>`
      SELECT
       (SELECT count(*)::int FROM "PlatformOrganization") AS clients,
       (SELECT count(*)::int FROM "PlatformOrganization" o JOIN "Workspace" w ON w.id=o."workspaceId" WHERE w.status='ACTIVE') AS "activeClients",
       (SELECT count(*)::int FROM "PlatformOrganization" WHERE "websiteUrl"<>'') AS websites,
       (SELECT count(*)::int FROM "PlatformLead" WHERE status<>'ARCHIVED') AS leads,
       (SELECT count(*)::int FROM "PlatformLead" WHERE status<>'ARCHIVED' AND "sourceKind"<>'MANUAL') AS discovered,
       (SELECT count(*)::int FROM "PlatformLead" l JOIN "PlatformOrganization" o ON o."workspaceId"=l."workspaceId" WHERE l.status<>'ARCHIVED' AND l."qualificationScore">=coalesce((o."qualificationCriteria"->>'minimumScore')::numeric,70)) AS qualified,
       (SELECT count(*)::int FROM "PlatformMailMessage" WHERE direction='OUTBOUND' AND status='ACCEPTED') AS sent,
       (SELECT count(DISTINCT "messageId")::int FROM "PlatformMailEvent" WHERE kind='DELIVERED') AS delivered,
       (SELECT count(*)::int FROM "PlatformMailMessage" WHERE direction='INBOUND') AS replies,
       (SELECT count(*)::int FROM "PlatformMailMessage" WHERE direction='INBOUND' AND classification IN ('INTERESTED','MORE_INFORMATION','PRICING','MEETING_REQUESTED')) AS positive,
       (SELECT count(*)::int FROM "PlatformMailMessage" WHERE direction='INBOUND' AND classification='MEETING_REQUESTED') AS meetings,
       (SELECT count(DISTINCT "messageId")::int FROM "PlatformMailEvent" WHERE kind='BOUNCE') AS bounces,
       (SELECT count(DISTINCT "messageId")::int FROM "PlatformMailEvent" WHERE kind='COMPLAINT') AS complaints,
       (SELECT count(*)::int FROM "PlatformCampaign") AS campaigns,
       (SELECT count(*)::int FROM "PlatformCampaign" WHERE status='RUNNING') AS "activeCampaigns",
       (SELECT count(*)::int FROM "PlatformJob") AS executions,
       (SELECT count(*)::int FROM "PlatformJob" WHERE status='SUCCEEDED') AS succeeded,
       (SELECT count(*)::int FROM "PlatformJob" WHERE status IN ('FAILED','REVIEW_REQUIRED')) AS failed,
       (SELECT count(*)::int FROM "PlatformJob" WHERE status IN ('QUEUED','WAITING_AUTOMATION','READY','RUNNING')) AS pending,
       (SELECT coalesce(sum(quantity),0)::int FROM "PlatformUsage") AS usage`,
    controlDb.$queryRaw<DirectoryRow[]>`
      SELECT o."workspaceId",w.name,w.status,o."websiteUrl",o."onboardingStatus",o."profileApprovedAt",o.profile,o."targetCriteria",o."createdAt",
       (SELECT u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."workspaceId"=o."workspaceId" AND m.role='CLIENT_ADMIN' ORDER BY u.email LIMIT 1) AS "accountEmail",
       (SELECT p.name FROM "PlatformSubscription" s JOIN "PlatformPlan" p ON p.id=s."planId" WHERE s."workspaceId"=o."workspaceId") AS "planName",
       (SELECT s.status FROM "PlatformSubscription" s WHERE s."workspaceId"=o."workspaceId") AS "subscriptionStatus",
       (SELECT count(*)::int FROM "PlatformLead" l WHERE l."workspaceId"=o."workspaceId" AND l.status<>'ARCHIVED') AS leads,
       (SELECT count(*)::int FROM "PlatformLead" l WHERE l."workspaceId"=o."workspaceId" AND l.status<>'ARCHIVED' AND l."sourceKind"<>'MANUAL') AS discovered,
       (SELECT count(*)::int FROM "PlatformLead" l WHERE l."workspaceId"=o."workspaceId" AND l.status<>'ARCHIVED' AND l."qualificationScore">=coalesce((o."qualificationCriteria"->>'minimumScore')::numeric,70)) AS qualified,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=o."workspaceId" AND m.direction='OUTBOUND' AND m.status='ACCEPTED') AS sent,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=o."workspaceId" AND m.direction='INBOUND') AS replies,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=o."workspaceId" AND m.direction='INBOUND' AND m.classification IN ('INTERESTED','MORE_INFORMATION','PRICING','MEETING_REQUESTED')) AS positive,
       (SELECT count(*)::int FROM "PlatformCampaign" c WHERE c."workspaceId"=o."workspaceId" AND c.status='RUNNING') AS "activeCampaigns",
       (SELECT count(*)::int FROM "PlatformJob" j WHERE j."workspaceId"=o."workspaceId" AND j.status IN ('FAILED','REVIEW_REQUIRED')) AS "failedJobs",
       GREATEST(o."updatedAt",(SELECT max(a."createdAt") FROM "PlatformActivity" a WHERE a."workspaceId"=o."workspaceId"),(SELECT max(m."createdAt") FROM "PlatformMailMessage" m WHERE m."workspaceId"=o."workspaceId")) AS "lastActivity"
      FROM "PlatformOrganization" o JOIN "Workspace" w ON w.id=o."workspaceId"
      WHERE (${workspaceId}::text IS NULL OR o."workspaceId"=${workspaceId})
      ORDER BY o."createdAt" DESC LIMIT 500`,
    controlDb.$queryRaw<SeriesRow[]>`
      WITH events AS (
       SELECT "createdAt" at, CASE WHEN direction='OUTBOUND' THEN 'sent' ELSE 'replies' END kind,1 amount FROM "PlatformMailMessage" WHERE (direction='INBOUND' OR status='ACCEPTED') AND "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT "createdAt",'positive',1 FROM "PlatformMailMessage" WHERE direction='INBOUND' AND classification IN ('INTERESTED','MORE_INFORMATION','PRICING','MEETING_REQUESTED') AND "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT min("occurredAt"),CASE WHEN kind='DELIVERED' THEN 'delivered' ELSE 'bounces' END,1 FROM "PlatformMailEvent" WHERE kind IN ('DELIVERED','BOUNCE') AND "occurredAt">=${since} AND "occurredAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId}) GROUP BY "messageId",kind
       UNION ALL SELECT "createdAt",'leads',1 FROM "PlatformLead" WHERE "sourceKind"<>'MANUAL' AND "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT "createdAt",'clients',1 FROM "PlatformOrganization" WHERE "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT "createdAt",'websites',1 FROM "PlatformNotice" WHERE kind='WEBSITE_ANALYZED' AND "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT "createdAt",'executions',1 FROM "PlatformJob" WHERE "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT coalesce("completedAt","createdAt"),'failed',1 FROM "PlatformJob" WHERE status IN ('FAILED','REVIEW_REQUIRED') AND coalesce("completedAt","createdAt")>=${since} AND coalesce("completedAt","createdAt")<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
       UNION ALL SELECT "createdAt",'usage',quantity FROM "PlatformUsage" WHERE "createdAt">=${since} AND "createdAt"<${until} AND (${workspaceId}::text IS NULL OR "workspaceId"=${workspaceId})
      ) SELECT to_char((at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg','YYYY-MM-DD') AS day,
       coalesce(sum(amount) FILTER(WHERE kind='sent'),0)::int sent,coalesce(sum(amount) FILTER(WHERE kind='delivered'),0)::int delivered,
       coalesce(sum(amount) FILTER(WHERE kind='replies'),0)::int replies,coalesce(sum(amount) FILTER(WHERE kind='positive'),0)::int positive,
       coalesce(sum(amount) FILTER(WHERE kind='bounces'),0)::int bounces,coalesce(sum(amount) FILTER(WHERE kind='leads'),0)::int leads,
       coalesce(sum(amount) FILTER(WHERE kind='clients'),0)::int clients,coalesce(sum(amount) FILTER(WHERE kind='websites'),0)::int websites,
       coalesce(sum(amount) FILTER(WHERE kind='executions'),0)::int executions,coalesce(sum(amount) FILTER(WHERE kind='failed'),0)::int failed,
       coalesce(sum(amount) FILTER(WHERE kind='usage'),0)::int usage FROM events GROUP BY day ORDER BY day`,
    controlDb.$queryRaw<
      {
        id: string;
        workspaceId: string;
        name: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        safetyPauseReason: string | null;
        recipients: number;
        sent: number;
        replies: number;
        positive: number;
      }[]
    >`
      SELECT c.id,c."workspaceId",c.name,c.status,c."createdAt",c."updatedAt",c."safetyPauseReason",
       (SELECT count(*)::int FROM "PlatformCampaignRecipient" r WHERE r."campaignId"=c.id) recipients,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=c."workspaceId" AND m."campaignId"=c.id AND m.direction='OUTBOUND' AND m.status='ACCEPTED') sent,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=c."workspaceId" AND m."campaignId"=c.id AND m.direction='INBOUND') replies,
       (SELECT count(*)::int FROM "PlatformMailMessage" m WHERE m."workspaceId"=c."workspaceId" AND m."campaignId"=c.id AND m.direction='INBOUND' AND m.classification IN ('INTERESTED','MORE_INFORMATION','PRICING','MEETING_REQUESTED')) positive
      FROM "PlatformCampaign" c WHERE (${workspaceId}::text IS NULL OR c."workspaceId"=${workspaceId}) ORDER BY c."updatedAt" DESC LIMIT 100`,
    controlDb.platformJob.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        createdAt: { gte: since, lt: until },
      },
      select: {
        id: true,
        workspaceId: true,
        kind: true,
        status: true,
        attempts: true,
        dispatchAttempts: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        runAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    controlDb.platformUsage.groupBy({
      by: ["kind"],
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        createdAt: { gte: since, lt: until },
      },
      _sum: { quantity: true },
      orderBy: { kind: "asc" },
      take: 50,
    }),
    controlDb.platformLead.groupBy({
      by: ["qualificationCategory"],
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        status: { not: "ARCHIVED" },
      },
      _count: { _all: true },
      orderBy: { qualificationCategory: "asc" },
      take: 20,
    }),
    controlDb.platformMailbox.groupBy({
      by: ["status"],
      where: workspaceId ? { workspaceId } : {},
      _count: { _all: true },
      orderBy: { status: "asc" },
      take: 20,
    }),
    controlDb.platformActivity.findMany({
      where: workspaceId ? { workspaceId } : {},
      select: { id: true, workspaceId: true, kind: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);
  if (workspaceId && !directoryRows.length)
    throw new HttpError(404, "Business website not found");
  const dayMap = new Map(timeSeries.map((day) => [day.day, day]));
  const series: SeriesRow[] = [];
  for (let time = since.getTime(); time < until.getTime(); time += 86400000) {
    const day = dateKey(new Date(time));
    series.push(
      dayMap.get(day) || {
        day,
        sent: 0,
        delivered: 0,
        replies: 0,
        positive: 0,
        bounces: 0,
        leads: 0,
        clients: 0,
        websites: 0,
        executions: 0,
        failed: 0,
        usage: 0,
      },
    );
  }
  const directories = directoryRows.map(({ profile: raw, ...row }) => {
    const profile = object(raw);
    return {
      ...row,
      industry: content(profile.industry),
      targetMarket: content(profile.targetCustomers) || row.targetCriteria,
      analysis: {
        summary: content(profile.niche),
        products: content(profile.products),
        services: content(profile.services),
        geography: [content(profile.location), content(profile.serviceAreas)]
          .filter(Boolean)
          .join(" · "),
        targetAudience: content(profile.targetCustomers),
        industry: content(profile.industry),
      },
      connectionStatus: !row.websiteUrl
        ? "NOT_CONNECTED"
        : row.status !== "ACTIVE"
          ? "SUSPENDED"
          : "CONNECTED",
      analysisStatus: row.profileApprovedAt
        ? "APPROVED"
        : content(profile.companyName)
          ? "AWAITING_REVIEW"
          : "NOT_ANALYZED",
    };
  });
  let n8nConfigured = false;
  try {
    n8nConfigured = Boolean(orchestrationConfig());
  } catch {
    /* Invalid configuration is reported as unconfigured. */
  }
  return {
    generatedAt: new Date().toISOString(),
    timezone: "Africa/Johannesburg",
    range: { from: dateKey(since), to: dateKey(new Date(until.getTime() - 1)) },
    totals: totalsRows[0],
    directory: directories,
    series,
    campaigns: campaignRows,
    jobs: jobRows,
    usage: usageRows.map((row) => ({
      kind: row.kind,
      quantity: row._sum.quantity || 0,
    })),
    leadCategories: leadGroups.map((row) => ({
      category: row.qualificationCategory || "UNSCORED",
      count: row._count._all,
    })),
    mailboxStatuses: mailboxGroups.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    activity: activityRows,
    directoryLimit: 500,
    configuration: {
      google: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
      liveEmail: process.env.LIVE_EMAIL_ENABLED === "true",
      n8n: n8nConfigured,
      encryption: Boolean(process.env.ENCRYPTION_KEY),
      tenantDatabase: Boolean(process.env.TENANT_DATABASE_URL),
    },
  };
}
