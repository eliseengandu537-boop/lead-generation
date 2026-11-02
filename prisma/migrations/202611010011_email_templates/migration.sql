CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmailTemplate_approval_pair" CHECK (("approvedAt" IS NULL) = ("approvedBy" IS NULL))
);
CREATE UNIQUE INDEX "EmailTemplate_workspaceId_id_key" ON "EmailTemplate"("workspaceId", "id");
CREATE INDEX "EmailTemplate_workspaceId_updatedAt_idx" ON "EmailTemplate"("workspaceId", "updatedAt");
SELECT public.crm_install_tenant_rls();
