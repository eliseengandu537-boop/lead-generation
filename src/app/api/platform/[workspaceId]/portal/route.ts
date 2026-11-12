import { z } from "zod";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { reportData } from "@/platform/analytics";
import { isSendingProvider } from "@/platform/mail/provider";

export const dynamic = "force-dynamic";
const viewSchema = z.enum([
  "dashboard",
  "leads",
  "campaigns",
  "conversations",
  "results",
  "website",
  "updates",
]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
    : [];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handle(async () => {
    const { workspaceId } = await params;
    const { organization } = await organizationAccess(
      workspaceId,
      false,
      "client",
    );
    const view = viewSchema.parse(
      new URL(request.url).searchParams.get("view") || "dashboard",
    );
    const isDemo = organization.onboardingStatus === "DEMO";
    if (view === "website") {
      const profile = record(organization.profile);
      return {
        websiteUrl: organization.websiteUrl,
        companyName:
          typeof profile.companyName === "string" ? profile.companyName : "",
        industry: typeof profile.industry === "string" ? profile.industry : "",
        niche: typeof profile.niche === "string" ? profile.niche : "",
        location: typeof profile.location === "string" ? profile.location : "",
        products: strings(profile.products),
        services: strings(profile.services),
        targetCustomers: strings(profile.targetCustomers),
        serviceAreas: strings(profile.serviceAreas),
        targetCriteria: organization.targetCriteria,
        reviewed: Boolean(organization.profileApprovedAt),
        isDemo,
        tracking: {
          available: false,
          description:
            "This page shows your business profile and outreach targeting. Visitor analytics and website enquiry tracking are not connected.",
        },
      };
    }
    if (view === "leads") {
      const [items, total] = await Promise.all([
        db.platformLead.findMany({
          where: { workspaceId, status: { not: "ARCHIVED" } },
          orderBy: { createdAt: "desc" },
          take: 1000,
          select: {
            id: true,
            company: true,
            name: true,
            email: true,
            industry: true,
            location: true,
            website: true,
            status: true,
            qualificationScore: true,
            qualificationCategory: true,
            qualificationExplanation: true,
            createdAt: true,
          },
        }),
        db.platformLead.count({
          where: { workspaceId, status: { not: "ARCHIVED" } },
        }),
      ]);
      return { items, total };
    }
    if (view === "conversations") {
      const selection = {
        id: true,
        leadId: true,
        campaignId: true,
        direction: true,
        status: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        body: true,
        classification: true,
        createdAt: true,
      } as const;
      const incoming = { workspaceId, direction: "INBOUND" };
      const outgoing = {
        workspaceId,
        direction: "OUTBOUND",
        status: "ACCEPTED",
      };
      const [replies, sent, replyCount, sentCount] = await Promise.all([
        db.platformMailMessage.findMany({
          where: incoming,
          orderBy: { createdAt: "desc" },
          take: 200,
          select: selection,
        }),
        db.platformMailMessage.findMany({
          where: outgoing,
          orderBy: { createdAt: "desc" },
          take: 200,
          select: selection,
        }),
        db.platformMailMessage.count({ where: incoming }),
        db.platformMailMessage.count({ where: outgoing }),
      ]);
      return {
        items: [...replies, ...sent].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        ),
        totals: { replies: replyCount, sent: sentCount },
      };
    }
    if (view === "updates")
      return {
        items: await db.platformNotice.findMany({
          where: {
            workspaceId,
            kind: {
              in: [
                "DEMO",
                "REPORT_READY",
                "REPLY_RECEIVED",
                "MEETING_REQUESTED",
                "CAMPAIGN_COMPLETED",
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, title: true, message: true, createdAt: true },
        }),
      };
    const report = await reportData(workspaceId);
    const campaignResults = report.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      recipients: campaign._count.recipients,
      sent: campaign.sent,
      replies: campaign.replies,
      positiveReplies: campaign.positiveReplies,
      bounces: campaign.bounces,
    }));
    if (view === "campaigns") {
      const content = await db.platformCampaign.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          subject: true,
          body: true,
          scheduledAt: true,
          approvedAt: true,
        },
      });
      return {
        items: campaignResults.map((campaign) => ({
          ...campaign,
          ...content.find((item) => item.id === campaign.id),
        })),
        isDemo,
      };
    }
    const summary = {
      metrics: report.metrics,
      series: report.series,
      campaigns: campaignResults,
      start: report.start,
      end: report.end,
      timezone: report.timezone,
    };
    if (view === "results") return summary;
    const [mailboxes, subscription, recentLeads] = await Promise.all([
      db.platformMailbox.findMany({
        where: { workspaceId },
        select: { status: true, email: true, provider: true },
      }),
      db.platformSubscription.findUnique({
        where: { workspaceId },
        select: { status: true, periodEnd: true },
      }),
      db.platformLead.findMany({
        where: { workspaceId, status: { not: "ARCHIVED" } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          company: true,
          industry: true,
          status: true,
          qualificationScore: true,
        },
      }),
    ]);
    const blockers: string[] = [];
    if (!organization.profileApprovedAt)
      blockers.push("Your business profile and target market need review.");
    if (
      !mailboxes.some(
        (mailbox) =>
          mailbox.status === "LIVE_ENABLED" &&
          isSendingProvider(mailbox.provider),
      )
    )
      blockers.push(
        "Your business sending email needs to be connected and enabled.",
      );
    if (process.env.LIVE_EMAIL_ENABLED !== "true")
      blockers.push(
        "Live outreach has not been activated by your account team.",
      );
    if (
      !subscription ||
      !["ACTIVE", "TRIAL"].includes(subscription.status) ||
      (subscription.periodEnd && subscription.periodEnd < new Date())
    )
      blockers.push("Your outreach service needs to be activated.");
    const running = campaignResults.some(
      (campaign) => campaign.status === "RUNNING",
    );
    const state = isDemo
      ? "DEMO"
      : blockers.length
        ? "SETUP_PENDING"
        : running
          ? "LIVE"
          : "READY";
    return {
      ...summary,
      recentLeads,
      isDemo,
      outreach: {
        state,
        blockers: isDemo ? [] : blockers,
        sender:
          mailboxes.find((mailbox) => mailbox.status === "LIVE_ENABLED")
            ?.email || null,
        description: isDemo
          ? "Sample results for a product walkthrough. No real emails are sent."
          : state === "LIVE"
            ? "Your campaign is active. Approved emails are processed during its sending schedule while automation is online."
            : state === "READY"
              ? "Your sending setup is ready. Your account team can start an approved campaign."
              : "Your account team is preparing live outreach. Emails have not started from this workspace.",
      },
    };
  });
}
