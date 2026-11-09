import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { controlDb, db } from "@/lib/db";
import { HttpError, rateLimit } from "@/lib/auth";
import { hash, encrypt, decrypt } from "@/lib/security";
import { enqueueJob } from "@/platform/jobs";
import { callerAccess, callerLeadFilter, bookingHosts } from "./access";
import {
  bookingInput,
  outcomes,
  phoneNumber,
  validateBookingWindow,
  terminalCallStatuses,
} from "./rules";
import { browserCallToken } from "./voice";
import { meetingHost, notifyBooking } from "./bookings";
import { readyLeadWhere } from "./prospecting";
import { gautengDayStart } from "./prospect-options";
import { matchesProspectingScope } from "./prospect-search";

const leadInput = z.object({
  company: z.string().trim().min(1).max(240),
  name: z.string().trim().max(160).default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().trim().max(80).default(""),
  website: z.union([z.url(), z.literal("")]).default(""),
  industry: z.string().trim().max(160).default(""),
  location: z.string().trim().max(240).default(""),
  sourceUrl: z.union([z.url(), z.literal("")]).default(""),
  notes: z.string().trim().max(5000).default(""),
});
const actionInput = z.discriminatedUnion("action", [
  leadInput
    .extend({ action: z.literal("add-lead"), requestId: z.uuid() })
    .strict(),
  leadInput
    .partial()
    .extend({
      action: z.literal("edit-lead"),
      id: z.string().min(1),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("claim"),
      id: z.string().min(1),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("qualify"),
      id: z.string().min(1),
      qualification: z.enum([
        "QUALIFIED",
        "NOT_QUALIFIED",
        "CALLBACK",
        "UNREVIEWED",
      ]),
      notes: z.string().trim().min(3).max(5000),
      callbackAt: z.iso.datetime().optional(),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare-call"),
      leadId: z.string().min(1),
      mode: z.enum(["PHONE", "BROWSER"]),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("call-outcome"),
      id: z.string().min(1),
      outcome: z.enum(outcomes),
      notes: z.string().trim().max(5000).default(""),
      callbackAt: z.iso.datetime().optional(),
      reportedDurationSeconds: z.number().int().min(0).max(21600).optional(),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("abandon-call"),
      id: z.string().min(1),
      requestId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("discover"),
      industry: z.string().trim().min(2).max(100),
      location: z.string().trim().min(2).max(200),
      maxResults: z.number().int().min(1).max(10).default(5),
      permissionConfirmed: z.literal(true),
      requestId: z.uuid(),
    })
    .strict(),
  bookingInput,
  z
    .object({
      action: z.literal("update-booking"),
      id: z.string().min(1),
      version: z.number().int().min(0),
      status: z.enum(["SCHEDULED", "COMPLETED", "CANCELED", "NO_SHOW"]),
      startAt: z.iso.datetime().optional(),
      endAt: z.iso.datetime().optional(),
      requestId: z.uuid(),
    })
    .strict(),
]);

