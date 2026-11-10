import { createHash } from "node:crypto";
import { z } from "zod";

export type SmtpAccountEmailConfig = {
  provider: "SMTP";
  sender: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type AccountEmailConfig =
  | SmtpAccountEmailConfig
  | {
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
  const sender = env.IDENTITY_FROM_EMAIL?.trim();
  if (!sender || !z.email().safeParse(sender).success) return null;
  if (provider === "SMTP") {
    const host = env.SMTP_HOST?.trim().toLowerCase();
    const port = Number(env.SMTP_PORT || "587");
    const secure = env.SMTP_SECURE === "true";
    const username = env.SMTP_USER?.trim();
    const password = env.SMTP_PASSWORD;
    if (
      !host ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      ![465, 587, 2525].includes(port) ||
      secure !== (port === 465) ||
      !username ||
      /[\r\n]/.test(username) ||
      !password?.trim() ||
      /[\r\n]/.test(password)
    )
      return null;
    return { provider, sender, host, port, secure, username, password };
  }
  if (provider !== "RESEND" && provider !== "BREVO") return null;
  const apiKey = (
    provider === "BREVO" ? env.BREVO_API_KEY : env.RESEND_API_KEY
  )?.trim();
  if (!apiKey) return null;
  return { provider, apiKey, sender };
}

/** The hosted web process queues mail after the local worker has passed a real
 * SMTP test. Its environment does not need the worker's SMTP password. */
export function accountEmailConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    env.IDENTITY_EMAIL_PROVIDER?.trim().toUpperCase() === "SMTP" &&
    env.IDENTITY_SMTP_READY === "true" &&
    z.email().safeParse(env.IDENTITY_FROM_EMAIL?.trim()).success
  )
    return true;
  return Boolean(accountEmailConfig(env));
}

export function accountEmailRetryWindowMs(
  provider: AccountEmailConfig["provider"],
) {
  // Stay inside both Brevo's historical 15-minute and current 30-minute
  // deduplication windows, and Resend's 24-hour window.
  return provider === "BREVO" ? 10 * 60_000 : 6 * 3_600_000;
}

function brevoIdempotencyKey(id: string) {
  // Keep this namespace stable across rebrands to prevent duplicate sends.
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
  if (config.provider === "SMTP") {
    const { deliverSmtpAccountEmail } = await import("./account-smtp");
    return deliverSmtpAccountEmail(config, message);
  }
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
              sender: { name: "Monettic", email: config.sender },
              to: [{ email: message.to }],
              subject: message.subject,
              textContent: message.body,
              headers: { idempotencyKey: brevoIdempotencyKey(message.id) },
            }
          : {
              from: `Monettic <${config.sender}>`,
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
