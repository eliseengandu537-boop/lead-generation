import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { controlDb } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { hash } from "@/lib/security";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import {
  finishMicrosoftConnection,
  microsoftStateHash,
} from "@/platform/mail/microsoft";
export async function GET(request: Request) {
  let connected = false;
  const result = await handle(async () => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state"),
      code = params.get("code");
    if (!state || !code)
      throw new HttpError(
        400,
        params.get("error") === "access_denied"
          ? "Microsoft 365 authorization was declined. Your administrator may need to approve the app."
          : "Microsoft 365 authorization was cancelled or incomplete",
      );
    const browser = (await cookies()).get("orbit-microsoft-oauth")?.value || "";
    const pending = await controlDb.platformMailOAuthState.findUnique({
      where: { tokenHash: microsoftStateHash(state) },
    });
    if (
      !pending ||
      pending.browserHash !== hash(browser) ||
      pending.expiresAt < new Date()
    )
      throw new HttpError(400, "Invalid or expired Microsoft 365 authorization");
    const { user } = await organizationAccess(pending.workspaceId, true);
    if (user.id !== pending.userId)
      throw new HttpError(403, "Email authorization belongs to another user");
    await finishMicrosoftConnection(
      pending.workspaceId,
      user.id,
      state,
      browser,
      code,
    );
    (await cookies()).delete({
      name: "orbit-microsoft-oauth",
      path: "/api/platform/oauth/microsoft/callback",
    });
    connected = true;
    return { ok: true };
  });
  return connected
    ? NextResponse.redirect(
        new URL("/?email=connected", process.env.NEXTAUTH_URL),
      )
    : result;
}
