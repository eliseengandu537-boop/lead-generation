import { z } from "zod";
import { hash as passwordHash } from "bcryptjs";
import { db } from "@/lib/db";
import { hash } from "@/lib/security";
import { sameOrigin, rateLimit, HttpError } from "@/lib/auth";
import { json, handle } from "@/lib/http";
import { identityToken, identityEmailConfigured } from "@/lib/identity";
import { createOrganizationInTransaction } from "@/platform/core";
const email = z.email().transform((value) => value.toLowerCase().trim());
const password = z.string().min(16).max(128);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("register"),
      email,
      password,
      name: z.string().trim().min(1).max(160),
      business: z.string().trim().min(2).max(160),
    })
    .strict(),
  z
    .object({ action: z.enum(["request-reset", "resend-verification"]), email })
    .strict(),
  z
    .object({ action: z.literal("verify"), token: z.string().length(64) })
    .strict(),
  z
    .object({
      action: z.literal("reset"),
      token: z.string().length(64),
      password,
    })
    .strict(),
]);
export async function POST(request: Request) {
  return handle(async () => {
    await sameOrigin();
    await rateLimit("account:global", 100);
    const input = schema.parse(await json(request));
    if ("email" in input)
      await rateLimit(`account:${hash(input.email)}`, 5, 60);
    if (input.action === "register") {
      if (!identityEmailConfigured())
        throw new HttpError(
          503,
          "Registration requires a configured account email provider",
        );
      const digest = await passwordHash(input.password, 12);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.email}))`;
        if (await tx.user.findUnique({ where: { email: input.email } })) return;
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash: digest,
            requiresVerification: true,
          },
        });
        await createOrganizationInTransaction(tx, user, {
          name: input.business,
        });
        await identityToken(tx, user.id, user.email, "VERIFY");
      });
      return {
        message:
          "If this address can be registered, a verification email will arrive shortly. Existing users can sign in or reset their password.",
      };
    }
    if (
      input.action === "request-reset" ||
      input.action === "resend-verification"
    ) {
      if (!identityEmailConfigured())
        throw new HttpError(503, "Account email is not configured");
      await db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { email: input.email },
        });
        if (user && (input.action === "request-reset" || !user.emailVerifiedAt))
          await identityToken(
            tx,
            user.id,
            user.email,
            input.action === "request-reset" ? "RESET" : "VERIFY",
          );
      });
      return {
        message: "If this account is eligible, an email will arrive shortly.",
      };
    }
    if (input.action !== "verify" && input.action !== "reset")
      throw new HttpError(400, "Invalid account action");
    const digest =
      input.action === "reset"
        ? await passwordHash(input.password, 12)
        : undefined;
    return db.$transaction(async (tx) => {
      const token = await tx.identityToken.findUnique({
        where: { tokenHash: hash(input.token) },
      });
      if (
        !token ||
        token.consumedAt ||
        token.expiresAt < new Date() ||
        token.purpose !== (input.action === "verify" ? "VERIFY" : "RESET")
      )
        throw new HttpError(400, "Invalid or expired account link");
      const consumed = await tx.identityToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (!consumed.count) throw new HttpError(409, "Link already used");
      await tx.user.update({
        where: { id: token.userId },
        data:
          input.action === "verify"
            ? { emailVerifiedAt: new Date() }
            : { passwordHash: digest!, sessionVersion: { increment: 1 } },
      });
      if (input.action === "reset")
        await tx.identityToken.updateMany({
          where: { userId: token.userId, purpose: "RESET", consumedAt: null },
          data: { consumedAt: new Date() },
        });
      return {
        message:
          input.action === "verify"
            ? "Email verified. You can now sign in."
            : "Password updated. Sign in again on your devices.",
      };
    });
  });
}
