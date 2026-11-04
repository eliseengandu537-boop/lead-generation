import { randomBytes } from "node:crypto";
import { hash as passwordHash } from "bcryptjs";
import { z } from "zod";
import { controlDb } from "@/lib/db";
import { currentUser, HttpError, rateLimit } from "@/lib/auth";
import { connectVoice, voiceUrls } from "./voice";

const assignments = z
  .array(
    z
      .object({
        workspaceId: z.string().min(1).max(100),
        canSend: z.boolean().default(false),
      })
      .strict(),
  )
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.workspaceId)).size === rows.length,
    "Choose each business once.",
  );
const callerAdminInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create-caller"),
      name: z.string().trim().min(1).max(160),
      email: z.email().transform((value) => value.toLowerCase()),
      assignments,
    })
    .strict(),
  z
    .object({
      action: z.literal("assign-caller"),
      userId: z.string().min(1).max(100),
      assignments,
    })
    .strict(),
  z
    .object({
      action: z.literal("caller-status"),
      userId: z.string().min(1).max(100),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pause-voice"),
      workspaceId: z.string().min(1),
      enabled: z.boolean(),
    })
    .strict(),
]);

export async function callCentreRead(query = new URLSearchParams()) {
  const admin = await currentUser();
  if (!admin.agencyAdmin)
    throw new HttpError(403, "Platform administrator required.");
  const { days, workspaceId } = z
    .object({
      days: z.coerce.number().int().min(1).max(366).default(30),
      workspaceId: z.string().max(100).optional(),
    })
    .parse(Object.fromEntries(query));
  const since = new Date(Date.now() - days * 86400000);
  const scope = {
    ...(workspaceId ? { workspaceId } : {}),
    organization: {
      onboardingStatus: { not: "DEMO" },
      workspace: { status: "ACTIVE" },
    },
  };
  const [
    callers,
    businesses,
    calls,
    bookings,
    callGroups,
    leadGroups,
    qualificationGroups,
    bookingGroups,
    voice,
    attempts,
    connected,
  ] = await Promise.all([
    controlDb.user.findMany({
      where: { staffRole: "CALLER" },
      select: {
        id: true,
        name: true,
        email: true,
        disabledAt: true,
        memberships: {
          where: { role: "CALLER" },
          select: { workspaceId: true, callerCanSend: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    controlDb.platformOrganization.findMany({
      where: {
        onboardingStatus: { not: "DEMO" },
        workspace: { status: "ACTIVE" },
      },
      select: {
        workspaceId: true,
        websiteUrl: true,
        workspace: { select: { name: true } },
      },
    }),
    controlDb.platformCall.findMany({
      where: { ...scope, createdAt: { gte: since } },
      select: {
        id: true,
        workspaceId: true,
        callerId: true,
        mode: true,
        status: true,
        outcome: true,
        toNumber: true,
        durationSeconds: true,
        reportedDurationSeconds: true,
        createdAt: true,
        notes: true,
        lead: { select: { company: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    controlDb.platformBooking.findMany({
      where: { ...scope, startAt: { gte: since } },
      include: { lead: { select: { company: true, name: true } } },
      orderBy: { startAt: "desc" },
      take: 200,
    }),
    controlDb.platformCall.groupBy({
      by: ["callerId", "mode", "status", "outcome"],
      where: { ...scope, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { durationSeconds: true },
    }),
    controlDb.platformLead.groupBy({
      by: ["createdById"],
      where: {
        ...scope,
        createdAt: { gte: since },
        createdById: { not: null },
        status: { not: "ARCHIVED" },
      },
      _count: { _all: true },
    }),
    controlDb.platformLead.groupBy({
      by: ["salesQualifiedBy"],
      where: {
        ...scope,
        salesQualification: "QUALIFIED",
        salesQualifiedAt: { gte: since },
        status: { not: "ARCHIVED" },
      },
      _count: { _all: true },
    }),
    controlDb.platformBooking.groupBy({
      by: ["bookedById", "status"],
      where: { ...scope, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    controlDb.platformVoiceProvider.findMany({
      select: {
        businessId: true,
        provider: true,
        enabled: true,
        fromNumber: true,
      },
    }),
    controlDb.platformCall.groupBy({
      by: ["callerId"],
      where: {
        ...scope,
        createdAt: { gte: since },
        mode: "BROWSER",
        providerParentSid: { not: null },
      },
      _count: { _all: true },
    }),
    controlDb.platformCall.groupBy({
      by: ["callerId"],
      where: {
        ...scope,
        createdAt: { gte: since },
        mode: "BROWSER",
        providerParentSid: { not: null },
        OR: [
          { answeredAt: { not: null } },
          { status: "COMPLETED", durationSeconds: { gt: 0 } },
        ],
      },
      _count: { _all: true },
    }),
  ]);
  const performance = callers.map((caller) => {
    const groups = callGroups.filter((row) => row.callerId === caller.id);
    return {
      ...caller,
      phoneLogs: groups
        .filter((row) => row.mode === "PHONE" && row.status === "MANUAL_LOGGED")
        .reduce((sum, row) => sum + row._count._all, 0),
      browserAttempts:
        attempts.find((row) => row.callerId === caller.id)?._count._all || 0,
      browserConnected:
        connected.find((row) => row.callerId === caller.id)?._count._all || 0,
      leadsAdded:
        leadGroups.find((row) => row.createdById === caller.id)?._count._all ||
        0,
      qualified:
        qualificationGroups.find((row) => row.salesQualifiedBy === caller.id)
          ?._count._all || 0,
      bookings: bookingGroups
        .filter(
          (row) => row.bookedById === caller.id && row.status !== "CANCELED",
        )
        .reduce((sum, row) => sum + row._count._all, 0),
    };
  });
  return {
    days,
    since,
    businesses: businesses.map((business) => ({
      workspaceId: business.workspaceId,
      name: business.workspace.name,
      websiteUrl: business.websiteUrl,
      voice:
        voice.find((item) => item.businessId === business.workspaceId) || null,
      webhooks: voiceUrls(business.workspaceId),
    })),
    callers: performance,
    calls,
    bookings,
    totals: {
      phoneLogs: performance.reduce((sum, row) => sum + row.phoneLogs, 0),
      browserAttempts: performance.reduce(
        (sum, row) => sum + row.browserAttempts,
        0,
      ),
      browserConnected: performance.reduce(
        (sum, row) => sum + row.browserConnected,
        0,
      ),
      leadsAdded: performance.reduce((sum, row) => sum + row.leadsAdded, 0),
      qualified: performance.reduce((sum, row) => sum + row.qualified, 0),
      bookings: performance.reduce((sum, row) => sum + row.bookings, 0),
    },
  };
}

export async function callCentreWrite(raw: unknown) {
  const admin = await currentUser();
  if (!admin.agencyAdmin)
    throw new HttpError(403, "Platform administrator required.");
  await rateLimit(`call-centre-admin:${admin.id}`, 60, 60);
  if (z.object({ action: z.string() }).parse(raw).action === "connect-voice")
    return connectVoice(admin.id, raw);
  const input = callerAdminInput.parse(raw);
  if (input.action === "pause-voice") {
    await controlDb.platformVoiceProvider.update({
      where: { businessId: input.workspaceId },
      data: { enabled: input.enabled, updatedBy: admin.id },
    });
    return {
      message: input.enabled
        ? "Browser calling enabled."
        : "New browser calls paused. Existing provider callbacks can still update their calls.",
    };
  }
  if (input.action === "caller-status") {
    await controlDb.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: input.userId, staffRole: "CALLER", agencyAdmin: false },
        data: {
          disabledAt: input.enabled ? null : new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      if (!updated.count) throw new HttpError(404, "Caller not found.");
      if (!input.enabled)
        await tx.platformCampaign.updateMany({
          where: {
            createdById: input.userId,
            status: { in: ["RUNNING", "APPROVED"] },
          },
          data: { status: "PAUSED" },
        });
    });
    return {
      message: input.enabled
        ? "Caller access enabled."
        : "Caller access suspended and existing sessions invalidated.",
    };
  }
  const password =
    input.action === "create-caller"
      ? randomBytes(12).toString("base64url") + "!9"
      : null;
  const digest = password ? await passwordHash(password, 12) : null;
  const result = await controlDb.$transaction(async (tx) => {
    const lock = input.action === "create-caller" ? input.email : input.userId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"caller-account:" + lock}))`;
    if (
      (await tx.platformOrganization.count({
        where: {
          workspaceId: { in: input.assignments.map((row) => row.workspaceId) },
          onboardingStatus: { not: "DEMO" },
          workspace: { status: "ACTIVE" },
        },
      })) !== input.assignments.length
    )
      throw new HttpError(400, "Choose only active business assignments.");
    let caller;
    if (input.action === "create-caller") {
      if (await tx.user.findUnique({ where: { email: input.email } }))
        throw new HttpError(
          409,
          "This email already has an account. Its password and access were not changed.",
        );
      caller = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: digest!,
          staffRole: "CALLER",
        },
        select: { id: true, name: true, email: true },
      });
    } else {
      caller = await tx.user.findFirst({
        where: { id: input.userId, staffRole: "CALLER", agencyAdmin: false },
        select: { id: true, name: true, email: true },
      });
      if (!caller) throw new HttpError(404, "Caller not found.");
    }
    await tx.platformCampaign.updateMany({
      where: {
        createdById: caller.id,
        workspaceId: {
          notIn: input.assignments
            .filter((row) => row.canSend)
            .map((row) => row.workspaceId),
        },
        status: { in: ["RUNNING", "APPROVED"] },
      },
      data: { status: "PAUSED" },
    });
    await tx.membership.deleteMany({
      where: {
        userId: caller.id,
        role: "CALLER",
        workspaceId: { notIn: input.assignments.map((row) => row.workspaceId) },
      },
    });
    for (const assignment of input.assignments) {
      const member = await tx.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: assignment.workspaceId,
            userId: caller.id,
          },
        },
      });
      if (member && member.role !== "CALLER")
        throw new HttpError(
          409,
          "This user has a different membership in a selected business. Existing client roles were preserved.",
        );
      await tx.membership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: assignment.workspaceId,
            userId: caller.id,
          },
        },
        create: {
          workspaceId: assignment.workspaceId,
          userId: caller.id,
          role: "CALLER",
          callerCanSend: assignment.canSend,
        },
        update: { callerCanSend: assignment.canSend },
      });
      await tx.platformActivity.create({
        data: {
          workspaceId: assignment.workspaceId,
          actorId: admin.id,
          kind: "CALLER_ACCESS_UPDATED",
          detail: `Caller ${caller.name} assigned. Email campaign permission: ${assignment.canSend ? "enabled" : "disabled"}.`,
        },
      });
    }
    return caller;
  });
  return {
    caller: result,
    ...(password
      ? {
          login: {
            url: `${new URL(process.env.NEXTAUTH_URL || "http://localhost:3100").origin}/login`,
            email: result.email,
            password,
          },
        }
      : {}),
    message: password
      ? "Caller login created. Copy or download its password now; it cannot be retrieved later."
      : "Caller business assignments updated.",
  };
}
