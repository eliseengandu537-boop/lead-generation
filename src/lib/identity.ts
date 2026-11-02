import { Prisma } from "@prisma/client";
import { db } from "./db";
import { hash, secret, encrypt, decrypt } from "./security";
import {
  accountEmailConfig,
  accountEmailConfigured,
  accountEmailRetryWindowMs,
  deliverAccountEmail,
} from "./account-email";
export function identityEmailConfigured() {
  return accountEmailConfigured();
}
export async function identityToken(
  tx: Prisma.TransactionClient,
  userId: string,
  email: string,
  purpose: "VERIFY" | "RESET",
) {
  const token = secret();
  await tx.identityToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hash(token),
      expiresAt: new Date(
        Date.now() + (purpose === "VERIFY" ? 24 * 3600000 : 3600000),
      ),
    },
  });
  const url = `${process.env.NEXTAUTH_URL}/account?mode=${purpose === "VERIFY" ? "verify" : "reset"}&token=${token}`;
  await tx.identityEmail.create({
    data: {
      to: email,
      subject:
        purpose === "VERIFY"
          ? "Verify your business account"
          : "Reset your password",
      encryptedBody: encrypt(
        `${purpose === "VERIFY" ? "Verify your email to activate your workspace" : "Reset your password"}:\n\n${url}\n\nIf you did not request this, ignore this message.`,
      ),
    },
  });
}
export async function sendIdentityEmails() {
  const config = accountEmailConfig();
  if (!config) return;
  const smtp = config.provider === "SMTP";
  if (smtp) {
    // SMTP has no idempotency contract. A worker restart must never replay a
    // message that may already have been accepted by the provider.
    await db.identityEmail.updateMany({
      where: { status: "SENDING", runAt: { lte: new Date() } },
      data: {
        status: "FAILED",
        error:
          "SMTP delivery outcome is uncertain. Request a fresh account link.",
      },
    });
  }
  // Never retry outside the selected provider's deduplication window.
  await db.identityEmail.updateMany({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      createdAt: {
        lt: new Date(Date.now() - accountEmailRetryWindowMs(config.provider)),
      },
    },
    data: { status: "FAILED", error: "Expired. Request a new account link." },
  });
  const item = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      smtp
        ? Prisma.sql`SELECT id FROM "IdentityEmail" WHERE status='PENDING' AND attempts=0 AND "runAt" <= CURRENT_TIMESTAMP ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`
        : Prisma.sql`SELECT id FROM "IdentityEmail" WHERE status IN ('PENDING','SENDING') AND "runAt" <= CURRENT_TIMESTAMP AND attempts < 5 ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!rows[0]) return null;
    return tx.identityEmail.update({
      where: { id: rows[0].id },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        runAt: new Date(Date.now() + (smtp ? 120000 : 60000)),
      },
    });
  });
  if (!item) return;
  try {
    await deliverAccountEmail(config, {
      id: item.id,
      to: item.to,
      subject: item.subject,
      body: decrypt(item.encryptedBody),
    });
    await db.identityEmail.update({
      where: { id: item.id },
      data: { status: "SENT", encryptedBody: "", error: null },
    });
  } catch {
    await db.identityEmail.update({
      where: { id: item.id },
      data: {
        status: smtp || item.attempts >= 5 ? "FAILED" : "PENDING",
        runAt: new Date(Date.now() + 2 ** item.attempts * 60000),
        error: smtp
          ? "SMTP delivery was not confirmed. Request a fresh account link."
          : "Account email failed. Check provider configuration and retry.",
      },
    });
  }
}
