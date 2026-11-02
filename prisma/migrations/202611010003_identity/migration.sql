ALTER TABLE "User" ADD COLUMN "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "IdentityToken" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "purpose" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "IdentityToken_userId_purpose_idx" ON "IdentityToken"("userId", "purpose");
CREATE TABLE "IdentityEmail" (
 "id" TEXT PRIMARY KEY, "to" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "encryptedBody" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0, "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "error" TEXT
);
CREATE INDEX "IdentityEmail_status_runAt_idx" ON "IdentityEmail"("status", "runAt");
