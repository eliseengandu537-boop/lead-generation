-- Additive only: preserve every existing client, mailbox, user and credential.
CREATE TABLE "PlatformAssistantConfig" (
 "id" TEXT PRIMARY KEY DEFAULT 'claude', "encryptedApiKey" TEXT NOT NULL,
 "model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5', "enabled" BOOLEAN NOT NULL DEFAULT true,
 "connectedAt" TIMESTAMP(3) NOT NULL, "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PlatformAssistantConversation" (
 "id" TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "title" TEXT NOT NULL, "encryptedHistory" TEXT NOT NULL,
 "activeRunId" TEXT, "leaseUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PlatformAssistantConversation_actorId_updatedAt_idx" ON "PlatformAssistantConversation"("actorId","updatedAt");
CREATE TABLE "PlatformAssistantRun" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "PlatformAssistantConversation"("id") ON DELETE CASCADE,
 "actorId" TEXT NOT NULL, "encryptedInput" TEXT NOT NULL, "encryptedResponse" TEXT,
 "status" TEXT NOT NULL DEFAULT 'RUNNING', "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMP(3)
);
CREATE INDEX "PlatformAssistantRun_conversationId_createdAt_idx" ON "PlatformAssistantRun"("conversationId","createdAt");
CREATE INDEX "PlatformAssistantRun_actorId_createdAt_idx" ON "PlatformAssistantRun"("actorId","createdAt");
CREATE TABLE "PlatformAssistantAction" (
 "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "PlatformAssistantRun"("id") ON DELETE CASCADE,
 "type" TEXT NOT NULL, "targetBusinessId" TEXT, "inputHash" TEXT NOT NULL, "encryptedInput" TEXT NOT NULL,
 "encryptedResult" TEXT, "summary" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'EXECUTING', "error" TEXT,
 "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "PlatformAssistantAction_runId_inputHash_key" ON "PlatformAssistantAction"("runId","inputHash");
CREATE INDEX "PlatformAssistantAction_runId_createdAt_idx" ON "PlatformAssistantAction"("runId","createdAt");
CREATE TABLE "PlatformOperationReceipt" (
 "workspaceId" TEXT NOT NULL REFERENCES "PlatformOrganization"("workspaceId") ON DELETE CASCADE,
 "operationKey" TEXT NOT NULL, "scopeHash" TEXT NOT NULL, "encryptedResult" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","operationKey")
);
-- Global assistant state is available only to the control connection. A tenant
-- capability must never confer access to prompts, actions or provider keys.
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['PlatformAssistantConfig','PlatformAssistantConversation','PlatformAssistantRun','PlatformAssistantAction'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, crm_tenant',table_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO crm_control',table_name);
  EXECUTE format('CREATE POLICY crm_assistant_control ON public.%I TO crm_control, %I USING (true) WITH CHECK (true)',table_name,current_user);
 END LOOP;
END $$;
SELECT public.crm_install_tenant_rls();
