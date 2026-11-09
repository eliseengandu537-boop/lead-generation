-- Additive sales targets and optional website filter. Existing leads and logins remain intact.
ALTER TABLE "PlatformProspectingConfig"
  ADD COLUMN "dailyCallTarget" INTEGER NOT NULL DEFAULT 100 CHECK ("dailyCallTarget" BETWEEN 1 AND 500),
  ADD COLUMN "requireMissingWebsite" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PlatformProspectingConfig" DROP CONSTRAINT IF EXISTS "PlatformProspectingConfig_dailyLimit_check";
ALTER TABLE "PlatformProspectingConfig" ADD CONSTRAINT "PlatformProspectingConfig_dailyLimit_check" CHECK ("dailyLimit" BETWEEN 1 AND 250);
