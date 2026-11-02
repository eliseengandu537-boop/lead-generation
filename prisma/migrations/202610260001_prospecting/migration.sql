-- CreateTable
CREATE TABLE "ProspectSettings" (
    "workspaceId" TEXT NOT NULL,
    "encryptedSearchKey" TEXT,
    "encryptedAiKey" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    "dailySearchLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyAiLimit" INTEGER NOT NULL DEFAULT 50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "origin" TEXT NOT NULL DEFAULT 'LIVE',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "research" JSONB,
    "draftSubject" TEXT NOT NULL DEFAULT '',
    "draftBody" TEXT NOT NULL DEFAULT '',
    "offer" TEXT NOT NULL DEFAULT '',
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LIVE',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "query" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_status_idx" ON "Prospect"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_workspaceId_websiteUrl_key" ON "Prospect"("workspaceId", "websiteUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_workspaceId_id_key" ON "Prospect"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ProspectRun_workspaceId_createdAt_idx" ON "ProspectRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectRun_status_createdAt_idx" ON "ProspectRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProspectSettings" ADD CONSTRAINT "ProspectSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "Contact"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectRun" ADD CONSTRAINT "ProspectRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectRun" ADD CONSTRAINT "ProspectRun_workspaceId_prospectId_fkey" FOREIGN KEY ("workspaceId", "prospectId") REFERENCES "Prospect"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
