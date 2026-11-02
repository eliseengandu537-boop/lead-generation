CREATE TABLE "WorkflowConfiguration" (
 "workspaceId" TEXT NOT NULL, "workflow" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("workspaceId", "workflow"),
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE TABLE "WorkflowExecution" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL,
 "workflow" TEXT NOT NULL, "triggerSource" TEXT NOT NULL, "actorId" TEXT,
 "idempotencyKey" TEXT NOT NULL, "payload" JSONB NOT NULL, "result" JSONB,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "leaseUntil" TIMESTAMP(3),
 "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "WorkflowExecution_workspaceId_idempotencyKey_key" ON "WorkflowExecution"("workspaceId", "idempotencyKey");
CREATE INDEX "WorkflowExecution_status_nextAttemptAt_idx" ON "WorkflowExecution"("status", "nextAttemptAt");
CREATE INDEX "WorkflowExecution_workspaceId_createdAt_idx" ON "WorkflowExecution"("workspaceId", "createdAt");