export async function readCallerWorkspace(workspaceId: string) {
  const { user, organization, workspace, canSend } =
    await callerAccess(workspaceId);
  const owned = callerLeadFilter(user);
  const [
    leads,
    calls,
    bookings,
    hosts,
    provider,
    jobs,
    campaigns,
    mailboxes,
    totals,
  ] = await Promise.all([
    db.platformLead.findMany({
      where: { status: { not: "ARCHIVED" }, ...owned },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.platformCall.findMany({
      where: user.agencyAdmin ? {} : { callerId: user.id },
      include: { lead: { select: { company: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.platformBooking.findMany({
      where: user.agencyAdmin
        ? {}
        : { OR: [{ bookedById: user.id }, { hostId: user.id }] },
      include: { lead: { select: { company: true, name: true, email: true } } },
      orderBy: { startAt: "desc" },
      take: 200,
    }),
    user.agencyAdmin ? bookingHosts(workspaceId) : Promise.resolve([]),
    controlDb.platformVoiceProvider.findUnique({
      where: { businessId: workspaceId },
      select: { enabled: true, provider: true, fromNumber: true },
    }),
    user.agencyAdmin
      ? db.platformJob.findMany({
          where: { actorId: user.id, kind: "DISCOVER" },
          select: {
            id: true,
            kind: true,
            status: true,
            error: true,
            result: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    user.agencyAdmin
      ? db.platformCampaign.findMany({
          where: user.agencyAdmin ? {} : { createdById: user.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { _count: { select: { recipients: true } } },
        })
      : Promise.resolve([]),
    user.agencyAdmin
      ? db.platformMailbox.findMany({
          select: { id: true, email: true, provider: true, status: true },
        })
      : Promise.resolve([]),
    Promise.all([
      db.platformLead.count({
        where: { ...owned, status: { not: "ARCHIVED" } },
      }),
      db.platformLead.count({
        where: {
          ...(user.agencyAdmin ? {} : { salesQualifiedBy: user.id }),
          salesQualification: "QUALIFIED",
          status: { not: "ARCHIVED" },
        },
      }),
      db.platformCall.count({
        where: {
          ...(user.agencyAdmin ? {} : { callerId: user.id }),
          outcome: { not: "UNRECORDED" },
        },
      }),
      db.platformBooking.count({
        where: {
          ...(user.agencyAdmin ? {} : { bookedById: user.id }),
          status: "SCHEDULED",
        },
      }),
    ]),
  ]);
  const [prospectConfig, prospectSearches, readyLeads, newToday, callsToday] =
    await Promise.all([
      controlDb.platformProspectingConfig.findUnique({
        where: { businessId: workspaceId },
        select: {
          enabled: true,
          lastRunAt: true,
          lastStatus: true,
          categories: true,
          cities: true,
          dailyLimit: true,
          dailyCallTarget: true,
          requireMissingWebsite: true,
        },
      }),
      db.platformProspectSearch.findMany({
        where: user.agencyAdmin
          ? {}
          : { OR: [{ actorId: user.id }, { actorId: null }] },
        select: {
          id: true,
          status: true,
          industry: true,
          city: true,
          added: true,
          summary: true,
          error: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.platformLead.findMany({
        where: { ...readyLeadWhere, ...owned },
        select: {
          company: true,
          industry: true,
          location: true,
          websitePresence: true,
          websiteEvidence: true,
        },
      }),
      db.platformLead.count({
        where: {
          sourceKind: "OVERTURE",
          createdAt: { gte: gautengDayStart() },
        },
      }),
      db.platformCall.count({
        where: {
          ...(user.agencyAdmin ? {} : { callerId: user.id }),
          outcome: { not: "UNRECORDED" },
          endedAt: { gte: gautengDayStart() },
        },
      }),
    ]);
  return {
    user,
    business: {
      workspaceId,
      name: user.agencyAdmin ? workspace.name : "Concrete",
      timezone: workspace.timezone,
      ...(user.agencyAdmin
        ? {
            websiteUrl: organization.websiteUrl,
            targetCriteria: organization.targetCriteria,
            profileApproved: Boolean(organization.profileApprovedAt),
          }
        : {}),
    },
    canSend,
    voice: {
      ready: Boolean(provider?.enabled),
      provider: provider?.provider || null,
      fromNumber: provider?.fromNumber || null,
    },
    ...(user.agencyAdmin
      ? {
          discoveryConfigured: Boolean(
            organization.encryptedSearchKey && organization.profileApprovedAt,
          ),
          sending: {
            enabled: process.env.LIVE_EMAIL_ENABLED === "true",
            profileApproved: Boolean(organization.profileApprovedAt),
          },
        }
      : {}),
    totals: {
      leads: totals[0],
      ready: readyLeads.filter((lead) =>
        matchesProspectingScope(lead, prospectConfig || {}),
      ).length,
      qualified: totals[1],
      callsLogged: totals[2],
      bookings: totals[3],
    },
    leads,
    calls: calls.map(
      ({ nonceHash: _nonce, requestHash: _request, ...call }) => {
        void _nonce;
        void _request;
        return call;
      },
    ),
    bookings,
    hosts: user.agencyAdmin ? hosts : [],
    jobs: user.agencyAdmin ? jobs : [],
    campaigns: user.agencyAdmin ? campaigns : [],
    mailboxes: user.agencyAdmin ? mailboxes : [],
    prospecting: {
      enabled: Boolean(prospectConfig?.enabled),
      lastRunAt: prospectConfig?.lastRunAt || null,
      status: prospectConfig?.lastStatus || "NOT_STARTED",
      categories: prospectConfig?.categories || ["ALL"],
      cities: prospectConfig?.cities || ["South Africa"],
      dailyLimit: prospectConfig?.dailyLimit || 30,
      dailyCallTarget: prospectConfig?.dailyCallTarget || 100,
      requireMissingWebsite: prospectConfig?.requireMissingWebsite ?? true,
      today: { newLeads: newToday, callsLogged: callsToday },
      searches: prospectSearches,
    },
  };
}

async function scopedLead(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  id: string,
  user: { id: string; agencyAdmin: boolean },
  claim = false,
) {
  const lead = await tx.platformLead.findFirst({
    where: {
      workspaceId,
      id,
      status: { not: "ARCHIVED" },
      ...callerLeadFilter(user),
    },
  });
  if (!lead)
    throw new HttpError(
      404,
      "Lead is unavailable or assigned to another caller.",
    );
  if (claim && !lead.ownerId) {
    const changed = await tx.platformLead.updateMany({
      where: { workspaceId, id, ownerId: null },
      data: { ownerId: user.id },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "Another caller has claimed this lead. Refresh your list.",
      );
  }
  return lead;
}

export async function callerAction(workspaceId: string, raw: unknown) {
  const access = await callerAccess(workspaceId);
  const { user, organization } = access;
  await rateLimit(`caller-actions:${user.id}`, 180, 15);
  const input = actionInput.parse(raw);
  const operationKey = `caller:${user.id}:${input.requestId}`;
  const requestHash = hash(JSON.stringify(input));
  const booking = input.action === "book" || input.action === "update-booking";
  // Booking hosts can span businesses. The control transaction reserves a host's
  // calendar globally; all business/lead writes below retain explicit scope.
  const client = booking ? controlDb : db;
  const result = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const replay = await tx.platformOperationReceipt.findUnique({
      where: { workspaceId_operationKey: { workspaceId, operationKey } },
    });
    if (replay) {
      if (replay.scopeHash !== requestHash)
        throw new HttpError(
          409,
          "This request was already used for a different action.",
        );
      return JSON.parse(decrypt(replay.encryptedResult)) as Record<
        string,
        unknown
      >;
    }
    let result: Record<string, unknown>;
    if (input.action === "add-lead" || input.action === "edit-lead") {
      const { action, requestId: _key, ...fields } = input;
      void _key;
      const existing =
        action === "edit-lead"
          ? await scopedLead(tx, workspaceId, input.id!, user, true)
          : null;
      const parsed =
        action === "edit-lead"
          ? leadInput.partial().parse(fields)
          : leadInput.parse(fields);
      if (
        !existing &&
        parsed.sourceUrl?.startsWith("https://www.openstreetmap.org/") &&
        (await tx.platformLead.findFirst({
          where: { workspaceId, sourceUrl: parsed.sourceUrl },
          select: { id: true },
        }))
      )
        throw new HttpError(
          409,
          "This directory listing is already in the business's lead list. Refresh your leads.",
        );
      const changedEmail =
        existing &&
        parsed.email !== undefined &&
        (parsed.email || null) !== existing.email;
      const data = {
        ...parsed,
        ...(parsed.email !== undefined
          ? { email: parsed.email ? parsed.email.toLowerCase() : null }
          : {}),
        ...(changedEmail
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
        ? await tx.platformLead.update({
            where: { workspaceId_id: { workspaceId, id: existing.id } },
            data,
          })
        : await tx.platformLead.create({
            data: {
              ...data,
              company: parsed.company!,
              workspaceId,
              ownerId: user.id,
              createdById: user.id,
            },
          });
      if (existing && Object.keys(parsed).some((key) => key !== "notes")) {
        await tx.platformCampaignRecipient.updateMany({
          where: { workspaceId, leadId: lead.id },
          data: { approvedAt: null, approvedBy: null },
        });
        await tx.platformCampaign.updateMany({
          where: {
            workspaceId,
            recipients: { some: { leadId: lead.id } },
            status: { in: ["APPROVED", "RUNNING", "PAUSED"] },
          },
          data: { status: "PAUSED", approvedAt: null, approvedBy: null },
        });
      }
      result = {
        id: lead.id,
        message:
          "Lead saved. Email permission and verification remain separate from sales qualification.",
      };
    } else if (input.action === "claim") {
      const lead = await scopedLead(tx, workspaceId, input.id, user, true);
      result = { id: lead.id, message: "Lead assigned to you." };
    } else if (input.action === "qualify") {
      await scopedLead(tx, workspaceId, input.id, user, true);
      if (
        input.qualification === "CALLBACK" &&
        (!input.callbackAt ||
          new Date(input.callbackAt) <= new Date() ||
          new Date(input.callbackAt).getTime() > Date.now() + 90 * 86400000)
      )
        throw new HttpError(
          400,
          "Choose a callback time within the next 90 days.",
        );
      await tx.platformLead.update({
        where: { workspaceId_id: { workspaceId, id: input.id } },
        data: {
          salesQualification: input.qualification,
          salesQualificationNotes: input.notes,
          salesQualifiedBy: user.id,
          salesQualifiedAt: new Date(),
          callbackAt:
            input.qualification === "CALLBACK" && input.callbackAt
              ? new Date(input.callbackAt)
              : null,
        },
      });
      result = {
        message:
          "Your sales qualification has been saved. This does not grant permission to email the lead.",
      };
    } else if (input.action === "discover") {
      if (!user.agencyAdmin)
        throw new HttpError(403, "Use Find leads in your calling workspace.");
      if (
        !organization.profileApprovedAt ||
        !organization.targetCriteria ||
        !organization.encryptedSearchKey
      )
        throw new HttpError(
          409,
          "Your administrator must approve the business profile and connect Brave Search before lead discovery.",
        );
      const job = await enqueueJob(
        workspaceId,
        user.id,
        "DISCOVER",
        {
          industry: input.industry,
          location: input.location,
          maxResults: input.maxResults,
        },
        `caller-discover:${input.requestId}`,
        tx,
      );
      result = {
        jobId: job.id,
        message:
          "Lead search queued. Results appear after the online research worker completes it.",
      };
    } else if (input.action === "prepare-call") {
      const lead = await scopedLead(tx, workspaceId, input.leadId, user, true);
      const number = phoneNumber(lead.phone);
      if (
        lead.doNotCall ||
        lead.unsubscribedAt ||
        lead.status === "UNSUBSCRIBED" ||
        (await tx.platformCall.findFirst({
          where: { workspaceId, toNumber: number, outcome: "DO_NOT_CALL" },
          select: { id: true },
        }))
      )
        throw new HttpError(
          409,
          "This contact has opted out of calls. Do not call this number.",
        );
      const provider =
        input.mode === "BROWSER"
          ? await controlDb.platformVoiceProvider.findUnique({
              where: { businessId: workspaceId },
            })
          : null;
      if (input.mode === "BROWSER" && !provider?.enabled)
        throw new HttpError(
          409,
          "Browser calling is not connected. Use your Vodacom phone and log its outcome, or ask your administrator to connect a voice provider.",
        );
      const nonce = randomBytes(24).toString("hex");
      const call = await tx.platformCall.create({
        data: {
          workspaceId,
          leadId: lead.id,
          callerId: user.id,
          mode: input.mode,
          status: input.mode === "PHONE" ? "MANUAL_PENDING" : "PREPARED",
          toNumber: number,
          fromNumber: provider?.fromNumber,
          requestId: input.requestId,
          requestHash,
          ...(provider
            ? {
                nonceHash: hash(nonce),
                expiresAt: new Date(Date.now() + 300000),
              }
            : {}),
        },
      });
      result = {
        callId: call.id,
        toNumber: number,
        mode: call.mode,
        ...(provider ? { nonce } : {}),
        message:
          input.mode === "PHONE"
            ? "Open your phone dialler, then record the actual outcome. Opening a dialler does not confirm a completed call."
            : "Browser call prepared. No phone call has connected yet.",
      };
    } else if (
      input.action === "call-outcome" ||
      input.action === "abandon-call"
    ) {
      const call = await tx.platformCall.findFirst({
        where: {
          workspaceId,
          id: input.id,
          ...(user.agencyAdmin ? {} : { callerId: user.id }),
        },
      });
      if (!call) throw new HttpError(404, "Call not found.");
      if (input.action === "abandon-call") {
        if (call.status === "PREPARED" && !call.providerParentSid)
          await tx.platformCall.update({
            where: { id: call.id },
            data: { status: "CANCELED", endedAt: new Date(), nonceHash: null },
          });
        result = {
          message:
            "Unstarted browser call canceled. Provider-confirmed calls keep their recorded status.",
        };
      } else {
        if (
          input.outcome === "CALLBACK" &&
          (!input.callbackAt ||
            new Date(input.callbackAt) <= new Date() ||
            new Date(input.callbackAt).getTime() > Date.now() + 90 * 86400000)
        )
          throw new HttpError(
            400,
            "Choose a callback time within the next 90 days.",
          );
        if (call.mode === "BROWSER" && !terminalCallStatuses.has(call.status))
          throw new HttpError(
            409,
            "Wait for the provider's final call status before saving the outcome.",
          );
        await tx.platformCall.update({
          where: { id: call.id },
          data: {
            outcome: input.outcome,
            notes: input.notes,
            ...(call.mode === "PHONE"
              ? {
                  status: "MANUAL_LOGGED",
                  reportedDurationSeconds:
                    input.reportedDurationSeconds ?? null,
                  endedAt: new Date(),
                }
              : {}),
          },
        });
        if (input.outcome === "DO_NOT_CALL")
          await tx.platformLead.update({
            where: { workspaceId_id: { workspaceId, id: call.leadId } },
            data: { doNotCall: true },
          });
        if (
          ["QUALIFIED", "NOT_QUALIFIED", "CALLBACK", "NO_ANSWER"].includes(
            input.outcome,
          )
        )
          await tx.platformLead.update({
            where: { workspaceId_id: { workspaceId, id: call.leadId } },
            data: {
              salesQualification:
                input.outcome === "NO_ANSWER" ? "CALLBACK" : input.outcome,
              salesQualificationNotes:
                input.notes ||
                (input.outcome === "QUALIFIED"
                  ? "Interested in a website consultation."
                  : "Follow up based on the recorded conversation."),
              salesQualifiedBy: user.id,
              salesQualifiedAt: new Date(),
              callbackAt: ["CALLBACK", "NO_ANSWER"].includes(input.outcome)
                ? new Date(input.callbackAt || Date.now() + 86400000)
                : null,
            },
          });
        result = {
          message:
            call.mode === "PHONE"
              ? "Phone outcome logged as caller-reported activity."
              : "Call outcome saved alongside the provider-confirmed call status.",
        };
      }
    } else if (input.action === "book") {
      const lead = await scopedLead(tx, workspaceId, input.leadId, user, true);
      const assignedHost = await meetingHost(workspaceId, tx);
      const hostId = input.hostId || assignedHost.id;
      if (!user.agencyAdmin && hostId !== assignedHost.id)
        throw new HttpError(
          400,
          "Bookings are assigned to the Concrete meeting team automatically.",
        );
      const startAt = new Date(input.startAt),
        endAt = new Date(input.endAt);
      validateBookingWindow(startAt, endAt, input.timezone);
      if (
        !(await tx.user.findFirst({
          where: {
            id: hostId,
            disabledAt: null,
            OR: [
              { agencyAdmin: true },
              {
                staffRole: "CALLER",
                memberships: { some: { workspaceId, role: "CALLER" } },
              },
            ],
          },
          select: { id: true },
        }))
      )
        throw new HttpError(
          400,
          "Choose an active host assigned to this business.",
        );
      if (
        input.callId &&
        !(await tx.platformCall.findFirst({
          where: {
            workspaceId,
            id: input.callId,
            leadId: lead.id,
            ...(user.agencyAdmin ? {} : { callerId: user.id }),
          },
        }))
      )
        throw new HttpError(
          400,
          "The selected call does not belong to this lead and caller.",
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"booking-host:" + hostId}))`;
      if (
        await tx.platformBooking.findFirst({
          where: {
            hostId,
            status: "SCHEDULED",
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
          select: { id: true },
        })
      )
        throw new HttpError(
          409,
          "This host already has a booking during that time. Choose another slot.",
        );
      const created = await tx.platformBooking.create({
        data: {
          workspaceId,
          leadId: lead.id,
          callId: input.callId,
          bookedById: user.id,
          hostId,
          title: input.title,
          startAt,
          endAt,
          timezone: input.timezone,
          location: input.location,
          meetingUrl: input.meetingUrl,
          notes: input.notes,
          requestId: input.requestId,
          requestHash,
        },
      });
      await notifyBooking(tx, created, user.name, lead.company, "BOOKED");
      result = {
        id: created.id,
        message:
          "Meeting booked. Your administrator has been notified in Concrete. You can download a calendar invitation to share with the prospect.",
      };
    } else {
      const current = await tx.platformBooking.findFirst({
        where: {
          workspaceId,
          id: input.id,
          ...(user.agencyAdmin ? {} : { bookedById: user.id }),
        },
      });
      if (!current) throw new HttpError(404, "Booking not found.");
      if (current.version !== input.version)
        throw new HttpError(
          409,
          "This booking changed. Refresh it before editing.",
        );
      const startAt = input.startAt ? new Date(input.startAt) : current.startAt,
        endAt = input.endAt ? new Date(input.endAt) : current.endAt;
      if (input.status === "SCHEDULED") {
        validateBookingWindow(startAt, endAt, current.timezone);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"booking-host:" + current.hostId}))`;
        if (
          await tx.platformBooking.findFirst({
            where: {
              hostId: current.hostId,
              id: { not: current.id },
              status: "SCHEDULED",
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
          })
        )
          throw new HttpError(
            409,
            "The host already has a booking at that time.",
          );
      }
      const updated = await tx.platformBooking.update({
        where: { id: current.id },
        data: {
          status: input.status,
          startAt,
          endAt,
          version: { increment: 1 },
        },
      });
      const lead = await tx.platformLead.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: current.leadId } },
        select: { company: true },
      });
      await notifyBooking(tx, updated, user.name, lead.company, "UPDATED");
      result = {
        message:
          "Meeting updated and your administrator notified. Download a fresh calendar file to share the change.",
      };
    }
    await tx.platformActivity.create({
      data: {
        workspaceId,
        actorId: user.id,
        kind: "CALLER_" + input.action.toUpperCase().replaceAll("-", "_"),
        detail: String(result.message).slice(0, 1000),
      },
    });
    await tx.platformOperationReceipt.create({
      data: {
        workspaceId,
        operationKey,
        scopeHash: requestHash,
        encryptedResult: encrypt(JSON.stringify(result)),
      },
    });
    return result;
  });
  if (input.action === "prepare-call" && input.mode === "BROWSER") {
    const token = await browserCallToken(
      workspaceId,
      user.id,
      String(result.callId),
    );
    return { ...result, token };
  }
  return result;
}
