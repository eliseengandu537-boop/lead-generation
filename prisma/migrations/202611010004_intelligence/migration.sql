CREATE TABLE "BusinessProfile" (
 "workspaceId" TEXT PRIMARY KEY, "websiteId" TEXT NOT NULL,
 "profile" JSONB NOT NULL, "evidence" JSONB NOT NULL, "targetCriteria" TEXT NOT NULL DEFAULT '',
 "reviewedAt" TIMESTAMP(3), "reviewedBy" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
 FOREIGN KEY ("workspaceId", "websiteId") REFERENCES "Website"("workspaceId", "id")
);
CREATE TABLE "UsageRecord" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "operationKey" TEXT NOT NULL UNIQUE, "quantity" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "UsageRecord_workspaceId_kind_createdAt_idx" ON "UsageRecord"("workspaceId", "kind", "createdAt");
ALTER TABLE "Prospect" ADD COLUMN "qualificationScore" INTEGER,
 ADD COLUMN "qualificationCategory" TEXT, ADD COLUMN "qualificationExplanation" TEXT,
 ADD COLUMN "qualifiedAt" TIMESTAMP(3), ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_qualificationScore_range" CHECK ("qualificationScore" BETWEEN 0 AND 100);
