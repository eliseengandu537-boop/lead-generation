import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { hash, secret, encrypt, decrypt } from "./security";
export function identityEmailConfigured() {
  return (
    !!process.env.RESEND_API_KEY &&
    !!z.email().safeParse(process.env.IDENTITY_FROM_EMAIL).success
  );
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
  if (!identityEmailConfigured()) return;
  // Provider idempotency lasts 24 hours. Expire work well inside that window.
  await db.identityEmail.updateMany({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      createdAt: { lt: new Date(Date.now() - 6 * 3600000) },
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `identity/${item.id}`,
      },
      body: JSON.stringify({
        from: process.env.IDENTITY_FROM_EMAIL,
        to: [item.to],
        subject: item.subject,
        text: decrypt(item.encryptedBody),
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Email provider returned HTTP ${response.status}`);
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
