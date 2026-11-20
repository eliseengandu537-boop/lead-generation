import { z } from "zod";
import { controlDb } from "@/lib/db";
import { currentUser, HttpError } from "@/lib/auth";

async function platformAdmin() {
  const user = await currentUser();
  if (!user.agencyAdmin)
    throw new HttpError(403, "Platform administrator required.");
  return user;
}

/**
 * Sales pipeline stages, derived from what actually happened to each lead.
 * A scheduled call always puts the lead in "Call booked", so a booking shows up
 * in the pipeline even when the lead's own status was never updated.
 */
export const pipelineStages = [
  { id: "CONTACTED", label: "Contacted", status: "CONTACTED" },
  { id: "INTERESTED", label: "Interested", status: "INTERESTED" },
  { id: "BOOKED", label: "Call booked", status: "MEETING_BOOKED" },
  { id: "WON", label: "Won", status: "CONVERTED" },
  { id: "LOST", label: "Lost", status: "NOT_INTERESTED" },
] as const;
type StageId = (typeof pipelineStages)[number]["id"];
const stageOrder: StageId[] = ["CONTACTED", "INTERESTED", "BOOKED", "WON", "LOST"];
const cardsPerStage = 40;

type StagedLead = {
  id: string;
  workspaceId: string;
  business: string;
  demo: boolean;
  company: string;
  name: string;
  email: string | null;
  phone: string;
  location: string;
  status: string;
  updatedAt: Date;
  repliedAt: Date | null;
  bookingId: string | null;
  bookingAt: Date | null;
  bookingTitle: string | null;
  lastCallAt: Date | null;
  lastCallOutcome: string | null;
  stage: StageId;
  total: number;
};

export async function pipelineRead(query = new URLSearchParams()) {
  await platformAdmin();
  const { workspaceId } = z
    .object({ workspaceId: z.string().min(1).max(100).optional() })
    .parse(Object.fromEntries(query));
  const scope = workspaceId ?? null;
  const [cards, counts, bookings] = await Promise.all([
    controlDb.$queryRaw<StagedLead[]>`
      WITH staged AS (
        SELECT l.id, l."workspaceId", w.name AS business, (o."onboardingStatus"='DEMO') AS demo,
          l.company, l.name, l.email, l.phone, l.location, l.status, l."updatedAt", l."repliedAt",
          b.id AS "bookingId", b."startAt" AS "bookingAt", b.title AS "bookingTitle",
          c."createdAt" AS "lastCallAt", c.outcome AS "lastCallOutcome",
          CASE
            WHEN l.status='CONVERTED' THEN 'WON'
            WHEN l.status IN ('NOT_INTERESTED','UNSUBSCRIBED') THEN 'LOST'
            WHEN l.status='MEETING_BOOKED' OR b.id IS NOT NULL THEN 'BOOKED'
            WHEN l.status IN ('REPLIED','INTERESTED') OR l."salesQualification"='QUALIFIED' THEN 'INTERESTED'
            WHEN l.status IN ('CONTACTED','OUTREACH_SCHEDULED') OR c.id IS NOT NULL THEN 'CONTACTED'
          END AS stage
        FROM "PlatformLead" l
        JOIN "PlatformOrganization" o ON o."workspaceId"=l."workspaceId"
        JOIN "Workspace" w ON w.id=l."workspaceId"
        LEFT JOIN LATERAL (
          SELECT pb.id, pb."startAt", pb.title FROM "PlatformBooking" pb
          WHERE pb."workspaceId"=l."workspaceId" AND pb."leadId"=l.id AND pb.status='SCHEDULED'
          ORDER BY pb."startAt" ASC LIMIT 1) b ON true
        LEFT JOIN LATERAL (
          SELECT pc.id, pc."createdAt", pc.outcome FROM "PlatformCall" pc
          WHERE pc."workspaceId"=l."workspaceId" AND pc."leadId"=l.id
          ORDER BY pc."createdAt" DESC LIMIT 1) c ON true
        WHERE l.status<>'ARCHIVED' AND w.status='ACTIVE'
          AND (${scope}::text IS NULL OR l."workspaceId"=${scope})
      ), ranked AS (
        SELECT staged.*, count(*) OVER (PARTITION BY stage)::int AS total,
          row_number() OVER (PARTITION BY stage ORDER BY
            CASE WHEN "bookingAt">=now() THEN 0 ELSE 1 END,
            CASE WHEN "bookingAt">=now() THEN "bookingAt" END ASC,
            coalesce("lastCallAt","repliedAt","updatedAt") DESC)::int AS position
        FROM staged WHERE stage IS NOT NULL
      ) SELECT * FROM ranked WHERE position<=${cardsPerStage} ORDER BY stage, position`,
    controlDb.$queryRaw<{ stage: StageId; total: number }[]>`
      SELECT stage, count(*)::int AS total FROM (
        SELECT CASE
            WHEN l.status='CONVERTED' THEN 'WON'
            WHEN l.status IN ('NOT_INTERESTED','UNSUBSCRIBED') THEN 'LOST'
            WHEN l.status='MEETING_BOOKED' OR EXISTS (SELECT 1 FROM "PlatformBooking" pb WHERE pb."workspaceId"=l."workspaceId" AND pb."leadId"=l.id AND pb.status='SCHEDULED') THEN 'BOOKED'
            WHEN l.status IN ('REPLIED','INTERESTED') OR l."salesQualification"='QUALIFIED' THEN 'INTERESTED'
            WHEN l.status IN ('CONTACTED','OUTREACH_SCHEDULED') OR EXISTS (SELECT 1 FROM "PlatformCall" pc WHERE pc."workspaceId"=l."workspaceId" AND pc."leadId"=l.id) THEN 'CONTACTED'
          END AS stage
        FROM "PlatformLead" l JOIN "Workspace" w ON w.id=l."workspaceId"
        WHERE l.status<>'ARCHIVED' AND w.status='ACTIVE'
          AND (${scope}::text IS NULL OR l."workspaceId"=${scope})
      ) s WHERE stage IS NOT NULL GROUP BY stage`,
    controlDb.platformBooking.groupBy({
      by: ["status"],
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        organization: { workspace: { status: "ACTIVE" } },
      },
      _count: { _all: true },
    }),
  ]);
  const now = Date.now();
  const upcoming = cards.filter(
    (card) =>
      card.bookingAt &&
      card.bookingAt.getTime() >= now &&
      card.bookingAt.getTime() < now + 7 * 86400000,
  ).length;
  return {
    generatedAt: new Date().toISOString(),
    stages: stageOrder.map((id) => {
      const stage = pipelineStages.find((item) => item.id === id)!;
      return {
        id,
        label: stage.label,
        total: counts.find((row) => row.stage === id)?.total ?? 0,
        cards: cards
          .filter((card) => card.stage === id)
          .map((card) => {
            const { total, ...rest } = card;
            void total;
            return rest;
          }),
      };
    }),
    bookings: {
      scheduled:
        bookings.find((row) => row.status === "SCHEDULED")?._count._all ?? 0,
      completed:
        bookings.find((row) => row.status === "COMPLETED")?._count._all ?? 0,
      noShow: bookings.find((row) => row.status === "NO_SHOW")?._count._all ?? 0,
      nextSevenDays: upcoming,
    },
  };
}

