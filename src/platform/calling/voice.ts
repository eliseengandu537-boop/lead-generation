import twilio from "twilio";
import { z } from "zod";
import { controlDb } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { decrypt, encrypt, hash } from "@/lib/security";
import { withTenantDatabase } from "@/lib/tenancy";
import { db } from "@/lib/db";
import { phoneNumber, providerCallUpdate, terminalCallStatuses } from "./rules";

const sid = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[a-fA-F0-9]{32}$`));
export const voiceConnectionInput = z
  .object({
    action: z.literal("connect-voice"),
    workspaceId: z.string().min(1),
    accountSid: sid("AC"),
    authToken: z.string().min(20).max(200),
    apiKeySid: sid("SK"),
    apiKeySecret: z.string().min(20).max(200),
    applicationSid: sid("AP"),
    fromNumber: z.string().transform(phoneNumber),
    ownershipConfirmed: z.literal(true),
  })
  .strict();
type Credentials = Pick<
  z.infer<typeof voiceConnectionInput>,
  "accountSid" | "authToken" | "apiKeySid" | "apiKeySecret" | "applicationSid"
>;
const publicOrigin = () =>
  new URL(process.env.NEXTAUTH_URL || "http://localhost:3100").origin;
export function voiceUrls(workspaceId: string) {
  const base = `${publicOrigin()}/api/voice/${encodeURIComponent(workspaceId)}`;
  return { outgoing: `${base}/outgoing`, status: `${base}/status` };
}
function identity(userId: string) {
  // Existing registered voice clients retain their provider identity.
  return "concrete_" + userId.replace(/[^a-zA-Z0-9_]/g, "");
}

export async function connectVoice(
  adminId: string,
  raw: unknown,
  request: typeof fetch = fetch,
) {
  const values = voiceConnectionInput.parse(raw);
  const business = await controlDb.platformOrganization.findFirst({
    where: {
      workspaceId: values.workspaceId,
      onboardingStatus: { not: "DEMO" },
      workspace: { status: "ACTIVE" },
    },
  });
  if (!business) throw new HttpError(404, "Choose an active business.");
  const urls = voiceUrls(values.workspaceId);
  if (!urls.outgoing.startsWith("https://"))
    throw new HttpError(
      400,
      "A public HTTPS app URL is required for browser calls.",
    );
  try {
    const headers = {
      Authorization:
        "Basic " +
        Buffer.from(`${values.accountSid}:${values.authToken}`).toString(
          "base64",
        ),
    };
    const [account, application] = await Promise.all([
      request(
        `https://api.twilio.com/2010-04-01/Accounts/${values.accountSid}.json`,
        { headers, redirect: "error", signal: AbortSignal.timeout(15000) },
      ),
      request(
        `https://api.twilio.com/2010-04-01/Accounts/${values.accountSid}/Applications/${values.applicationSid}.json`,
        { headers, redirect: "error", signal: AbortSignal.timeout(15000) },
      ),
    ]);
    if (!account.ok || !application.ok)
      throw new Error("Provider rejected configuration");
    const app = await application.json();
    if (app.voice_url !== urls.outgoing || app.voice_method !== "POST")
      throw new HttpError(
        400,
        "Set your TwiML application's Voice URL to the outgoing webhook shown here, using POST, before connecting.",
      );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "Twilio could not verify the account and voice application. Check the private connection settings.",
    );
  }
  const { accountSid, authToken, apiKeySid, apiKeySecret, applicationSid } =
    values;
  await controlDb.platformVoiceProvider.upsert({
    where: { businessId: values.workspaceId },
    create: {
      businessId: values.workspaceId,
      fromNumber: values.fromNumber,
      encryptedCredentials: encrypt(
        JSON.stringify({
          accountSid,
          authToken,
          apiKeySid,
          apiKeySecret,
          applicationSid,
        }),
      ),
      updatedBy: adminId,
    },
    update: {
      fromNumber: values.fromNumber,
      encryptedCredentials: encrypt(
        JSON.stringify({
          accountSid,
          authToken,
          apiKeySid,
          apiKeySecret,
          applicationSid,
        }),
      ),
      enabled: true,
      updatedBy: adminId,
    },
  });
  return {
    message:
      "Voice provider connected. Calls still require an authorised caller and an explicit dial action.",
    ready: true,
  };
}

