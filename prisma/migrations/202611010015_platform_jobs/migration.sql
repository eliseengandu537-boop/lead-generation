CREATE TABLE "PlatformJob" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actorId" TEXT, "kind" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "dedupeKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "attempts" INTEGER NOT NULL DEFAULT 0, "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
 "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3),
 "error" TEXT, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
 FOREIGN KEY ("workspaceId") REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PlatformJob_workspaceId_dedupeKey_key" ON "PlatformJob"("workspaceId","dedupeKey");
CREATE INDEX "PlatformJob_status_runAt_idx" ON "PlatformJob"("status","runAt");
CREATE INDEX "PlatformJob_workspaceId_createdAt_idx" ON "PlatformJob"("workspaceId","createdAt");
SELECT public.crm_install_tenant_rls();
