import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { controlDb } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { hash } from "@/lib/security";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { finishGoogleConnection } from "@/platform/mail/google";
export async function GET(request: Request) {
  let connected = false;
  const result = await handle(async () => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state"),
      code = params.get("code");
    if (!state || !code)
      throw new HttpError(
        400,
        "Google authorization was cancelled or incomplete",
      );
    const browser = (await cookies()).get("orbit-google-oauth")?.value || "";
    const pending = await controlDb.platformMailOAuthState.findUnique({
      where: { tokenHash: hash(state) },
    });
    if (
      !pending ||
      pending.browserHash !== hash(browser) ||
      pending.expiresAt < new Date()
    )
      throw new HttpError(400, "Invalid or expired Google authorization");
    const { user } = await organizationAccess(pending.workspaceId, true);
    if (user.id !== pending.userId)
      throw new HttpError(403, "Email authorization belongs to another user");
    await finishGoogleConnection(
      pending.workspaceId,
      user.id,
      state,
      browser,
      code,
    );
    (await cookies()).delete({
      name: "orbit-google-oauth",
      path: "/api/platform/oauth/google/callback",
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