export async function browserCallToken(
  workspaceId: string,
  callerId: string,
  callId: string,
) {
  const [provider, call, user, membership] = await Promise.all([
    controlDb.platformVoiceProvider.findUnique({
      where: { businessId: workspaceId },
    }),
    controlDb.platformCall.findFirst({
      where: {
        workspaceId,
        id: callId,
        callerId,
        status: "PREPARED",
        expiresAt: { gt: new Date() },
      },
    }),
    controlDb.user.findUnique({ where: { id: callerId } }),
    controlDb.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: callerId } },
    }),
  ]);
  if (
    !provider?.enabled ||
    !call ||
    !user ||
    user.disabledAt ||
    (!user.agencyAdmin &&
      (user.staffRole !== "CALLER" || membership?.role !== "CALLER"))
  )
    throw new HttpError(
      409,
      "This call preparation expired or calling access changed. Start a new call.",
    );
  const credentials = JSON.parse(
    decrypt(provider.encryptedCredentials),
  ) as Credentials;
  const token = new twilio.jwt.AccessToken(
    credentials.accountSid,
    credentials.apiKeySid,
    credentials.apiKeySecret,
    { identity: identity(callerId), ttl: 300 },
  );
  token.addGrant(
    new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: credentials.applicationSid,
      incomingAllow: false,
    }),
  );
  return token.toJwt();
}

async function verifiedWebhook(workspaceId: string, request: Request) {
  const provider = await controlDb.platformVoiceProvider.findUnique({
    where: { businessId: workspaceId },
  });
  if (!provider) throw new HttpError(403, "Unknown voice connection.");
  const text = await request.text();
  if (text.length > 20000)
    throw new HttpError(413, "Voice callback is too large.");
  const params = new URLSearchParams(text),
    fields: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(fields, key))
      throw new HttpError(400, "Duplicate voice callback field.");
    fields[key] = value;
  }
  const credentials = JSON.parse(
    decrypt(provider.encryptedCredentials),
  ) as Credentials;
  const address = new URL(request.url);
  const expectedUrl = publicOrigin() + address.pathname + address.search;
  if (
    !twilio.validateRequest(
      credentials.authToken,
      request.headers.get("x-twilio-signature") || "",
      expectedUrl,
      fields,
    ) ||
    fields.AccountSid !== credentials.accountSid
  )
    throw new HttpError(403, "Invalid voice callback signature.");
  return { provider, fields };
}

