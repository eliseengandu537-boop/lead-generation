ALTER TABLE "Workspace" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
CREATE TABLE "SubscriptionPlan" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "priceMinor" INTEGER,
 "currency" TEXT NOT NULL DEFAULT 'ZAR', "monthlyProspects" INTEGER NOT NULL,
 "dailyEmails" INTEGER NOT NULL, "dailyAi" INTEGER NOT NULL, "teamMembers" INTEGER NOT NULL,
 "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "available" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SubscriptionPlan_nonnegative_limits" CHECK ("monthlyProspects">=0 AND "dailyEmails">=0 AND "dailyAi">=0 AND "teamMembers">=1 AND ("priceMinor" IS NULL OR "priceMinor">=0))
);
CREATE TABLE "Subscription" (
 "workspaceId" TEXT PRIMARY KEY, "planId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'TRIAL',
 "providerReference" TEXT, "periodEnd" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
 FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id")
);
