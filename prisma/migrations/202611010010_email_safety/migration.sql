ALTER TABLE "SendingAccount" ADD COLUMN "lastFeedbackSyncedAt" TIMESTAMP(3);
ALTER TABLE "Campaign"
 ADD COLUMN "safetyWindowHours" INTEGER NOT NULL DEFAULT 24,
 ADD COLUMN "bounceThresholdPercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
 ADD COLUMN "complaintThresholdPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
 ADD COLUMN "safetyMinimumSent" INTEGER NOT NULL DEFAULT 20,
 ADD COLUMN "safetyPausedAt" TIMESTAMP(3),
 ADD COLUMN "safetyPauseReason" TEXT,
 ADD CONSTRAINT "Campaign_safety_values_check" CHECK (
  "safetyWindowHours" BETWEEN 1 AND 720 AND "safetyMinimumSent" BETWEEN 1 AND 10000
  AND "bounceThresholdPercent" > 0 AND "bounceThresholdPercent" <= 100
  AND "complaintThresholdPercent" > 0 AND "complaintThresholdPercent" <= 100
 );
ALTER TABLE "ProviderEvent"
 ADD COLUMN "attemptId" TEXT,
 ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "EmailAttempt_workspaceId_id_key" ON "EmailAttempt"("workspaceId", "id");
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_workspaceId_attemptId_fkey"
 FOREIGN KEY ("workspaceId", "attemptId") REFERENCES "EmailAttempt"("workspaceId", "id") ON DELETE CASCADE;
CREATE INDEX "ProviderEvent_workspaceId_attemptId_type_idx" ON "ProviderEvent"("workspaceId", "attemptId", "type");
