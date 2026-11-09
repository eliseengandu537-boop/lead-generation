import { Prisma } from "@prisma/client";
import { z } from "zod";
import { controlDb } from "@/lib/db";
import { HttpError, rateLimit } from "@/lib/auth";
import { callerAccess } from "./access";
import { gautengDayStart } from "./prospect-options";
import {
  allBusinessTypes,
  allSouthAfrica,
  matchesBusinessType,
  matchesSouthAfricanArea,
  matchesProspectingScope,
  normalizedSearch,
  type ProspectAddress,
} from "./prospect-search";
import { fetchWebsiteProspects, type ProspectCandidate } from "./overture";
import { phoneNumber } from "./rules";
import { normalizedCalendlyPage } from "./calendly-options";

export const calendlySchedulingUrl = z.string().transform((value, context) => {
  const page = normalizedCalendlyPage(value);
  if (page !== null) return page;
  context.addIssue({
    code: "custom",
    message:
      "Enter a Calendly event link, such as https://calendly.com/your-name/30min.",
  });
  return z.NEVER;
});

const businessQuery = z
  .string()
  .trim()
  .max(120)
  .refine(
    (value) =>
      !/[\r\n\x00-\x1f]/.test(value) &&
      (allBusinessTypes(value) || normalizedSearch(value).length >= 2),
    "Enter a business type, such as plumbers or dentists.",
  )
  .transform((value) => (allBusinessTypes(value) ? "ALL" : value));
const areaQuery = z
  .string()
  .trim()
  .max(160)
  .refine(
    (value) =>
      !/[\r\n\x00-\x1f]/.test(value) &&
      (allSouthAfrica(value) || normalizedSearch(value).length >= 2),
    "Enter South Africa, a province, town or suburb.",
  )
  .transform((value) => (allSouthAfrica(value) ? "South Africa" : value));
export const prospectRequest = z
  .object({
    industry: businessQuery.default("ALL"),
    city: areaQuery.default("South Africa"),
    requestId: z.uuid(),
  })
  .strict();
export const prospectConfiguration = z
  .object({
    action: z.literal("configure-prospecting"),
    workspaceId: z.string().min(1),
    enabled: z.boolean(),
    categories: z.array(businessQuery).min(1).max(20),
    cities: z.array(areaQuery).min(1).max(30),
    dailyLimit: z.number().int().min(1).max(250),
    dailyCallTarget: z.number().int().min(1).max(500).default(100),
    requireMissingWebsite: z.boolean().default(true),
    maxQueue: z.number().int().min(10).max(250),
    meetingHostId: z.string().min(1).optional(),
    calendlyUrl: calendlySchedulingUrl.optional(),
    notifyAdminEmail: z.boolean().default(true),
  })
  .strict();
export const readyLeadWhere = {
  websitePresence: { in: ["NO_WEBSITE_LISTED", "WEBSITE_LISTED"] },
  doNotCall: false,
  unsubscribedAt: null,
  phone: { not: "" },
  status: { notIn: ["ARCHIVED", "UNSUBSCRIBED"] },
  salesQualification: "UNREVIEWED",
  calls: { none: { outcome: { not: "UNRECORDED" } } },
} satisfies Prisma.PlatformLeadWhereInput;

/** Match normalized numbers across duplicate listings and different callers.
 * A prepared dialler handoff alone is not a completed call attempt. */
export async function withoutCalledNumbers<T extends { phone: string }>(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  leads: T[],
) {
  const worked = await tx.platformCall.findMany({
    where: { workspaceId, outcome: { not: "UNRECORDED" } },
    select: { toNumber: true },
    distinct: ["toNumber"],
  });
  const key = (value: string) => {
    try {
      return phoneNumber(value);
    } catch {
      return null;
    }
  };
  const numbers = new Set(
    worked.map((row) => key(row.toNumber)).filter(Boolean),
  );
  return leads.filter((lead) => {
    const number = key(lead.phone);
    return number && !numbers.has(number);
  });
}

