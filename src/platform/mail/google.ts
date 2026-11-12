import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt, hash, secret } from "@/lib/security";
import { HttpError } from "@/lib/auth";
import { senderAllowed } from "./domain";
import { refreshDomainHealth } from "./authentication";

export const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.NEXTAUTH_URL,
  );
}
export function googleConfig() {
  if (!googleConfigured())
    throw new HttpError(
      503,
      "Google OAuth is not configured by the platform administrator",
    );
  const base = new URL(process.env.NEXTAUTH_URL!);
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:")
    throw new Error("Production OAuth requires HTTPS");
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: new URL("/api/platform/oauth/google/callback", base).href,
  };
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
export async function beginGoogleConnection(
  workspaceId: string,
  userId: string,
  browser: string,
) {
  const config = googleConfig(),
    state = secret(),
    verifier = secret();
  await db.platformMailOAuthState.deleteMany({
    where: { workspaceId, expiresAt: { lt: new Date() } },
  });
  await db.platformMailOAuthState.create({
    data: {
      tokenHash: hash(state),
      workspaceId,
      userId,
      browserHash: hash(browser),
      encryptedVerifier: encrypt(verifier),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: gmailScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }))
    url.searchParams.set(key, value);
  return url.href;
}
export async function finishGoogleConnection(
  workspaceId: string,
  userId: string,
  state: string,
  browser: string,
  code: string,
  request: typeof fetch = fetch,
) {
  const pending = await db.platformMailOAuthState.findFirst({
    where: {
      tokenHash: hash(state),
      workspaceId,
      userId,
      browserHash: hash(browser),
      expiresAt: { gt: new Date() },
    },
  });
  if (!pending)
    throw new HttpError(400, "Invalid or expired email authorization");
  const removed = await db.platformMailOAuthState.deleteMany({
    where: { tokenHash: pending.tokenHash },
  });
  if (!removed.count)
    throw new HttpError(409, "Email authorization was already used");
  const config = googleConfig();
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: decrypt(pending.encryptedVerifier),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(
      400,
      "Google authorization failed; reconnect the email account",
    );
  const token = tokenSchema.parse(await response.json());
  if (
    !token.refresh_token ||
    !gmailScopes.every((scope) => token.scope?.split(" ").includes(scope))
  )
    throw new HttpError(400, "Grant both Gmail permissions and offline access");
  const profileResponse = await request(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!profileResponse.ok)
    throw new HttpError(400, "Google account has no accessible Gmail mailbox");
  const profile = z
    .object({ emailAddress: z.email() })
    .parse(await profileResponse.json());
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  if (!senderAllowed(profile.emailAddress, organization))
    throw new HttpError(
      400,
      "Connect a business email on this client's website domain or one of their sending domains",
    );
  const mailbox = await db.platformMailbox.upsert({
    where: {
      workspaceId_email: {
        workspaceId,
        email: profile.emailAddress.toLowerCase(),
      },
    },
    create: {
      workspaceId,
      email: profile.emailAddress.toLowerCase(),
      provider: "GMAIL",
      warmupStartedAt: new Date(),
      encryptedCredentials: encrypt(
        JSON.stringify({
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: Date.now() + token.expires_in * 1000,
        }),
      ),
      createdBy: userId,
    },
    update: {
      encryptedCredentials: encrypt(
        JSON.stringify({
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: Date.now() + token.expires_in * 1000,
        }),
      ),
      status: "CONNECTED",
      syncError: null,
      lastSyncedAt: null,
    },
  });
  await refreshDomainHealth(workspaceId, 0, [mailbox.id]);
  return mailbox;
}
export async function gmailToken(
  workspaceId: string,
  mailboxId: string,
  request: typeof fetch = fetch,
) {
  const mailbox = await db.platformMailbox.findFirst({
    where: {
      id: mailboxId,
      workspaceId,
      provider: "GMAIL",
      status: { in: ["CONNECTED", "LIVE_ENABLED"] },
    },
  });
  if (!mailbox)
    throw new Error("Email account is disconnected or requires authorization");
  const token = credentialsSchema.parse(
    JSON.parse(decrypt(mailbox.encryptedCredentials)),
  );
  if (token.expiresAt > Date.now() + 60000) return token.accessToken;
  const config = googleConfig();
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status))
      await db.platformMailbox.update({
        where: { id: mailboxId },
        data: {
          status: "RECONNECT_REQUIRED",
          syncError: "Google authorization expired or was revoked",
        },
      });
    throw new Error(
      "Unable to refresh Google authorization; reconnect if access was revoked",
    );
  }
  const next = tokenSchema.parse(await response.json());
  await db.platformMailbox.update({
    where: { id: mailboxId },
    data: {
      encryptedCredentials: encrypt(
        JSON.stringify({
          accessToken: next.access_token,
          refreshToken: next.refresh_token || token.refreshToken,
          expiresAt: Date.now() + next.expires_in * 1000,
        }),
      ),
    },
  });
  return next.access_token;
}

export type OutboundMail = {
  from: string;
  to: string;
  subject: string;
  body: string;
  rfcMessageId: string;
  unsubscribeUrl?: string;
  oneClickUrl?: string;
  inReplyTo?: string;
};
export function googleRawMessage(message: OutboundMail) {
  return Buffer.from(mimeMessage(message)).toString("base64url");
}
/** RFC 5322 plain-text message shared by every sending provider. */
export function mimeMessage(message: OutboundMail) {
  z.email().parse(message.from);
  z.email().parse(message.to);
  if (/[\r\n]/.test(message.subject))
    throw new Error("Subject cannot contain newlines");
  if (!/^<[a-z0-9.-]+@[a-z0-9.-]+>$/i.test(message.rfcMessageId))
    throw new Error("Invalid Message-ID");
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `Message-ID: ${message.rfcMessageId}`,
  ];
  if (message.inReplyTo) {
    if (/[\r\n]/.test(message.inReplyTo))
      throw new Error("Invalid reply reference");
    headers.push(
      `In-Reply-To: ${message.inReplyTo}`,
      `References: ${message.inReplyTo}`,
    );
  }
  if (message.unsubscribeUrl) {
    const url = new URL(message.oneClickUrl || message.unsubscribeUrl);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Invalid unsubscribe URL");
    headers.push(`List-Unsubscribe: <${url.href}>`);
    if (message.oneClickUrl)
      headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  return (
    headers.join("\r\n") +
    "\r\n\r\n" +
    (
      Buffer.from(message.body)
        .toString("base64")
        .match(/.{1,76}/g) || []
    ).join("\r\n")
  );
}