export async function pipelineWrite(raw: unknown) {
  const admin = await platformAdmin();
  const input = z
    .object({
      action: z.literal("move"),
      workspaceId: z.string().min(1).max(100),
      leadId: z.string().min(1).max(100),
      stage: z.enum(["CONTACTED", "INTERESTED", "BOOKED", "WON", "LOST"]),
    })
    .parse(raw);
  const stage = pipelineStages.find((item) => item.id === input.stage)!;
  return controlDb.$transaction(async (tx) => {
    const lead = await tx.platformLead.findFirst({
      where: {
        workspaceId: input.workspaceId,
        id: input.leadId,
        status: { not: "ARCHIVED" },
      },
      select: { id: true, company: true, status: true },
    });
    if (!lead) throw new HttpError(404, "Lead not found.");
    if (["CONTACTED", "INTERESTED"].includes(input.stage)) {
      const booking = await tx.platformBooking.findFirst({
        where: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          status: "SCHEDULED",
        },
        select: { startAt: true },
      });
      if (booking)
        throw new HttpError(
          409,
          `${lead.company} has a call booked for ${booking.startAt.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Mark that call completed or cancelled first.`,
        );
    }
    await tx.platformLead.update({
      where: { workspaceId_id: { workspaceId: input.workspaceId, id: lead.id } },
      data: { status: stage.status },
    });
    await tx.platformActivity.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: admin.id,
        kind: "PIPELINE_STAGE_CHANGED",
        detail: `${lead.company} moved to ${stage.label}.`.slice(0, 1000),
      },
    });
    return { message: `${lead.company} moved to ${stage.label}.` };
  });
}

const clip = (value: string, length = 4000) =>
  value.length > length ? `${value.slice(0, length)}…` : value;

/** Email scripts and templates for every client, for the admin content library. */
export async function contentRead() {
  await platformAdmin();
  const [templates, campaigns, businesses] = await Promise.all([
    controlDb.platformTemplate.findMany({
      where: { organization: { workspace: { status: "ACTIVE" } } },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        subject: true,
        body: true,
        category: true,
        approvalStatus: true,
        updatedAt: true,
        _count: { select: { campaigns: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    controlDb.platformCampaign.findMany({
      where: { organization: { workspace: { status: "ACTIVE" } } },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        subject: true,
        body: true,
        steps: true,
        status: true,
        purpose: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    controlDb.platformOrganization.findMany({
      where: { workspace: { status: "ACTIVE" } },
      select: {
        workspaceId: true,
        onboardingStatus: true,
        workspace: { select: { name: true } },
      },
    }),
  ]);
  return {
    businesses: businesses.map((business) => ({
      workspaceId: business.workspaceId,
      name: business.workspace.name,
      demo: business.onboardingStatus === "DEMO",
    })),
    templates: templates.map(({ _count, body, ...template }) => ({
      ...template,
      body: clip(body),
      campaigns: _count.campaigns,
    })),
    campaigns: campaigns.map(({ steps, body, ...campaign }) => ({
      ...campaign,
      body: clip(body),
      followUps: Array.isArray(steps) ? steps.length : 0,
    })),
  };
}
