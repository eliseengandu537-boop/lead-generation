import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt, hash, secret } from "@/lib/security";
import { HttpError } from "@/lib/auth";
import { senderMatchesWebsite } from "./domain";

// Delegated permissions for the signed-in business mailbox only. Mail.ReadWrite creates the draft
// that is then sent, so the sent copy can be found again by its immutable ID.
export const graphScopes = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];
const graph = "https://graph.microsoft.com/v1.0";

export function microsoftConfigured() {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET &&
    process.env.NEXTAUTH_URL,
  );
}
export function microsoftConfig() {
  if (!microsoftConfigured())
    throw new HttpError(
      503,
      "Microsoft 365 sign-in is not configured by the platform administrator",
    );
  const tenant = process.env.MICROSOFT_TENANT_ID || "organizations";
  if (!/^[a-z0-9.-]{1,100}$/i.test(tenant))
    throw new Error("Invalid MICROSOFT_TENANT_ID");
  const base = new URL(process.env.NEXTAUTH_URL!);
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:")
    throw new Error("Production OAuth requires HTTPS");
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`,
    redirectUri: new URL("/api/platform/oauth/microsoft/callback", base).href,
  };
}
/** Microsoft states are hashed with a provider prefix so they can never satisfy the Google callback. */
export const microsoftStateHash = (state: string) => hash(`microsoft:${state}`);

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number().positive(),
  scope: z.string().optional(),
});
const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
const credentials = (token: z.infer<typeof tokenSchema>, refreshToken: string) =>
  encrypt(
    JSON.stringify({
      accessToken: token.access_token,
      refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    }),
  );
export function grantedMailScopes(scope = "") {
  const granted = scope
    .split(" ")
    .map((item) => item.split("/").pop()!.toLowerCase());
  return ["mail.readwrite", "mail.send"].every((item) => granted.includes(item));
}

export async function beginMicrosoftConnection(
  workspaceId: string,
  userId: string,
  browser: string,
) {
  const config = microsoftConfig(),
    state = secret(),
    verifier = secret();
  await db.platformMailOAuthState.deleteMany({
    where: { workspaceId, expiresAt: { lt: new Date() } },
  });
  await db.platformMailOAuthState.create({
    data: {
      tokenHash: microsoftStateHash(state),
      workspaceId,
      userId,
      browserHash: hash(browser),
      encryptedVerifier: encrypt(verifier),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL(`${config.authority}/authorize`);
  for (const [key, value] of Object.entries({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: graphScopes.join(" "),
    prompt: "select_account",
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }))
    url.searchParams.set(key, value);
  return url.href;
}

async function tokenRequest(
  body: Record<string, string>,
  request: typeof fetch,
) {
  const config = microsoftConfig();
  return request(`${config.authority}/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: graphScopes.join(" "),
      ...body,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}

export async function finishMicrosoftConnection(
  workspaceId: string,
  userId: string,
  state: string,
  browser: string,
  code: string,
  request: typeof fetch = fetch,
) {
  const pending = await db.platformMailOAuthState.findFirst({
    where: {
      tokenHash: microsoftStateHash(state),
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
  const response = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: microsoftConfig().redirectUri,
      code_verifier: decrypt(pending.encryptedVerifier),
    },
    request,
  );
  if (!response.ok)
    throw new HttpError(
      400,
      "Microsoft authorization failed; reconnect the email account. Your Microsoft 365 administrator may need to approve the app.",
    );
  const token = tokenSchema.parse(await response.json());
  if (!token.refresh_token || !grantedMailScopes(token.scope))
    throw new HttpError(
      400,
      "Grant Monettic permission to read, draft and send mail for this mailbox",
    );
  const profile = z
    .object({
      mail: z.string().nullable().optional(),
      userPrincipalName: z.string().optional(),
    })
    .parse(
      await graphJson(
        token.access_token,
        "/me?$select=mail,userPrincipalName",
        {},
        request,
      ),
    );
  const email = z
    .email()
    .safeParse((profile.mail || profile.userPrincipalName || "").toLowerCase());
  if (!email.success)
    throw new HttpError(400, "This Microsoft account has no business mailbox");
  const organization = await db.platformOrganization.findUniqueOrThrow({
    where: { workspaceId },
  });
  if (!senderMatchesWebsite(email.data, [organization.websiteUrl]))
    throw new HttpError(
      400,
      "Connect the business email for this client's website domain",
    );
  const encryptedCredentials = credentials(token, token.refresh_token);
  return db.platformMailbox.upsert({
    where: { workspaceId_email: { workspaceId, email: email.data } },
    create: {
      workspaceId,
      email: email.data,
      provider: "MICROSOFT",
      encryptedCredentials,
      createdBy: userId,
    },
    update: {
      provider: "MICROSOFT",
      encryptedCredentials,
      status: "CONNECTED",
      syncError: null,
      lastSyncedAt: null,
    },
  });
}

export async function microsoftToken(
  workspaceId: string,
  mailboxId: string,
  request: typeof fetch = fetch,
) {
  const mailbox = await db.platformMailbox.findFirst({
    where: {
      id: mailboxId,
      workspaceId,
      provider: "MICROSOFT",
      status: { in: ["CONNECTED", "LIVE_ENABLED"] },
    },
  });
  if (!mailbox)
    throw new Error("Email account is disconnected or requires authorization");
  const saved = credentialsSchema.parse(
    JSON.parse(decrypt(mailbox.encryptedCredentials)),
  );
  if (saved.expiresAt > Date.now() + 60000) return saved.accessToken;
  const response = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: saved.refreshToken },
    request,
  );
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status))
      await db.platformMailbox.update({
        where: { id: mailboxId },
        data: {
          status: "RECONNECT_REQUIRED",
          syncError: "Microsoft 365 authorization expired or was revoked",
        },
      });
    throw new Error(
      "Unable to refresh Microsoft 365 authorization; reconnect if access was revoked",
    );
  }
  const next = tokenSchema.parse(await response.json());
  // Microsoft rotates refresh tokens; keep the newest one.
  await db.platformMailbox.update({
    where: { id: mailboxId },
    data: {
      encryptedCredentials: credentials(
        next,
        next.refresh_token || saved.refreshToken,
      ),
    },
  });
  return next.access_token;
}

