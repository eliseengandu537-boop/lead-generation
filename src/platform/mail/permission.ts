import type { Prisma, PlatformLead } from "@prisma/client";

// POPIA section 69(2): a business may approach someone once, to ask for consent to electronic
// direct marketing. A permission request is therefore a single email with no follow-ups, sent at
// most once per lead, and a clear "yes" reply is recorded as the consent with its own evidence.
export const campaignPurposes = ["OUTREACH", "PERMISSION_REQUEST"] as const;
export type CampaignPurpose = (typeof campaignPurposes)[number];

type ConsentFields = Pick<
  PlatformLead,
  "eligibility" | "consentSource" | "consentAt" | "repliedAt"
>;
export function hasMarketingPermission(lead: ConsentFields, now = new Date()) {
  return (
    lead.eligibility === "CONSENTED" &&
    !!lead.consentSource?.trim() &&
    !!lead.consentAt &&
    lead.consentAt <= now
  );
}
/** A reply stops outreach, except the reply that granted permission itself. */
export function replyBlocksOutreach(lead: ConsentFields) {
  return (
    !!lead.repliedAt && !(lead.consentAt && lead.repliedAt <= lead.consentAt)
  );
}

export function permissionNotice(business: string) {
  return `This is a one-time request for permission under South Africa's Protection of Personal Information Act. ${business} will only send you marketing emails if you reply YES. If you do not reply, we will not email you again.`;
}
export const withPermissionNotice = (body: string, business: string) =>
  `${body.trimEnd()}\n\n${permissionNotice(business)}`;

export function permissionRequestBlocker(
  lead: Pick<
    PlatformLead,
    | "status"
    | "email"
    | "verificationStatus"
    | "verifiedAt"
    | "qualificationScore"
    | "eligibility"
    | "consentSource"
    | "consentAt"
    | "repliedAt"
    | "unsubscribedAt"
  >,
  minimumScore: number,
  alreadyAsked: boolean,
  now = new Date(),
) {
  if (lead.status === "ARCHIVED") return "Lead is archived";
  if (!lead.email) return "Lead has no email address";
  if (
    lead.verificationStatus !== "VALID" ||
    !lead.verifiedAt ||
    lead.verifiedAt > now ||
    lead.verifiedAt.getTime() < now.getTime() - 30 * 86400_000
  )
    return "Lead needs recent valid email verification";
  if (
    lead.qualificationScore === null ||
    lead.qualificationScore < minimumScore
  )
    return "Lead does not meet the approved qualification threshold";
  if (hasMarketingPermission(lead, now))
    return "Lead already has recorded permission; add it to an outreach campaign instead";
  if (
    lead.eligibility === "SUPPRESSED" ||
    lead.unsubscribedAt ||
    ["NOT_INTERESTED", "UNSUBSCRIBED"].includes(lead.status)
  )
    return "Lead has declined or opted out";
  if (lead.repliedAt)
    return "Lead has already replied; record permission from that conversation instead";
  if (alreadyAsked)
    return "Permission was already requested once; POPIA allows only one request";
  return null;
}

/** Leads that already received, or are queued for, a permission request in another campaign. */
export async function permissionAskedLeadIds(
  tx: Prisma.TransactionClient,
  leadIds: string[],
  exceptCampaignId?: string,
) {
  if (!leadIds.length) return new Set<string>();
  const campaigns = await tx.platformCampaign.findMany({
    where: { purpose: "PERMISSION_REQUEST" },
    select: { id: true, status: true },
  });
  const [sent, pending] = await Promise.all([
    tx.platformMailMessage.findMany({
      where: {
        direction: "OUTBOUND",
        campaignId: { in: campaigns.map((campaign) => campaign.id) },
        leadId: { in: leadIds },
        status: { in: ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"] },
      },
      select: { leadId: true },
    }),
    tx.platformCampaignRecipient.findMany({
      where: {
        campaignId: {
          in: campaigns
            .filter(
              (campaign) =>
                campaign.id !== exceptCampaignId &&
                !["CANCELLED", "COMPLETED"].includes(campaign.status),
            )
            .map((campaign) => campaign.id),
        },
        leadId: { in: leadIds },
        status: { in: ["QUEUED", "PENDING"] },
      },
      select: { leadId: true },
    }),
  ]);
  return new Set(
    [...sent, ...pending].flatMap((item) => (item.leadId ? [item.leadId] : [])),
  );
}

const quoted =
  /^(>|on .+wrote:?$|-{2,}\s*original message|_{5,}|from:\s|sent from my )/i;
const affirmative =
  /^(yes|yep|yeah|sure|ok|okay|please do|please send|go ahead|i agree|i consent|agreed|absolutely|definitely|happy to)\b/;
const negative =
  /\b(no|not|don'?t|do not|stop|remove|unsubscribe|never|later|unless)\b/;
/** The reply's opening line when its first paragraph unambiguously says yes; anything else needs a
 * person to review it. Signatures after a blank line and quoted earlier messages are ignored. */
export function clearConsentReply(text: string) {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (quoted.test(line)) break;
    if (!line) {
      if (lines.length) break;
      continue;
    }
    lines.push(line);
  }
  const first = lines[0];
  if (!first || lines.length > 3 || first.length > 200) return null;
  const words = first
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!affirmative.test(words) || lines.some((line) => negative.test(line.toLowerCase())))
    return null;
  return first;
}
