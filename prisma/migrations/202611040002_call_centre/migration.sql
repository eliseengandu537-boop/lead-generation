-- Additive only. Existing users, client roles, campaign data and keys are preserved.
ALTER TABLE "User" ADD COLUMN "staffRole" TEXT, ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "callerCanSend" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformLead" ADD COLUMN "createdById" TEXT,
 ADD COLUMN "doNotCall" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "salesQualification" TEXT NOT NULL DEFAULT 'UNREVIEWED',
 ADD COLUMN "salesQualificationNotes" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "salesQualifiedAt" TIMESTAMP(3), ADD COLUMN "salesQualifiedBy" TEXT;
ALTER TABLE "PlatformCampaign" ADD COLUMN "createdById" TEXT;

CREATE TABLE "PlatformCall" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "leadId" TEXT NOT NULL, "callerId" TEXT NOT NULL, "mode" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PREPARED', "toNumber" TEXT NOT NULL, "fromNumber" TEXT,
 "providerParentSid" TEXT UNIQUE, "providerSid" TEXT UNIQUE, "lastSequence" INTEGER NOT NULL DEFAULT -1,
 "outcome" TEXT NOT NULL DEFAULT 'UNRECORDED', "notes" TEXT NOT NULL DEFAULT '',
 "durationSeconds" INTEGER CHECK ("durationSeconds" BETWEEN 0 AND 21600),
 "reportedDurationSeconds" INTEGER CHECK ("reportedDurationSeconds" BETWEEN 0 AND 21600),
 "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "nonceHash" TEXT, "expiresAt" TIMESTAMP(3),
 "startedAt" TIMESTAMP(3), "answeredAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId","leadId") REFERENCES "PlatformLead"("workspaceId","id") ON DELETE CASCADE,
 UNIQUE ("workspaceId","id"), UNIQUE ("workspaceId","requestId")
);
CREATE INDEX "PlatformCall_workspaceId_callerId_createdAt_idx" ON "PlatformCall"("workspaceId","callerId","createdAt");
CREATE TABLE "PlatformCallEvent" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "callId" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "status" TEXT NOT NULL, "durationSeconds" INTEGER,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId","callId") REFERENCES "PlatformCall"("workspaceId","id") ON DELETE CASCADE,
 UNIQUE ("workspaceId","eventKey")
);
CREATE TABLE "PlatformBooking" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "leadId" TEXT NOT NULL, "callId" TEXT, "bookedById" TEXT NOT NULL, "hostId" TEXT NOT NULL,
 "title" TEXT NOT NULL, "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3) NOT NULL,
 "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg', "location" TEXT NOT NULL DEFAULT '',
 "meetingUrl" TEXT NOT NULL DEFAULT '', "notes" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
 "version" INTEGER NOT NULL DEFAULT 0, "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId","leadId") REFERENCES "PlatformLead"("workspaceId","id") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId","callId") REFERENCES "PlatformCall"("workspaceId","id"),
 CHECK ("endAt">"startAt"), UNIQUE ("workspaceId","id"), UNIQUE ("workspaceId","requestId")
);
CREATE INDEX "PlatformBooking_hostId_startAt_endAt_idx" ON "PlatformBooking"("hostId","startAt","endAt");
CREATE INDEX "PlatformBooking_workspaceId_bookedById_startAt_idx" ON "PlatformBooking"("workspaceId","bookedById","startAt");
-- Voice credentials use control-only RLS, even when a tenant capability exists.
CREATE TABLE "PlatformVoiceProvider" (
 "businessId" TEXT PRIMARY KEY REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "provider" TEXT NOT NULL DEFAULT 'TWILIO', "fromNumber" TEXT NOT NULL,
 "encryptedCredentials" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "PlatformVoiceProvider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformVoiceProvider" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PlatformVoiceProvider" FROM PUBLIC, crm_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformVoiceProvider" TO crm_control;
DO $$ BEGIN EXECUTE format('CREATE POLICY crm_voice_control ON "PlatformVoiceProvider" TO crm_control, %I USING (true) WITH CHECK (true)',current_user); END $$;
SELECT public.crm_install_tenant_rls();
