import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, sameOrigin, rateLimit } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { encrypt } from "@/lib/security";
import { organizationAccess } from "@/platform/core";
import { enqueueJob, orchestrationConfig } from "@/platform/jobs";
import { normalizeWebsite } from "@/platform/research/web";
import { businessProfileSchema } from "@/platform/research/analysis";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { workspaceId } = await params;
    const { organization, role } = await organizationAccess(workspaceId);
    const manage = ["AGENCY_ADMIN", "CLIENT_ADMIN"].includes(role);
    return {
      websiteUrl: organization.websiteUrl,
      profile: organization.profile,
      targetCriteria: organization.targetCriteria,
      qualificationCriteria: organization.qualificationCriteria,
      approved: !!organization.profileApprovedAt,
      connections: {
        searchConfigured: !!organization.encryptedSearchKey,
        aiConfigured: !!organization.encryptedAiKey,
        aiModel: organization.aiModel,
      },
      automationConfigured: !!orchestrationConfig(),
      canManage: manage,
      jobs: await db.platformJob.findMany({
        where: { workspaceId, kind: "ANALYZE_WEBSITE" },
        select: { id: true, status: true, error: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    };
  });
}
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      websiteUrl: z.string().trim().min(4).max(2000),
      targetCriteria: z.string().trim().max(1000).default(""),
      profile: businessProfileSchema.optional(),
      approve: z.boolean().default(false),
      qualificationCriteria: z
        .object({ minimumScore: z.number().int().min(0).max(100) })
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("analyze"),
      permissionConfirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(["connection", "connections"]),
      searchApiKey: z.string().trim().min(5).max(500).optional(),
      aiApiKey: z.string().trim().min(5).max(500).optional(),
      aiModel: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/)
        .optional(),
      clearSearch: z.boolean().optional(),
      clearAi: z.boolean().optional(),
    })
    .strict(),
]);
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    await sameOrigin();
    const { workspaceId } = await params;
    const { user, organization } = await organizationAccess(workspaceId, true);
    await rateLimit(`business:${workspaceId}`, 30);
    const input = schema.parse(await json(request));
    if (input.action === "analyze")
      return enqueueJob(workspaceId, user.id, "ANALYZE_WEBSITE", {});
    if (input.action === "connection" || input.action === "connections") {
      await db.platformOrganization.update({
        where: { workspaceId },
        data: {
          ...(input.searchApiKey
            ? { encryptedSearchKey: encrypt(input.searchApiKey) }
            : {}),
          ...(input.aiApiKey
            ? { encryptedAiKey: encrypt(input.aiApiKey) }
            : {}),
          ...(input.clearSearch ? { encryptedSearchKey: null } : {}),
          ...(input.clearAi ? { encryptedAiKey: null } : {}),
          ...(input.aiModel ? { aiModel: input.aiModel } : {}),
        },
      });
      return { saved: true };
    }
    if (input.action !== "save") throw new HttpError(400, "Invalid action");
    let websiteUrl: string;
    try {
      websiteUrl = normalizeWebsite(input.websiteUrl);
    } catch {
      throw new HttpError(400, "Enter a public company website URL");
    }
    if (input.approve && (!input.profile || !input.targetCriteria))
      throw new HttpError(
        400,
        "Review the business profile and target market before approval",
      );
    const changed = websiteUrl !== organization.websiteUrl;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      await tx.platformOrganization.update({
        where: { workspaceId },
        data: {
          websiteUrl,
          targetCriteria: input.targetCriteria,
          ...(changed
            ? {
                profile: {},
                profileEvidence: [],
                profileApprovedAt: null,
                profileApprovedBy: null,
                onboardingStatus: "NEW",
              }
            : {}),
          ...(input.profile ? { profile: input.profile } : {}),
          ...(input.qualificationCriteria
            ? { qualificationCriteria: input.qualificationCriteria }
            : {}),
          ...(!changed && input.approve
            ? {
                profileApprovedAt: new Date(),
                profileApprovedBy: user.id,
                onboardingStatus: "READY",
              }
            : { profileApprovedAt: null, profileApprovedBy: null }),
        },
      });
      await tx.platformCampaign.updateMany({
        where: {
          workspaceId,
          status: { in: ["RUNNING", "APPROVED", "PAUSED"] },
        },
        data: { status: "PAUSED", approvedAt: null, approvedBy: null },
      });
      await tx.platformCampaignRecipient.updateMany({
        where: { workspaceId },
        data: { approvedAt: null, approvedBy: null },
      });
      await tx.platformActivity.create({
        data: {
          workspaceId,
          actorId: user.id,
          kind: "BUSINESS_PROFILE_SAVED",
          detail:
            input.approve && !changed
              ? "Business profile and target market approved"
              : "Business profile updated; previous campaign approvals cleared",
        },
      });
    });
    return { saved: true, approved: input.approve && !changed };
  });
}
