-- A campaign is either ordinary outreach to recipients with recorded permission, or the single
-- POPIA section 69(2) request for that permission. Existing campaigns remain outreach.
ALTER TABLE "PlatformCampaign" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'OUTREACH';
ALTER TABLE "PlatformCampaign" ADD CONSTRAINT "PlatformCampaign_purpose_check"
  CHECK ("purpose" IN ('OUTREACH', 'PERMISSION_REQUEST'));