export async function outgoingCall(workspaceId: string, request: Request) {
  const { provider, fields } = await verifiedWebhook(workspaceId, request);
  if (!provider.enabled) throw new HttpError(403, "Voice calling is paused.");
  const { CallRecordId, CallNonce, CallSid, From } = z
    .object({
      CallRecordId: z.string().min(1).max(100),
      CallNonce: z.string().min(40).max(100),
      CallSid: sid("CA"),
      From: z.string().max(200),
    })
    .parse(fields);
  const destination = await withTenantDatabase(workspaceId, () =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const call = await tx.platformCall.findFirst({
        where: { workspaceId, id: CallRecordId, mode: "BROWSER" },
        include: { lead: true },
      });
      if (!call || From !== `client:${identity(call.callerId)}`)
        throw new HttpError(
          403,
          "The browser identity does not own this call.",
        );
      const [user, membership, workspace] = await Promise.all([
        controlDb.user.findUnique({ where: { id: call.callerId } }),
        tx.membership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: call.callerId } },
        }),
        tx.workspace.findUnique({ where: { id: workspaceId } }),
      ]);
      if (
        !user ||
        user.disabledAt ||
        workspace?.status !== "ACTIVE" ||
        (!user.agencyAdmin &&
          (user.staffRole !== "CALLER" || membership?.role !== "CALLER"))
      )
        throw new HttpError(403, "Caller access is no longer active.");
      if (call.providerParentSid && call.providerParentSid !== CallSid)
        throw new HttpError(409, "This dial request has already been used.");
      if (
        !call.providerParentSid &&
        (call.status !== "PREPARED" ||
          !call.expiresAt ||
          call.expiresAt <= new Date() ||
          !call.nonceHash ||
          call.nonceHash !== hash(CallNonce))
      )
        throw new HttpError(
          409,
          "This dial request expired or was already used.",
        );
      if (
        terminalCallStatuses.has(call.status) ||
        call.lead.doNotCall ||
        call.lead.unsubscribedAt ||
        call.lead.status === "ARCHIVED" ||
        (!user.agencyAdmin &&
          call.lead.ownerId &&
          call.lead.ownerId !== user.id) ||
        phoneNumber(call.lead.phone) !== call.toNumber
      )
        throw new HttpError(
          409,
          "The lead or call eligibility changed. Prepare a new call.",
        );
      if (
        await tx.platformCall.findFirst({
          where: {
            workspaceId,
            toNumber: call.toNumber,
            outcome: "DO_NOT_CALL",
          },
        })
      )
        throw new HttpError(409, "This number has opted out of calls.");
      if (!call.providerParentSid)
        await tx.platformCall.update({
          where: { id: call.id },
          data: {
            providerParentSid: CallSid,
            status: "INITIATED",
            startedAt: new Date(),
            nonceHash: null,
          },
        });
      return {
        toNumber: call.toNumber,
        fromNumber: call.fromNumber || provider.fromNumber,
        callId: call.id,
      };
    }),
  );
  const response = new twilio.twiml.VoiceResponse();
  response
    .dial({
      callerId: destination.fromNumber,
      timeout: 30,
      timeLimit: 1800,
      answerOnBridge: true,
    })
    .number(
      {
        statusCallback: `${voiceUrls(workspaceId).status}?callId=${encodeURIComponent(destination.callId)}`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      },
      destination.toNumber,
    );
  return response.toString();
}

export async function voiceStatus(workspaceId: string, request: Request) {
  const { fields } = await verifiedWebhook(workspaceId, request);
  const callId = z
    .string()
    .min(1)
    .max(100)
    .parse(new URL(request.url).searchParams.get("callId"));
  const parsed = z
    .object({
      CallSid: sid("CA"),
      ParentCallSid: sid("CA"),
      CallStatus: z.string().max(30),
      SequenceNumber: z.coerce.number().int().min(0),
      CallDuration: z.coerce.number().int().min(0).max(21600).optional(),
    })
    .parse(fields);
  return withTenantDatabase(workspaceId, () =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const call = await tx.platformCall.findFirst({
        where: {
          workspaceId,
          id: callId,
          providerParentSid: parsed.ParentCallSid,
          mode: "BROWSER",
        },
      });
      if (!call || (call.providerSid && call.providerSid !== parsed.CallSid))
        throw new HttpError(404, "Call leg not found.");
      const eventKey = `${parsed.CallSid}:${parsed.SequenceNumber}`;
      if (
        await tx.platformCallEvent.findUnique({
          where: { workspaceId_eventKey: { workspaceId, eventKey } },
        })
      )
        return { duplicate: true };
      await tx.platformCallEvent.create({
        data: {
          workspaceId,
          callId,
          eventKey,
          status: parsed.CallStatus,
          durationSeconds: parsed.CallDuration,
        },
      });
      const next = providerCallUpdate(
        call,
        parsed.CallStatus,
        parsed.SequenceNumber,
      );
      if (!next) return { ignored: true };
      await tx.platformCall.update({
        where: { id: callId },
        data: {
          status: next,
          providerSid: parsed.CallSid,
          lastSequence: parsed.SequenceNumber,
          ...(next === "IN_PROGRESS" && !call.answeredAt
            ? { answeredAt: new Date() }
            : {}),
          ...(terminalCallStatuses.has(next)
            ? {
                endedAt: new Date(),
                durationSeconds: parsed.CallDuration ?? null,
              }
            : {}),
        },
      });
      return { updated: true };
    }),
  );
}
