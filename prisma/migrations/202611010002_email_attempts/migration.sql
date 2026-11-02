CREATE TABLE "EmailAttempt" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "recipientId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "messageHash" TEXT NOT NULL,
 "rfcMessageId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'SENDING',
 "providerMessageId" TEXT, "providerThreadId" TEXT, "lastSyncedAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId", "accountId") REFERENCES "SendingAccount"("workspaceId", "id"),
 FOREIGN KEY ("workspaceId", "recipientId") REFERENCES "Recipient"("workspaceId", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "EmailAttempt_dedupeKey_key" ON "EmailAttempt"("dedupeKey");
CREATE UNIQUE INDEX "EmailAttempt_rfcMessageId_key" ON "EmailAttempt"("rfcMessageId");
CREATE INDEX "EmailAttempt_workspaceId_accountId_status_createdAt_idx" ON "EmailAttempt"("workspaceId", "accountId", "status", "createdAt");
ALTER TABLE "ProviderEvent" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DEVELOPMENT';
