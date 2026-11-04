import type {
  PlatformCampaign,
  PlatformCampaignRecipient,
  PlatformLead,
  PlatformMailbox,
  PlatformOrganization,
} from "@prisma/client";
import { hash, personalize } from "@/lib/security";

export function campaignReviewData(
  campaign: PlatformCampaign & {
    recipients: (PlatformCampaignRecipient & { lead: PlatformLead })[];
  },
  organization: PlatformOrganization,
  mailbox: Pick<PlatformMailbox, "id" | "email" | "provider" | "status"> | null,
) {
  const recipients = [...campaign.recipients]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((recipient) => {
      const lead = recipient.lead;
      const contact = {
        name: lead.name,
        company: lead.company,
        email: lead.email || "",
      };
      const hasDraft = Boolean(
        lead.draftSubject.trim() && lead.draftBody.trim(),
      );
      return {
        id: recipient.id,
        leadId: lead.id,
        company: lead.company,
        name: lead.name,
        email: lead.email,
        subject: hasDraft
          ? lead.draftSubject
          : personalize(campaign.subject, contact),
        body: hasDraft ? lead.draftBody : personalize(campaign.body, contact),
        status: recipient.status,
        eligibility: lead.eligibility,
        consentSource: lead.consentSource,
        consentAt: lead.consentAt,
        verificationStatus: lead.verificationStatus,
        verifiedAt: lead.verifiedAt,
        qualificationScore: lead.qualificationScore,
        leadStatus: lead.status,
        repliedAt: lead.repliedAt,
        unsubscribedAt: lead.unsubscribedAt,
      };
    });
  const snapshot = {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    name: campaign.name,
    websiteUrl: organization.websiteUrl,
    profileApprovedAt: organization.profileApprovedAt,
    qualificationCriteria: organization.qualificationCriteria,
    mailbox: mailbox
      ? {
          id: mailbox.id,
          email: mailbox.email,
          provider: mailbox.provider,
          status: mailbox.status,
        }
      : null,
    subject: campaign.subject,
    body: campaign.body,
    steps: campaign.steps,
    dailyLimit: campaign.dailyLimit,
    scheduledAt: campaign.scheduledAt,
    sendStartHour: campaign.sendStartHour,
    sendEndHour: campaign.sendEndHour,
    sendWeekdays: campaign.sendWeekdays,
    recipients,
  };
  return { ...snapshot, fingerprint: hash(JSON.stringify(snapshot)) };
}
