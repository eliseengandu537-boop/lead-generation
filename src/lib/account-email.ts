import { createHash } from "node:crypto";
import { z } from "zod";

export type AccountEmailConfig = {
  provider: "RESEND" | "BREVO";
  apiKey: string;
  sender: string;
};

export function accountEmailConfig(
  env: Record<string, string | undefined> = process.env,
): AccountEmailConfig | null {
  const provider = (env.IDENTITY_EMAIL_PROVIDER || "RESEND")
    .trim()
    .toUpperCase();
  if (provider !== "RESEND" && provider !== "BREVO") return null;
  const apiKey = (
    provider === "BREVO" ? env.BREVO_API_KEY : env.RESEND_API_KEY
  )?.trim();
  const sender = env.IDENTITY_FROM_EMAIL?.trim();
  if (!apiKey || !sender || !z.email().safeParse(sender).success) return null;
  return { provider, apiKey, sender };
}

export function accountEmailRetryWindowMs(
  provider: AccountEmailConfig["provider"],
) {
  // Stay inside both Brevo's historical 15-minute and current 30-minute
  // deduplication windows, and Resend's 24-hour window.
  return provider === "BREVO" ? 10 * 60_000 : 6 * 3_600_000;
}

function brevoIdempotencyKey(id: string) {
  const bytes = createHash("sha256").update(`concrete-identity/${id}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.subarray(0, 16).toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function deliverAccountEmail(
  config: AccountEmailConfig,
  message: { id: string; to: string; subject: string; body: string },
  request: typeof fetch = fetch,
) {
  const brevo = config.provider === "BREVO";
  const response = await request(
    brevo
      ? "https://api.brevo.com/v3/smtp/email"
      : "https://api.resend.com/emails",
    {
      method: "POST",
      headers: brevo
        ? { "api-key": config.apiKey, "Content-Type": "application/json" }
        : {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `identity/${message.id}`,
          },
      body: JSON.stringify(
        brevo
          ? {
              sender: { name: "Concrete", email: config.sender },
              to: [{ email: message.to }],
              subject: message.subject,
              textContent: message.body,
              headers: { idempotencyKey: brevoIdempotencyKey(message.id) },
            }
          : {
              from: `Concrete <${config.sender}>`,
              to: [message.to],
              subject: message.subject,
              text: message.body,
            },
      ),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    },
  );
  const data = (await response.json().catch(() => null)) as {
    id?: unknown;
    messageId?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;
  if (
    brevo &&
    response.status === 400 &&
    data?.code === "duplicate_parameter" &&
    typeof data.message === "string" &&
    /idempotenc/i.test(data.message)
  )
    return { accepted: true, duplicate: true };
  const messageId = brevo ? data?.messageId : data?.id;
  if (!response.ok || typeof messageId !== "string" || !messageId)
    throw new Error(
      `${config.provider} account email request failed (HTTP ${response.status})`,
    );
  return { accepted: true, duplicate: false };
}
