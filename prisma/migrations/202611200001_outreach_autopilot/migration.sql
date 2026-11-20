-- Outreach autopilot: each client's niches, email, reply-to sales reps and running state.
-- Table-level tenant grants and row policies on PlatformOrganization already cover the new column.
ALTER TABLE "PlatformOrganization" ADD COLUMN "outreach" JSONB NOT NULL DEFAULT '{}';
