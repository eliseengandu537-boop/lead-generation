CREATE TABLE "PlatformMailbox" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "email" TEXT NOT NULL,
 "provider" TEXT NOT NULL DEFAULT 'GMAIL', "status" TEXT NOT NULL DEFAULT 'CONNECTED',
 "encryptedCredentials" TEXT NOT NULL, "dailyLimit" INTEGER NOT NULL DEFAULT 25,
 "minimumIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
 "lastSyncedAt" TIMESTAMP(3), "lastSentAt" TIMESTAMP(3), "syncError" TEXT,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 CHECK ("dailyLimit" BETWEEN 1 AND 1000), CHECK ("minimumIntervalSeconds" BETWEEN 5 AND 3600)
);
CREATE UNIQUE INDEX "PlatformMailbox_workspaceId_email_key" ON "PlatformMailbox"("workspaceId","email");
CREATE UNIQUE INDEX "PlatformMailbox_workspaceId_id_key" ON "PlatformMailbox"("workspaceId","id");
ALTER TABLE "PlatformCampaign" ADD CONSTRAINT "PlatformCampaign_workspaceId_mailboxId_fkey"
 FOREIGN KEY ("workspaceId","mailboxId") REFERENCES "PlatformMailbox"("workspaceId","id");
CREATE TABLE "PlatformMailMessage" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "mailboxId" TEXT NOT NULL,
 "leadId" TEXT, "campaignId" TEXT, "direction" TEXT NOT NULL, "status" TEXT NOT NULL,
 "step" INTEGER NOT NULL DEFAULT 0, "toEmail" TEXT NOT NULL, "fromEmail" TEXT NOT NULL,
 "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL, "rfcMessageId" TEXT NOT NULL, "originalRfcMessageId" TEXT,
 "providerMessageId" TEXT, "providerThreadId" TEXT, "replyToMessageId" TEXT,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "classification" TEXT,
 "classificationExplanation" TEXT, "suggestedReply" TEXT, "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId","mailboxId") REFERENCES "PlatformMailbox"("workspaceId","id"),
 FOREIGN KEY ("workspaceId","leadId") REFERENCES "PlatformLead"("workspaceId","id"),
 FOREIGN KEY ("workspaceId","campaignId") REFERENCES "PlatformCampaign"("workspaceId","id"),
 CHECK ("direction" IN ('INBOUND','OUTBOUND'))
);
CREATE UNIQUE INDEX "PlatformMailMessage_workspaceId_id_key" ON "PlatformMailMessage"("workspaceId","id");
CREATE UNIQUE INDEX "PlatformMailMessage_workspaceId_dedupeKey_key" ON "PlatformMailMessage"("workspaceId","dedupeKey");
CREATE UNIQUE INDEX "PlatformMailMessage_rfcMessageId_key" ON "PlatformMailMessage"("rfcMessageId");
CREATE UNIQUE INDEX "PlatformMailMessage_mailboxId_providerMessageId_key" ON "PlatformMailMessage"("mailboxId","providerMessageId");
CREATE INDEX "PlatformMailMessage_workspaceId_campaignId_status_createdAt_idx" ON "PlatformMailMessage"("workspaceId","campaignId","status","createdAt");
CREATE INDEX "PlatformMailMessage_workspaceId_mailboxId_createdAt_idx" ON "PlatformMailMessage"("workspaceId","mailboxId","createdAt");
ALTER TABLE "PlatformMailMessage" ADD CONSTRAINT "PlatformMailMessage_workspaceId_replyToMessageId_fkey"
 FOREIGN KEY ("workspaceId","replyToMessageId") REFERENCES "PlatformMailMessage"("workspaceId","id");
CREATE TABLE "PlatformMailEvent" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "mailboxId" TEXT NOT NULL,
 "messageId" TEXT NOT NULL, "externalId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "detail" TEXT NOT NULL DEFAULT '', "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId","mailboxId") REFERENCES "PlatformMailbox"("workspaceId","id"),
 FOREIGN KEY ("workspaceId","messageId") REFERENCES "PlatformMailMessage"("workspaceId","id")
);
CREATE UNIQUE INDEX "PlatformMailEvent_mailboxId_externalId_key" ON "PlatformMailEvent"("mailboxId","externalId");
CREATE INDEX "PlatformMailEvent_workspaceId_kind_occurredAt_idx" ON "PlatformMailEvent"("workspaceId","kind","occurredAt");
CREATE INDEX "PlatformMailEvent_workspaceId_messageId_kind_idx" ON "PlatformMailEvent"("workspaceId","messageId","kind");
CREATE TABLE "PlatformMailOAuthState" (
 "tokenHash" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "browserHash" TEXT NOT NULL, "encryptedVerifier" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE
);
CREATE TABLE "PlatformMailSuppression" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "email" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PlatformMailSuppression_workspaceId_email_key" ON "PlatformMailSuppression"("workspaceId","email");
SELECT public.crm_install_tenant_rls();
