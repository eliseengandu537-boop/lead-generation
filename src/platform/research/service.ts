import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { decrypt } from "@/lib/security";
import { enqueueJob } from "../jobs";
import { researchWebsite, normalizeWebsite } from "./web";
import { searchBusinesses, analyseBusiness } from "./providers";
import { evidenceSchema } from "./types";
import {
  businessProfileSchema,
  qualificationSchema,
  replySchema,
  structuredAnalysis,
  verifyCitations,
  qualificationCategory,
} from "./analysis";

export async function notice(
  workspaceId: string,
  key: string,
  kind: string,
  title: string,
  message: string,
  severity = "INFO",
  tx: Prisma.TransactionClient = db,
) {
  return tx.platformNotice.upsert({
    where: { dedupeKey: `${workspaceId}:${key}` },
    create: {
      workspaceId,
      dedupeKey: `${workspaceId}:${key}`,
      kind,
      title,
      message: message.slice(0, 3000),
      severity,
    },
    update: {},
  });
}
export async function reserveUsage(
  workspaceId: string,
  operationKey: string,
  kind: "AI" | "DISCOVERY",
  quantity = 1,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const subscription = await tx.platformSubscription.findUnique({
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
        "This organization's subscription needs attention",
      );
    if (
      await tx.platformUsage.findUnique({
        where: { workspaceId_operationKey: { workspaceId, operationKey } },
      })
    )
      throw new HttpError(
        409,
        "This provider operation was already attempted. Automatic replay is blocked.",
      );
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    if (kind === "DISCOVERY") since.setUTCDate(1);
    const used = await tx.platformUsage.aggregate({
      where: { workspaceId, kind, createdAt: { gte: since } },
      _sum: { quantity: true },
    });
    const limit =
      kind === "AI"
        ? subscription.plan.dailyAi
        : subscription.plan.monthlyProspects;
    if ((used._sum.quantity || 0) + quantity > limit)
      throw new HttpError(
        429,
        `${kind === "AI" ? "Daily AI" : "Monthly discovery"} allowance reached`,
      );
    await tx.platformUsage.create({
      data: { workspaceId, operationKey, kind, quantity },
    });
  });
}
async function ai(workspaceId: string, operationKey: string) {
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  if (!organization.encryptedAiKey)
    throw new HttpError(
      503,
      "Connect this organization's OpenAI API key in Website settings",
    );
  await reserveUsage(workspaceId, operationKey, "AI");
  return {
    key: decrypt(organization.encryptedAiKey),
    model: organization.aiModel,
  };
}
export async function analyzeWebsite(
  workspaceId: string,
  operationKey: string,
) {
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  if (!organization.websiteUrl)
    throw new HttpError(409, "Connect your company website first");
  const research = await researchWebsite(organization.websiteUrl);
  const config = await ai(workspaceId, operationKey);
  const profile = await structuredAnalysis(
    config,
    businessProfileSchema,
    "Extract the company's real products, services, industry, location and stated target customers. Only source-supported claims are permitted; leave unknown facts empty. Potential customer suggestions must be clearly hypotheses in cautions, not invented company claims.",
    { evidence: research.evidence },
  );
  verifyCitations(profile.facts, research.evidence);
  const changed = await db.platformOrganization.updateMany({
    where: { workspaceId, websiteUrl: organization.websiteUrl },
    data: {
      profile,
      profileEvidence: research.evidence,
      profileApprovedAt: null,
      profileApprovedBy: null,
      onboardingStatus: "REVIEW_REQUIRED",
    },
  });
  if (!changed.count)
    throw new HttpError(
      409,
      "The website changed during analysis. Analyze the current website again.",
    );
  await notice(
    workspaceId,
    operationKey,
    "WEBSITE_ANALYZED",
    "Your business profile is ready",
    "Review the website evidence, edit your business profile and approve your target market before discovery.",
  );
  return {
    summary:
      "Business profile generated from website evidence; client approval is required.",
  };
}
export async function discover(
  workspaceId: string,
  actorId: string | null,
  operationKey: string,
  payload: unknown,
) {
  const input = z
    .object({
      query: z.string().max(300).optional(),
      industry: z.string().max(100).default(""),
      location: z.string().max(200).default(""),
      category: z.string().max(100).default(""),
      maxResults: z.number().int().min(1).max(10).default(5),
    })
    .parse(payload);
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  if (!organization.profileApprovedAt || !organization.targetCriteria)
    throw new HttpError(
      409,
      "Approve your website business profile and target market before discovery",
    );
  if (!organization.encryptedSearchKey)
    throw new HttpError(
      503,
      "Connect this organization's Brave Search API key",
    );
  await reserveUsage(workspaceId, operationKey, "DISCOVERY", input.maxResults);
  const query = [
    input.query || organization.targetCriteria,
    input.industry,
    input.category,
    input.location,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const results = await searchBusinesses(
    decrypt(organization.encryptedSearchKey),
    query,
    input.maxResults,
  );
  let created = 0;
  for (const result of results) {
    let website: string;
    try {
      website = normalizeWebsite(result.url);
    } catch {
      continue;
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const duplicate = await tx.platformLead.findFirst({
        where: { workspaceId, website },
      });
      if (duplicate) return;
      const lead = await tx.platformLead.create({
        data: {
          workspaceId,
          company: result.company.slice(0, 200),
          website,
          industry: input.industry,
          location: input.location,
          sourceUrl: result.url,
          sourceKind: "BRAVE_SEARCH",
          evidence: [
            {
              url: result.url,
              title: result.company,
              excerpt: result.description.slice(0, 6000),
              fetchedAt: new Date().toISOString(),
              kind: "SEARCH",
            },
          ],
        },
      });
      await enqueueJob(
        workspaceId,
        actorId,
        "RESEARCH_LEAD",
        { leadId: lead.id },
        `research:${lead.id}`,
        tx,
      );
      created++;
    });
  }
  await notice(
    workspaceId,
    operationKey,
    "LEADS_DISCOVERED",
    "New business prospects discovered",
    `${created} new businesses were saved with their sources. Public website research and qualification are queued. Contact discovery does not grant permission to market.`,
  );
  return {
    summary: `${created} new source-tracked businesses discovered.`,
    created,
  };
}
export async function researchLead(
  workspaceId: string,
  leadId: string,
  actorId: string | null,
  operationKey: string,
) {
  const lead = await db.platformLead.findFirst({
    where: { id: leadId, workspaceId },
  });
  if (!lead) throw new HttpError(404, "Lead not found");
  const research = await researchWebsite(lead.website);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const current = await tx.platformLead.findFirst({
      where: { id: lead.id, workspaceId, updatedAt: lead.updatedAt },
    });
    if (!current)
      throw new HttpError(
        409,
        "Lead changed during research. Research the current details again.",
      );
    const duplicate = research.email
      ? await tx.platformLead.findFirst({
          where: {
            workspaceId,
            email: research.email.toLowerCase(),
            id: { not: lead.id },
          },
        })
      : null;
    await tx.platformLead.update({
      where: { id: lead.id },
      data: {
        evidence: research.evidence.map((source) => ({
          ...source,
          kind: "WEBSITE",
        })),
        research: {
          description: research.description,
          warnings: research.warnings,
        },
        phone: research.phone || lead.phone,
        ...(!lead.email && !duplicate && research.email
          ? {
              email: research.email.toLowerCase(),
              verificationStatus: "UNKNOWN",
              verifiedAt: null,
            }
          : {}),
      },
    });
    await enqueueJob(
      workspaceId,
      actorId,
      "QUALIFY",
      { leadId },
      `qualify:${lead.id}:${operationKey}`,
      tx,
    );
    if (
      research.email &&
      !duplicate &&
      process.env.EMAIL_VERIFICATION_URL &&
      process.env.EMAIL_VERIFICATION_API_KEY
    )
      await enqueueJob(
        workspaceId,
        actorId,
        "VERIFY_EMAIL",
        { leadId },
        `verify:${lead.id}:${research.email}`,
        tx,
      );
  });
  return {
    summary:
      "Public website research saved with source evidence; no contact details were guessed.",
  };
}
export async function qualify(
  workspaceId: string,
  leadId: string,
  operationKey: string,
) {
  const [organization, lead] = await Promise.all([
    db.platformOrganization.findUniqueOrThrow({ where: { workspaceId } }),
    db.platformLead.findFirst({ where: { id: leadId, workspaceId } }),
  ]);
  if (!organization.profileApprovedAt)
    throw new HttpError(409, "Approve your business profile first");
  if (!lead) throw new HttpError(404, "Lead not found");
  const evidence = z
    .array(evidenceSchema)
    .parse(lead.evidence)
    .filter((source) => source.kind === "WEBSITE");
  if (!evidence.length)
    throw new HttpError(
      409,
      "Research the lead's public website before qualification",
    );
  const result = await structuredAnalysis(
    await ai(workspaceId, operationKey),
    qualificationSchema,
    "Assess suitability from 0 to 100, explaining industry, category, geography, possible need, known size and contact availability. Cite prospect evidence and state uncertainty. Suitability is not buying intent or marketing permission.",
    {
      businessProfile: organization.profile,
      targetCriteria: organization.targetCriteria,
      criteria: organization.qualificationCriteria,
      prospect: {
        company: lead.company,
        website: lead.website,
        industry: lead.industry,
        location: lead.location,
        emailAvailable: !!lead.email,
        evidence,
      },
    },
  );
  verifyCitations(result.facts, evidence);
  const category = qualificationCategory(result.score);
  const updated = await db.platformLead.updateMany({
    where: { id: lead.id, workspaceId, updatedAt: lead.updatedAt },
    data: {
      qualificationScore: result.score,
      qualificationCategory: category,
      qualificationExplanation: `${result.explanation}\n\nUncertainties: ${result.uncertainties.join("; ")}`,
      qualifiedAt: new Date(),
      ...(lead.status === "NEW"
        ? { status: result.score >= 50 ? "QUALIFIED" : "UNQUALIFIED" }
        : {}),
    },
  });
  if (!updated.count)
    throw new HttpError(
      409,
      "Lead changed during qualification. Review its current details before trying again.",
    );
  await notice(
    workspaceId,
    operationKey,
    "LEAD_QUALIFIED",
    "Lead qualification completed",
    `${lead.company}: ${result.score}/100 (${category}). Review the explanation before approving outreach.`,
  );
  return {
    summary: `${lead.company} scored ${result.score}/100 (${category}).`,
  };
}
export async function verifyEmail(workspaceId: string, leadId: string) {
  const lead = await db.platformLead.findFirst({
    where: { id: leadId, workspaceId },
  });
  if (!lead?.email)
    throw new HttpError(
      409,
      "Save a published business email before verification",
    );
  if (
    !process.env.EMAIL_VERIFICATION_URL ||
    !process.env.EMAIL_VERIFICATION_API_KEY
  )
    throw new HttpError(
      503,
      "Configure an approved email verification gateway",
    );
  const url = new URL(process.env.EMAIL_VERIFICATION_URL);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new HttpError(503, "Verification gateway requires HTTPS");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${process.env.EMAIL_VERIFICATION_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: lead.email }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      `Email verification failed (HTTP ${response.status})`,
    );
  const result = z
    .object({
      email: z.email(),
      status: z.enum(["VALID", "INVALID", "RISKY", "UNKNOWN"]),
    })
    .parse(await response.json());
  if (result.email.toLowerCase() !== lead.email.toLowerCase())
    throw new HttpError(502, "Verifier returned a different address");
  await db.platformLead.updateMany({
    where: { id: lead.id, workspaceId, email: lead.email },
    data: { verificationStatus: result.status, verifiedAt: new Date() },
  });
  return {
    summary: `Email verification result: ${result.status}. Marketing permission remains separate.`,
  };
}
export async function draftEmail(
  workspaceId: string,
  leadId: string,
  operationKey: string,
) {
  const [organization, lead] = await Promise.all([
    db.platformOrganization.findUniqueOrThrow({ where: { workspaceId } }),
    db.platformLead.findFirst({ where: { id: leadId, workspaceId } }),
  ]);
  if (!organization.profileApprovedAt || !lead)
    throw new HttpError(
      409,
      "Approve your business profile and select a researched lead",
    );
  const config = await ai(workspaceId, operationKey);
  const evidence = z.array(evidenceSchema).parse(lead.evidence);
  const profile = businessProfileSchema.parse(organization.profile);
  const result = await analyseBusiness(config, {
    company: lead.company,
    websiteUrl: lead.website,
    offer: [...profile.products, ...profile.services].join("; ").slice(0, 2000),
    sender: profile.companyName,
    evidence,
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const updated = await tx.platformLead.updateMany({
      where: { id: lead.id, workspaceId, updatedAt: lead.updatedAt },
      data: { draftSubject: result.subject, draftBody: result.body },
    });
    if (!updated.count)
      throw new HttpError(
        409,
        "Lead changed while drafting. Review its current details before trying again.",
      );
    const recipients = await tx.platformCampaignRecipient.findMany({
      where: { workspaceId, leadId: lead.id },
      select: { campaignId: true },
    });
    await tx.platformCampaignRecipient.updateMany({
      where: { workspaceId, leadId: lead.id },
      data: { approvedAt: null, approvedBy: null },
    });
    await tx.platformCampaign.updateMany({
      where: {
        workspaceId,
        id: { in: recipients.map((r) => r.campaignId) },
        status: { in: ["APPROVED", "RUNNING", "PAUSED"] },
      },
      data: { status: "PAUSED", approvedAt: null, approvedBy: null },
    });
  });
  return {
    summary:
      "Personalized draft saved for review. Existing content approvals were cleared.",
  };
}
export async function classifyReply(
  workspaceId: string,
  messageId: string,
  operationKey: string,
) {
  const message = await db.platformMailMessage.findFirst({
    where: { id: messageId, workspaceId, direction: "INBOUND" },
  });
  if (!message) throw new HttpError(404, "Reply not found");
  if (
    message.classification &&
    !message.classificationExplanation?.startsWith("Provisional")
  )
    return { summary: "Reply was already classified." };
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  const result = await structuredAnalysis(
    await ai(workspaceId, operationKey),
    replySchema,
    "Classify this incoming email. Suggest a reply for human review only. Never invent prices, contracts, guarantees or meeting availability. Objections and requests to stop must be UNSUBSCRIBE.",
    {
      incoming: { subject: message.subject, body: message.body },
      businessProfile: organization.profileApprovedAt
        ? organization.profile
        : null,
    },
  );
  await db.$transaction(async (tx) => {
    const updated = await tx.platformMailMessage.updateMany({
      where: {
        id: message.id,
        workspaceId,
        classification: message.classification,
        classificationExplanation: message.classificationExplanation,
      },
      data: {
        classification: result.classification,
        classificationExplanation: result.explanation,
        suggestedReply: result.suggestedResponse,
      },
    });
    if (!updated.count || !message.leadId) return;
    const positive = ["INTERESTED", "PRICING", "MEETING_REQUESTED"].includes(
      result.classification,
    );
    const lead = await tx.platformLead.findFirst({
      where: { id: message.leadId, workspaceId },
    });
    if (!lead) return;
    if (result.classification === "UNSUBSCRIBE") {
      await tx.platformLead.update({
        where: { id: lead.id },
        data: {
          status: "UNSUBSCRIBED",
          eligibility: "SUPPRESSED",
          unsubscribedAt: new Date(),
        },
      });
      if (lead.email)
        await tx.platformMailSuppression.upsert({
          where: { workspaceId_email: { workspaceId, email: lead.email } },
          create: { workspaceId, email: lead.email, reason: "REPLY_OBJECTION" },
          update: { reason: "REPLY_OBJECTION" },
        });
    } else if (positive) {
      const score =
        lead.qualificationScore === null
          ? null
          : Math.min(100, lead.qualificationScore + 10);
      await tx.platformLead.update({
        where: { id: lead.id },
        data: {
          status: "INTERESTED",
          ...(score === null
            ? {}
            : {
                qualificationScore: score,
                qualificationCategory: qualificationCategory(score),
              }),
        },
      });
    }
    await notice(
      workspaceId,
      operationKey,
      result.classification === "MEETING_REQUESTED"
        ? "MEETING_REQUESTED"
        : positive
          ? "POSITIVE_REPLY"
          : "REPLY_CLASSIFIED",
      result.classification === "MEETING_REQUESTED"
        ? "A meeting was requested"
        : positive
          ? "A prospect responded positively"
          : "Reply classified",
      `${lead.company}: ${result.explanation} Suggested responses require your approval.`,
      "INFO",
      tx,
    );
  });
  return {
    summary: `Reply classified as ${result.classification}; suggested response requires client review.`,
  };
}