export async function requestProspectQueue(workspaceId: string, raw: unknown) {
  const { user } = await callerAccess(workspaceId);
  const input = prospectRequest.parse(raw);
  await rateLimit(`prospecting-request:${user.id}`, 12, 60);
  return controlDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const config = await tx.platformProspectingConfig.findUnique({
      where: { businessId: workspaceId },
    });
    if (!config?.enabled)
      throw new HttpError(
        409,
        "Automatic prospecting is being set up by your administrator. Your existing leads are ready to work.",
      );
    const same = await tx.platformProspectSearch.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId,
          idempotencyKey: `${user.id}:${input.requestId}`,
        },
      },
    });
    if (same)
      return { search: same, message: "Your search request is already saved." };
    const active = await tx.platformProspectSearch.findFirst({
      where: { workspaceId, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (active)
      return {
        search: active,
        message:
          "Prospect research is already running. New leads will appear automatically.",
      };
    const recent = await tx.platformProspectSearch.findFirst({
      where: {
        workspaceId,
        industry: input.industry,
        city: input.city,
        createdAt: { gt: new Date(Date.now() - 10 * 60000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent)
      return {
        search: recent,
        message:
          recent.status === "COMPLETED"
            ? "This area was checked recently. Work your ready leads or try another area."
            : "The last search could not finish. It can be retried after a short cooldown.",
      };
    const search = await tx.platformProspectSearch.create({
      data: {
        workspaceId,
        actorId: user.id,
        idempotencyKey: `${user.id}:${input.requestId}`,
        industry: input.industry,
        city: input.city,
      },
    });
    return {
      search,
      message: `Finding ${allBusinessTypes(input.industry) ? "businesses" : input.industry} in ${input.city} with public phone numbers${config.requireMissingWebsite ? " and no website listed" : ", with or without websites"}. Results appear when the search finishes; your administrator’s queue limits still apply.`,
    };
  });
}

export async function saveProspectingConfiguration(
  adminId: string,
  raw: unknown,
) {
  const input = prospectConfiguration.parse(raw);
  if (
    !(await controlDb.platformOrganization.findFirst({
      where: {
        workspaceId: input.workspaceId,
        onboardingStatus: { not: "DEMO" },
        workspace: { status: "ACTIVE" },
      },
      select: { workspaceId: true },
    }))
  )
    throw new HttpError(400, "Choose an active business.");
  if (
    input.meetingHostId &&
    !(await controlDb.user.findFirst({
      where: { id: input.meetingHostId, agencyAdmin: true, disabledAt: null },
      select: { id: true },
    }))
  )
    throw new HttpError(
      400,
      "Choose an active administrator as the meeting host.",
    );
  const { action: _action, workspaceId, ...settings } = input;
  void _action;
  await controlDb.platformProspectingConfig.upsert({
    where: { businessId: workspaceId },
    create: { businessId: workspaceId, ...settings, updatedBy: adminId },
    update: { ...settings, updatedBy: adminId, nextRunAt: new Date() },
  });
  return {
    message: input.enabled
      ? "Daily prospect research enabled. The automation worker prepares leads while it is online."
      : "Automatic prospect research paused.",
  };
}

export async function importProspectCandidates(
  workspaceId: string,
  actorId: string | null,
  candidates: ProspectCandidate[],
  limit: number,
  tx: Prisma.TransactionClient,
) {
  const existing = await tx.platformLead.findMany({
    where: { workspaceId },
    select: { sourceRecordId: true, phone: true },
    take: 20000,
  });
  const ids = new Set(existing.map((row) => row.sourceRecordId));
  const phones = new Set(
    existing.flatMap((row) => {
      try {
        return [phoneNumber(row.phone)];
      } catch {
        return [];
      }
    }),
  );
  const blocked = await tx.platformCall.findMany({
    where: { workspaceId, outcome: { not: "UNRECORDED" } },
    select: { toNumber: true },
  });
  blocked.forEach((row) => {
    try {
      phones.add(phoneNumber(row.toNumber));
    } catch {
      /* Ignore incomplete historical numbers. */
    }
  });
  const data: Prisma.PlatformLeadCreateManyInput[] = [];
  for (const candidate of candidates) {
    if (
      data.length >= limit ||
      ids.has(candidate.sourceRecordId) ||
      phones.has(candidate.phone)
    )
      continue;
    data.push({
      workspaceId,
      company: candidate.company,
      phone: candidate.phone,
      email: candidate.email,
      industry: candidate.industry,
      location: candidate.location,
      sourceKind: "OVERTURE",
      sourceRecordId: candidate.sourceRecordId,
      sourceUrl: "https://docs.overturemaps.org/guides/places/",
      website: candidate.website,
      websitePresence: candidate.websitePresence,
      websiteCheckedAt: new Date(),
      websiteEvidence: candidate.evidence as Prisma.InputJsonValue,
      createdById: actorId,
      notes:
        "Public business listing for your sales queue. Confirm the phone number, decision maker and business needs during the call. Listing details and contact numbers have not been independently verified.",
    });
    ids.add(candidate.sourceRecordId);
    phones.add(candidate.phone);
  }
  return data.length ? (await tx.platformLead.createMany({ data })).count : 0;
}

export async function countReadyProspects(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  config: {
    categories: unknown;
    cities: unknown;
    requireMissingWebsite: boolean;
  },
) {
  const leads = await tx.platformLead.findMany({
    where: { workspaceId, ...readyLeadWhere },
    select: {
      phone: true,
      company: true,
      industry: true,
      location: true,
      websitePresence: true,
      websiteEvidence: true,
    },
  });
  return (await withoutCalledNumbers(tx, workspaceId, leads)).filter((lead) =>
    matchesProspectingScope(lead, config),
  ).length;
}

export async function prospectingTick(provider = fetchWebsiteProspects) {
  // These jobs read public data directly on the local worker; they do not need
  // the hosted web to stay awake or an n8n/provider credential.
  await controlDb.platformProspectSearch.updateMany({
    where: { status: "RUNNING", leaseUntil: { lt: new Date() } },
    data: {
      status: "FAILED",
      error:
        "Research worker stopped before this search finished. Your existing leads are safe.",
      completedAt: new Date(),
      leaseUntil: null,
    },
  });
  const configs = await controlDb.platformProspectingConfig.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: new Date() },
      organization: {
        onboardingStatus: { not: "DEMO" },
        workspace: {
          status: "ACTIVE",
          memberships: {
            some: {
              role: "CALLER",
              user: { disabledAt: null, staffRole: "CALLER" },
            },
          },
        },
      },
    },
    take: 10,
  });
  for (const config of configs)
    await controlDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${config.businessId}))`;
      const current = await tx.platformProspectingConfig.findUnique({
        where: { businessId: config.businessId },
      });
      if (!current?.enabled || current.nextRunAt > new Date()) return;
      const today = gautengDayStart();
      const tomorrow = new Date(today.getTime() + 86400000);
      const used = await tx.platformLead.count({
        where: {
          workspaceId: config.businessId,
          sourceKind: "OVERTURE",
          createdAt: { gte: today },
        },
      });
      const ready = await countReadyProspects(tx, config.businessId, current);
      const batches = await tx.platformProspectSearch.count({
        where: {
          workspaceId: config.businessId,
          idempotencyKey: { startsWith: "daily:" },
          createdAt: { gte: today },
        },
      });
      if (
        used >= current.dailyLimit ||
        ready >= current.maxQueue ||
        batches >= 10
      ) {
        await tx.platformProspectingConfig.update({
          where: { businessId: config.businessId },
          data: { nextRunAt: tomorrow },
        });
        return;
      }
      if (
        !(await tx.platformProspectSearch.findFirst({
          where: {
            workspaceId: config.businessId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          select: { id: true },
        }))
      )
        await tx.platformProspectSearch.create({
          data: {
            workspaceId: config.businessId,
            idempotencyKey: `daily:${today.toISOString().slice(0, 10)}:batch:${batches}`,
            city: "South Africa",
          },
        });
      await tx.platformProspectingConfig.update({
        where: { businessId: config.businessId },
        data: { nextRunAt: new Date(Date.now() + 5 * 60000) },
      });
    });
  const search = await controlDb.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT s.id FROM "PlatformProspectSearch" s JOIN "PlatformProspectingConfig" c ON c."businessId"=s."workspaceId" JOIN "Workspace" w ON w.id=s."workspaceId" WHERE s.status='QUEUED' AND c.enabled=true AND w.status='ACTIVE' ORDER BY s."createdAt" FOR UPDATE OF s SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return tx.platformProspectSearch.update({
      where: { id: rows[0].id },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        leaseUntil: new Date(Date.now() + 10 * 60000),
      },
    });
  });
  if (!search) return false;
  try {
    const config = await controlDb.platformProspectingConfig.findUniqueOrThrow({
      where: { businessId: search.workspaceId },
    });
    if (
      search.actorId &&
      !(await controlDb.user.findFirst({
        where: {
          id: search.actorId,
          disabledAt: null,
          OR: [
            { agencyAdmin: true },
            {
              staffRole: "CALLER",
              memberships: {
                some: { workspaceId: search.workspaceId, role: "CALLER" },
              },
            },
          ],
        },
        select: { id: true },
      }))
    )
      throw new Error("Access changed");
    const ready = await countReadyProspects(
      controlDb,
      search.workspaceId,
      config,
    );
    const today = gautengDayStart();
    const used = await controlDb.platformLead.count({
      where: {
        workspaceId: search.workspaceId,
        sourceKind: "OVERTURE",
        createdAt: { gte: today },
      },
    });
    const remaining = Math.max(
      0,
      Math.min(config.dailyLimit - used, config.maxQueue - ready),
    );
    if (remaining === 0) {
      await controlDb.platformProspectSearch.update({
        where: { id: search.id },
        data: {
          status: "COMPLETED",
          summary:
            "Your queue is stocked or today's research allowance has been reached.",
          completedAt: new Date(),
          leaseUntil: null,
        },
      });
      await controlDb.platformProspectingConfig.update({
        where: { businessId: search.workspaceId },
        data: {
          lastRunAt: new Date(),
          lastStatus: "COMPLETED",
          lastError: null,
        },
      });
      return true;
    }
    const existing = await controlDb.platformLead.findMany({
      where: { workspaceId: search.workspaceId, sourceRecordId: { not: null } },
      select: { sourceRecordId: true },
      take: 20000,
    });
    const categories = z.array(businessQuery).parse(config.categories);
    const cities = z.array(areaQuery).parse(config.cities);
    const found = await provider({
      industry: search.industry,
      city: search.city,
      cities,
      categories,
      exclude: existing.map((row) => row.sourceRecordId!),
      limit: Math.min(50, remaining * 2),
      requireMissingWebsite: config.requireMissingWebsite,
    });
    await controlDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${search.workspaceId}))`;
      const current = await tx.platformProspectingConfig.findUnique({
        where: { businessId: search.workspaceId },
      });
      if (
        !current?.enabled ||
        !(await tx.workspace.findFirst({
          where: { id: search.workspaceId, status: "ACTIVE" },
        }))
      )
        throw new Error("Access changed");
      if (
        search.actorId &&
        !(await tx.user.findFirst({
          where: {
            id: search.actorId,
            disabledAt: null,
            OR: [
              { agencyAdmin: true },
              {
                staffRole: "CALLER",
                memberships: {
                  some: { workspaceId: search.workspaceId, role: "CALLER" },
                },
              },
            ],
          },
          select: { id: true },
        }))
      )
        throw new Error("Access changed");
      const allowedCategories = z.array(z.string()).parse(current.categories);
      const allowedCities = z.array(z.string()).parse(current.cities);
      const candidates = found.candidates.filter((candidate) => {
        const address = (candidate.evidence.address || {}) as ProspectAddress;
        const facts = [
          candidate.company,
          candidate.industry,
          candidate.evidence.category,
          ...(Array.isArray(candidate.evidence.categoryHierarchy)
            ? candidate.evidence.categoryHierarchy
            : []),
        ].join(" ");
        return (
          matchesProspectingScope(
            { ...candidate, websiteEvidence: candidate.evidence },
            current,
          ) &&
          matchesBusinessType(search.industry, facts) &&
          allowedCategories.some((value) =>
            matchesBusinessType(value, facts),
          ) &&
          matchesSouthAfricanArea(search.city, address, candidate.location) &&
          allowedCities.some((value) =>
            matchesSouthAfricanArea(value, address, candidate.location),
          )
        );
      });
      const freshReady = await countReadyProspects(
        tx,
        search.workspaceId,
        current,
      );
      const freshUsed = await tx.platformLead.count({
        where: {
          workspaceId: search.workspaceId,
          sourceKind: "OVERTURE",
          createdAt: { gte: gautengDayStart() },
        },
      });
      const added = await importProspectCandidates(
        search.workspaceId,
        search.actorId,
        candidates,
        Math.max(
          0,
          Math.min(
            current.dailyLimit - freshUsed,
            current.maxQueue - freshReady,
          ),
        ),
        tx,
      );
      const summary = `${added} new sales prospects prepared from ${found.checked} public listings checked.`;
      await tx.platformProspectSearch.update({
        where: { id: search.id },
        data: {
          status: "COMPLETED",
          added,
          checked: found.checked,
          summary,
          completedAt: new Date(),
          leaseUntil: null,
        },
      });
      await tx.platformProspectingConfig.update({
        where: { businessId: search.workspaceId },
        data: {
          lastRunAt: new Date(),
          lastStatus: "COMPLETED",
          lastError: null,
          nextRunAt: new Date(Date.now() + (added > 0 ? 5 : 60) * 60000),
        },
      });
      await tx.platformActivity.create({
        data: {
          workspaceId: search.workspaceId,
          actorId: search.actorId,
          kind: "PROSPECTS_PREPARED",
          detail: summary,
        },
      });
    });
  } catch {
    const error =
      "Public business research could not finish. Existing leads remain available; the next scheduled search will try again.";
    await controlDb.platformProspectSearch.update({
      where: { id: search.id },
      data: {
        status: "FAILED",
        error,
        completedAt: new Date(),
        leaseUntil: null,
      },
    });
    await controlDb.platformProspectingConfig.updateMany({
      where: { businessId: search.workspaceId },
      data: {
        lastRunAt: new Date(),
        lastStatus: "FAILED",
        lastError: error,
        nextRunAt: new Date(Date.now() + 60 * 60000),
      },
    });
  }
  return true;
}
