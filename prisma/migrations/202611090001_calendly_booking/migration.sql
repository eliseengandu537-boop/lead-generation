-- A scheduling page is scoped to one business. Existing booking records remain intact.
ALTER TABLE "PlatformProspectingConfig" ADD COLUMN "calendlyUrl" TEXT NOT NULL DEFAULT '';
