-- Applies only to the replacement platform. Legacy CRM data is untouched.
ALTER TABLE "PlatformOrganization" ADD COLUMN "retentionDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "PlatformOrganization" ADD CONSTRAINT "PlatformOrganization_retentionDays_check" CHECK ("retentionDays" BETWEEN 30 AND 3650);
