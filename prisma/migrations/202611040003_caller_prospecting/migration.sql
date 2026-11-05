-- Additive: preserve accounts, business profiles, credentials and existing activity.
ALTER TABLE "PlatformLead" ADD COLUMN "websitePresence" TEXT NOT NULL DEFAULT 'UNCHECKED',
 ADD COLUMN "websiteCheckedAt" TIMESTAMP(3), ADD COLUMN "websiteEvidence" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "sourceRecordId" TEXT, ADD COLUMN "callbackAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PlatformLead_workspaceId_sourceRecordId_key" ON "PlatformLead"("workspaceId","sourceRecordId");
CREATE TABLE "PlatformProspectingConfig" (
 "businessId" TEXT PRIMARY KEY REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "categories" JSONB NOT NULL DEFAULT '["Restaurants","Beauty"]',
 "cities" JSONB NOT NULL DEFAULT '["Johannesburg","Pretoria","Sandton","Centurion","Midrand","Benoni","Boksburg","Roodepoort"]',
 "dailyLimit" INTEGER NOT NULL DEFAULT 30 CHECK ("dailyLimit" BETWEEN 1 AND 50),
 "maxQueue" INTEGER NOT NULL DEFAULT 150 CHECK ("maxQueue" BETWEEN 10 AND 250),
 "meetingHostId" TEXT, "notifyAdminEmail" BOOLEAN NOT NULL DEFAULT true,
 "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastRunAt" TIMESTAMP(3),
 "lastStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED', "lastError" TEXT, "updatedBy" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "PlatformProspectingConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformProspectingConfig" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PlatformProspectingConfig" FROM PUBLIC, crm_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformProspectingConfig" TO crm_control;
DO $$ BEGIN EXECUTE format('CREATE POLICY crm_prospecting_control ON "PlatformProspectingConfig" TO crm_control, %I USING (true) WITH CHECK (true)',current_user); END $$;
CREATE TABLE "PlatformProspectSearch" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "actorId" TEXT, "idempotencyKey" TEXT NOT NULL, "industry" TEXT NOT NULL DEFAULT 'ALL',
 "city" TEXT NOT NULL DEFAULT 'Gauteng', "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseUntil" TIMESTAMP(3), "added" INTEGER NOT NULL DEFAULT 0, "checked" INTEGER NOT NULL DEFAULT 0,
 "summary" TEXT NOT NULL DEFAULT '', "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), UNIQUE ("workspaceId","id"), UNIQUE ("workspaceId","idempotencyKey")
);
CREATE INDEX "PlatformProspectSearch_status_createdAt_idx" ON "PlatformProspectSearch"("status","createdAt");
CREATE INDEX "PlatformProspectSearch_workspaceId_createdAt_idx" ON "PlatformProspectSearch"("workspaceId","createdAt");
SELECT public.crm_install_tenant_rls();
