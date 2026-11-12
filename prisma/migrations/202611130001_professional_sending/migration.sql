-- Professional sending: a campaign can rotate across several of the client's mailboxes, each
-- recipient stays with the mailbox that first wrote to them, new mailboxes ramp up their daily
-- volume, and each mailbox records the SPF/DKIM/DMARC state of its domain.
ALTER TABLE "PlatformOrganization" ADD COLUMN "sendingDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PlatformCampaign" ADD COLUMN "extraMailboxIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PlatformCampaignRecipient" ADD COLUMN "mailboxId" TEXT;
ALTER TABLE "PlatformMailbox" ADD COLUMN "warmupStartedAt" TIMESTAMP(3);
ALTER TABLE "PlatformMailbox" ADD COLUMN "domainHealth" JSONB;
ALTER TABLE "PlatformMailbox" ADD COLUMN "domainCheckedAt" TIMESTAMP(3);

-- Pause a campaign at 3% bounces rather than 5%; campaigns that have not started take the new limit.
ALTER TABLE "PlatformCampaign" ALTER COLUMN "bounceThresholdPercent" SET DEFAULT 3;
UPDATE "PlatformCampaign" SET "bounceThresholdPercent" = 3
  WHERE "status" = 'DRAFT' AND "bounceThresholdPercent" = 5;