export class GraphError extends Error {
  constructor(public status: number) {
    super(`Microsoft Graph returned HTTP ${status}`);
  }
}
async function graphRequest(
  token: string,
  path: string,
  init: RequestInit & { text?: boolean },
  request: typeof fetch,
) {
  const { text, ...options } = init;
  const response = await request(`${graph}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: `IdType="ImmutableId"${text ? ', outlook.body-content-type="text"' : ""}`,
      ...options.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new GraphError(response.status);
  return response;
}
export async function graphJson(
  token: string,
  path: string,
  init: RequestInit & { text?: boolean },
  request: typeof fetch,
) {
  return (await graphRequest(token, path, init, request)).json();
}

const sentSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  internetMessageId: z.string().optional(),
  isDraft: z.boolean().optional(),
});
/** Saves the exact MIME message as a draft. Nothing is sent until sendGraphDraft. */
export async function createGraphDraft(
  token: string,
  mime: string,
  request: typeof fetch = fetch,
) {
  return sentSchema.parse(
    await graphJson(
      token,
      "/me/messages",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: Buffer.from(mime).toString("base64"),
      },
      request,
    ),
  );
}
export async function sendGraphDraft(
  token: string,
  id: string,
  request: typeof fetch = fetch,
) {
  await graphRequest(
    token,
    `/me/messages/${encodeURIComponent(id)}/send`,
    { method: "POST", body: "" },
    request,
  );
}
/** The sent copy for a draft created with an immutable ID, or null when it was never sent. */
export async function graphSentCopy(
  token: string,
  id: string,
  request: typeof fetch = fetch,
) {
  try {
    const message = sentSchema.parse(
      await graphJson(
        token,
        `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,internetMessageId,isDraft`,
        {},
        request,
      ),
    );
    return message.isDraft ? null : message;
  } catch (error) {
    if (error instanceof GraphError && error.status === 404) return null;
    throw error;
  }
}

export const graphMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional(),
  internetMessageId: z.string().optional(),
  isDraft: z.boolean().optional(),
  receivedDateTime: z.string(),
  subject: z.string().nullable().optional(),
  from: z
    .object({ emailAddress: z.object({ address: z.string().optional() }) })
    .nullable()
    .optional(),
  body: z.object({ content: z.string().optional() }).nullable().optional(),
  internetMessageHeaders: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .nullable()
    .optional(),
  singleValueExtendedProperties: z
    .array(z.object({ id: z.string(), value: z.string().nullable() }))
    .nullable()
    .optional(),
});
export type GraphMessage = z.infer<typeof graphMessageSchema>;
const messageClass = "String 0x001A";
/** Message IDs received after `after`, oldest first, following Graph's paging links. */
export async function graphMessageIds(
  token: string,
  after: Date,
  request: typeof fetch = fetch,
  pageLimit = 10,
) {
  const ids: string[] = [];
  let next: string | undefined =
    `/me/messages?$filter=receivedDateTime ge ${after.toISOString()}&$orderby=receivedDateTime asc&$select=id&$top=100`;
  for (let page = 0; page < pageLimit && next; page++) {
    const result = z
      .object({
        value: z.array(z.object({ id: z.string() })),
        "@odata.nextLink": z.string().optional(),
      })
      .parse(await graphJson(token, next, {}, request));
    ids.push(...result.value.map((item) => item.id));
    next = result["@odata.nextLink"]?.replace(graph, "");
  }
  return { ids, complete: !next };
}
export async function graphMessage(
  token: string,
  id: string,
  request: typeof fetch = fetch,
) {
  return graphMessageSchema.parse(
    await graphJson(
      token,
      `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,internetMessageId,isDraft,receivedDateTime,subject,from,body,internetMessageHeaders&$expand=singleValueExtendedProperties($filter=id eq '${messageClass}')`,
      { text: true },
      request,
    ),
  );
}
export function graphHeader(message: GraphMessage, name: string) {
  return (
    message.internetMessageHeaders?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}
/** Exchange non-delivery reports are REPORT.IPM.Note.NDR items; 4.x.x codes are temporary. */
export function graphDeliveryFailure(message: GraphMessage) {
  const kind =
    message.singleValueExtendedProperties?.find(
      (property) => property.id.toLowerCase() === messageClass.toLowerCase(),
    )?.value || "";
  if (!/^REPORT\..*\.NDR$/i.test(kind)) return null;
  const code = /\b([45])\.\d{1,3}\.\d{1,3}\b/.exec(message.body?.content || "");
  return {
    kind: code?.[1] === "4" ? ("SOFT_BOUNCE" as const) : ("BOUNCE" as const),
    detail: code ? `Exchange non-delivery report ${code[0]}` : "Exchange non-delivery report",
  };
}
