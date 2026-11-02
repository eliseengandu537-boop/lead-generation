import { sign, safeEqual } from "@/lib/security";
import { handle } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { unsubscribeMessage } from "@/platform/mail/feedback";
function parameters(request: Request) {
  const query = new URL(request.url).searchParams;
  const messageId = query.get("messageId") || "",
    token = query.get("token") || "";
  if (
    !messageId ||
    !process.env.NEXTAUTH_SECRET ||
    !safeEqual(
      token,
      sign(`platform-unsubscribe:${messageId}`, process.env.NEXTAUTH_SECRET),
    )
  )
    throw new HttpError(400, "Invalid unsubscribe link");
  return { messageId, token, oneClick: query.get("oneClick") === "1" };
}
export async function GET(request: Request) {
  try {
    parameters(request);
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body style="font:18px system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>Unsubscribe from outreach</h1><p>Confirm to stop marketing emails from this business.</p><form method="post"><button style="padding:12px 22px;font:inherit" type="submit">Unsubscribe</button></form></body></html>',
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
        },
      },
    );
  } catch {
    return new Response("Invalid unsubscribe link", { status: 400 });
  }
}
export async function POST(request: Request) {
  return handle(async () => {
    const { messageId, token, oneClick } = parameters(request);
    const raw = await request.text();
    if (raw.length > 1000) throw new HttpError(413, "Request is too large");
    if (
      oneClick &&
      new URLSearchParams(raw).get("List-Unsubscribe") !== "One-Click"
    )
      throw new HttpError(400, "Invalid one-click unsubscribe body");
    await unsubscribeMessage(messageId, token);
    return {
      unsubscribed: true,
      message:
        "You will receive no further marketing outreach from this business.",
    };
  });
}
