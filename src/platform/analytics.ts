import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
export async function reportData(
  workspaceId: string,
  options: { days?: number; start?: Date; end?: Date; period?: string } = {},
) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { timezone: true },
  });
  const end = options.end || new Date();
  let start =
    options.start || new Date(end.getTime() - (options.days || 30) * 86400000);
  if (options.period === "today" || options.period === "yesterday") {
    const [local] = await db.$queryRaw<
      { start: Date }[]
    >`SELECT (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE ${workspace.timezone}) AT TIME ZONE ${workspace.timezone}) AT TIME ZONE 'UTC' AS start`;
    start = local.start;
    if (options.period === "yesterday") {
      end.setTime(start.getTime());
      start = new Date(start.getTime() - 86400000);
    }
  }
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    end.getTime() - start.getTime() > 366 * 86400000
  )
    throw new HttpError(400, "Choose a valid date range of up to 366 days");
  const createdAt = { gte: start, lt: end };
  const where = { workspaceId };
  const [
    leads,
    qualified,
    hot,
    sent,
    events,
    replies,
    scheduled,
    campaigns,
    series,
  ] = await Promise.all([
    db.platformLead.count({
      where: { ...where, createdAt, status: { not: "ARCHIVED" } },
    }),
    db.platformLead.count({
      where: {
        ...where,
        qualifiedAt: createdAt,
        qualificationScore: { gte: 50 },
      },
    }),
    db.platformLead.count({
      where: { ...where, qualifiedAt: createdAt, qualificationCategory: "HOT" },
    }),
    db.platformMailMessage.count({
      where: { ...where, createdAt, direction: "OUTBOUND", status: "ACCEPTED" },
    }),
    db.platformMailEvent.findMany({
      where: { ...where, occurredAt: createdAt },
      select: { messageId: true, kind: true },
    }),
    db.platformMailMessage.findMany({
      where: { ...where, createdAt, direction: "INBOUND" },
      select: { id: true, classification: true, campaignId: true },
    }),
    db.platformCampaignRecipient.count({
      where: { ...where, status: "QUEUED", campaign: { status: "RUNNING" } },
    }),
    db.platformCampaign.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.$queryRaw<
      { day: string; metric: string; count: bigint }[]
    >`SELECT to_char(date_trunc('day',stamp AT TIME ZONE 'UTC' AT TIME ZONE ${workspace.timezone}),'YYYY-MM-DD') AS day,metric,count(*) AS count FROM (SELECT "createdAt" AS stamp,'sent' AS metric FROM "PlatformMailMessage" WHERE "workspaceId"=${workspaceId} AND direction='OUTBOUND' AND status='ACCEPTED' UNION ALL SELECT "createdAt",'replies' FROM "PlatformMailMessage" WHERE "workspaceId"=${workspaceId} AND direction='INBOUND' UNION ALL SELECT "createdAt",'discovered' FROM "PlatformLead" WHERE "workspaceId"=${workspaceId} AND "sourceKind"<>'MANUAL' UNION ALL SELECT "qualifiedAt",'qualified' FROM "PlatformLead" WHERE "workspaceId"=${workspaceId} AND "qualificationScore">=50) records WHERE stamp>=(${start}::timestamptz AT TIME ZONE 'UTC') AND stamp<(${end}::timestamptz AT TIME ZONE 'UTC') GROUP BY day,metric ORDER BY day`,
  ]);
  const countEvents = (kind: string) =>
    new Set(
      events
        .filter((event) => event.kind === kind)
        .map((event) => event.messageId),
    ).size;
  const positiveCategories = [
    "INTERESTED",
    "PRICING",
    "REQUESTING_PRICING",
    "MEETING_REQUESTED",
  ];
  const positiveReplies = replies.filter((reply) =>
    positiveCategories.includes(reply.classification || ""),
  ).length;
  const metrics = {
    businessesDiscovered: await db.platformLead.count({
      where: { ...where, createdAt, sourceKind: { not: "MANUAL" } },
    }),
    totalLeads: leads,
    qualifiedLeads: qualified,
    hotLeads: hot,
    emailsScheduled: scheduled,
    emailsSent: sent,
    emailsDelivered: countEvents("DELIVERED"),
    emailsOpened: null,
    replies: replies.length,
    positiveReplies,
    interestedProspects: replies.filter(
      (reply) => reply.classification === "INTERESTED",
    ).length,
    meetingsRequested: replies.filter(
      (reply) => reply.classification === "MEETING_REQUESTED",
    ).length,
    bounces: countEvents("BOUNCE"),
    complaints: countEvents("COMPLAINT"),
    unsubscribes: countEvents("UNSUBSCRIBE"),
    activeCampaigns: campaigns.filter((c) => c.status === "RUNNING").length,
    replyRate: sent ? Math.round((replies.length / sent) * 1000) / 10 : 0,
    positiveReplyRate: replies.length
      ? Math.round((positiveReplies / replies.length) * 1000) / 10
      : 0,
    converted: await db.platformLead.count({
      where: { ...where, status: "CONVERTED", updatedAt: createdAt },
    }),
  };
  const days = new Map<string, Record<string, string | number>>();
  for (const row of series) {
    const value = days.get(row.day) || {
      date: row.day,
      sent: 0,
      replies: 0,
      discovered: 0,
      qualified: 0,
    };
    value[row.metric] = Number(row.count);
    days.set(row.day, value);
  }
  const campaignPerformance = [];
  for (const campaign of campaigns) {
    const [accepted, feedback] = await Promise.all([
      db.platformMailMessage.count({
        where: {
          workspaceId,
          campaignId: campaign.id,
          direction: "OUTBOUND",
          status: "ACCEPTED",
          createdAt,
        },
      }),
      db.platformMailEvent.findMany({
        where: {
          workspaceId,
          occurredAt: createdAt,
          messageId: {
            in: (
              await db.platformMailMessage.findMany({
                where: { workspaceId, campaignId: campaign.id },
                select: { id: true },
              })
            ).map((message) => message.id),
          },
        },
        select: { kind: true, messageId: true },
      }),
    ]);
    campaignPerformance.push({
      ...campaign,
      sent: accepted,
      replies: replies.filter((r) => r.campaignId === campaign.id).length,
      positiveReplies: replies.filter(
        (r) =>
          r.campaignId === campaign.id &&
          positiveCategories.includes(r.classification || ""),
      ).length,
      bounces: new Set(
        feedback.filter((e) => e.kind === "BOUNCE").map((e) => e.messageId),
      ).size,
    });
  }
  return {
    metrics,
    series: [...days.values()],
    campaigns: campaignPerformance,
    start,
    end,
    timezone: workspace.timezone,
    definitions: {
      sent: "Provider accepted; not confirmed delivery",
      delivered: "Only a supported provider's confirmed delivery events",
      opened: "Unavailable: no reliable open tracking configured",
      scheduled: "Current queued recipients in running campaigns",
      replyRate:
        "Replies recorded in the selected period divided by messages accepted in that period; may include replies to earlier sends",
    },
  };
}
