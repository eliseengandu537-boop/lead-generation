CREATE UNIQUE INDEX "WorkflowExecution_workspaceId_id_key" ON "WorkflowExecution"("workspaceId", "id");
CREATE TABLE "AutomationOperation" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "executionId" TEXT NOT NULL, "attempt" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "summary" TEXT, "error" TEXT, "result" JSONB,
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "leaseUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId", "executionId") REFERENCES "WorkflowExecution"("workspaceId", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "AutomationOperation_executionId_attempt_key" ON "AutomationOperation"("executionId", "attempt");
CREATE INDEX "AutomationOperation_status_createdAt_idx" ON "AutomationOperation"("status", "createdAt");
CREATE TABLE "Notification" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL, "severity" TEXT NOT NULL DEFAULT 'INFO',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Notification_workspaceId_dedupeKey_key" ON "Notification"("workspaceId", "dedupeKey");
CREATE UNIQUE INDEX "Notification_workspaceId_id_key" ON "Notification"("workspaceId", "id");
CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");
CREATE TABLE "NotificationRead" (
 "workspaceId" TEXT NOT NULL, "notificationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId", "notificationId", "userId"),
 FOREIGN KEY ("workspaceId", "notificationId") REFERENCES "Notification"("workspaceId", "id") ON DELETE CASCADE,
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
SELECT public.crm_install_tenant_rls();
