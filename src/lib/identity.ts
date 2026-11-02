import { Prisma } from "@prisma/client";
import { db } from "./db";
import { hash, secret, encrypt, decrypt } from "./security";
import {
  accountEmailConfig,
  accountEmailRetryWindowMs,
  deliverAccountEmail,
} from "./account-email";
export function identityEmailConfigured() {
  return Boolean(accountEmailConfig());
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
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "IdentityEmail" WHERE status IN ('PENDING','SENDING') AND "runAt" <= CURRENT_TIMESTAMP AND attempts < 5 ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return tx.identityEmail.update({
      where: { id: rows[0].id },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        runAt: new Date(Date.now() + 60000),
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
        status: item.attempts >= 5 ? "FAILED" : "PENDING",
        runAt: new Date(Date.now() + 2 ** item.attempts * 60000),
        error: "Account email failed. Check provider configuration and retry.",
      },
    });
  }
}
