-- New SaaS namespace. Existing workspaces/business tables are not imported,
-- renamed or deleted. Only explicit new organization creation enters this app.
CREATE TABLE "PlatformOrganization" (
  "workspaceId" text PRIMARY KEY REFERENCES "Workspace"(id) ON DELETE CASCADE,
  "websiteUrl" text NOT NULL DEFAULT '',
  "profile" jsonb NOT NULL DEFAULT '{}',
  "profileEvidence" jsonb NOT NULL DEFAULT '[]',
  "targetCriteria" text NOT NULL DEFAULT '',
  "encryptedSearchKey" text, "encryptedAiKey" text, "aiModel" text NOT NULL DEFAULT 'gpt-4.1-mini',
  "qualificationCriteria" jsonb NOT NULL DEFAULT '{"minimumScore":70}',
  "profileApprovedAt" timestamp(3), "profileApprovedBy" text,
  "onboardingStatus" text NOT NULL DEFAULT 'NEW',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE "PlatformLead" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  company text NOT NULL, name text NOT NULL DEFAULT '', email text,
  phone text NOT NULL DEFAULT '', industry text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '', "sourceUrl" text NOT NULL DEFAULT '', "sourceKind" text NOT NULL DEFAULT 'MANUAL',
  "contactRole" text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'NEW', notes text NOT NULL DEFAULT '', "ownerId" text,
  evidence jsonb NOT NULL DEFAULT '[]', research jsonb,
  "qualificationScore" integer, "qualificationCategory" text, "qualificationExplanation" text, "qualifiedAt" timestamp(3),
  "verificationStatus" text NOT NULL DEFAULT 'UNKNOWN', "verifiedAt" timestamp(3),
  eligibility text NOT NULL DEFAULT 'UNKNOWN', "consentSource" text, "consentAt" timestamp(3),
  "repliedAt" timestamp(3), "unsubscribedAt" timestamp(3),
  "draftSubject" text NOT NULL DEFAULT '', "draftBody" text NOT NULL DEFAULT '',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  UNIQUE ("workspaceId", id), UNIQUE ("workspaceId", email),
  CHECK ("qualificationScore" IS NULL OR "qualificationScore" BETWEEN 0 AND 100)
);
CREATE INDEX "PlatformLead_workspaceId_status_idx" ON "PlatformLead"("workspaceId", status);
CREATE TABLE "PlatformTemplate" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  category text NOT NULL DEFAULT 'OUTREACH', "approvalStatus" text NOT NULL DEFAULT 'DRAFT',
  "approvedBy" text, "approvedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  UNIQUE ("workspaceId", id)
);
CREATE TABLE "PlatformCampaign" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  "mailboxId" text, "templateId" text, name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]', target jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'DRAFT',
  "approvedBy" text, "approvedAt" timestamp(3), "scheduledAt" timestamp(3), "dailyLimit" integer NOT NULL DEFAULT 25,
  "sendStartHour" integer NOT NULL DEFAULT 0, "sendEndHour" integer NOT NULL DEFAULT 24,
  "sendWeekdays" integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  "bounceThresholdPercent" double precision NOT NULL DEFAULT 5,
  "complaintThresholdPercent" double precision NOT NULL DEFAULT 0.1,
  "safetyMinimumSent" integer NOT NULL DEFAULT 20, "safetyWindowHours" integer NOT NULL DEFAULT 24,
  "safetyPausedAt" timestamp(3), "safetyPauseReason" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  UNIQUE ("workspaceId", id),
  FOREIGN KEY ("workspaceId", "templateId") REFERENCES "PlatformTemplate"("workspaceId", id),
  CHECK ("dailyLimit" BETWEEN 1 AND 10000),
  CHECK ("sendStartHour" BETWEEN 0 AND 23 AND "sendEndHour" BETWEEN 1 AND 24)
);
CREATE INDEX "PlatformCampaign_workspaceId_status_idx" ON "PlatformCampaign"("workspaceId", status);
CREATE TABLE "PlatformCampaignRecipient" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL, "campaignId" text NOT NULL, "leadId" text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED', step integer NOT NULL DEFAULT 0,
  subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', "approvedAt" timestamp(3), "approvedBy" text,
  "nextAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("workspaceId", id), UNIQUE ("campaignId", "leadId"),
  FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "PlatformCampaign"("workspaceId", id) ON DELETE CASCADE,
  FOREIGN KEY ("workspaceId", "leadId") REFERENCES "PlatformLead"("workspaceId", id) ON DELETE CASCADE
);
CREATE INDEX "PlatformCampaignRecipient_schedule_idx" ON "PlatformCampaignRecipient"("workspaceId", status, "nextAt");
CREATE TABLE "PlatformNotice" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  kind text NOT NULL, title text NOT NULL, message text NOT NULL, severity text NOT NULL DEFAULT 'INFO',
  "dedupeKey" text NOT NULL UNIQUE, "readBy" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformNotice_workspaceId_createdAt_idx" ON "PlatformNotice"("workspaceId", "createdAt");
CREATE TABLE "PlatformActivity" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  "actorId" text, "leadId" text, "campaignId" text, kind text NOT NULL, detail text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformActivity_workspaceId_createdAt_idx" ON "PlatformActivity"("workspaceId", "createdAt");
CREATE TABLE "PlatformPlan" (
  id text PRIMARY KEY, name text NOT NULL, "priceMinor" integer, currency text NOT NULL DEFAULT 'ZAR',
  "monthlyProspects" integer NOT NULL, "dailyEmails" integer NOT NULL, "dailyAi" integer NOT NULL, "teamMembers" integer NOT NULL,
  features text[] NOT NULL DEFAULT ARRAY[]::text[], available boolean NOT NULL DEFAULT false, "updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE "PlatformSubscription" (
  "workspaceId" text PRIMARY KEY REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  "planId" text NOT NULL REFERENCES "PlatformPlan"(id), status text NOT NULL DEFAULT 'TRIAL',
  "providerReference" text, "periodEnd" timestamp(3), "updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE "PlatformUsage" (
  id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
  kind text NOT NULL, "operationKey" text NOT NULL, quantity integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("workspaceId", "operationKey"), CHECK (quantity > 0)
);
CREATE INDEX "PlatformUsage_workspaceId_kind_createdAt_idx" ON "PlatformUsage"("workspaceId", kind, "createdAt");
INSERT INTO "PlatformPlan" (id, name, "priceMinor", "monthlyProspects", "dailyEmails", "dailyAi", "teamMembers", available, "updatedAt")
VALUES ('TRIAL14', '14-day trial', 0, 100, 25, 20, 3, true, CURRENT_TIMESTAMP),
('STARTER', 'Starter', NULL, 500, 50, 100, 3, false, CURRENT_TIMESTAMP),
('PROFESSIONAL', 'Professional', NULL, 2000, 200, 500, 10, false, CURRENT_TIMESTAMP),
('BUSINESS', 'Business', NULL, 10000, 1000, 2000, 50, false, CURRENT_TIMESTAMP);
GRANT SELECT ON "PlatformPlan" TO crm_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformPlan" TO crm_control;
SELECT public.crm_install_tenant_rls();
