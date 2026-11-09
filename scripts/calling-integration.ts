import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash as passwordHash } from "bcryptjs";
import twilio from "twilio";
import { controlDb, db } from "../src/lib/db";
import { withTenantDatabase } from "../src/lib/tenancy";
import { encrypt } from "../src/lib/security";
import { createOrganizationInTransaction } from "../src/platform/core";
import { prospectingTick } from "../src/platform/calling/prospecting";
import { prospectCities } from "../src/platform/calling/prospect-options";
import { candidateFromPlace } from "../src/platform/calling/overture";

const suffix = randomUUID(),
  password = randomUUID() + "!9";
const base =
  process.env.TEST_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3201";
const users: string[] = [],
  workspaces: string[] = [];
let checks = 0;
function pass(message: string) {
  checks++;
  console.log(`PASS ${message}`);
}
async function login(email: string, secret = password) {
  const cookies = new Map<string, string>();
  const request = async (route: string, options: RequestInit = {}) => {
    const response = await fetch(base + route, {
      ...options,
      redirect: "manual",
      headers: {
        Origin: base,
        Cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...options.headers,
      },
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0],
        at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  const csrf = await (await request("/api/auth/csrf")).json();
  await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password: secret,
      json: "true",
      callbackUrl: base,
    }),
  });
  return request;
}
type Client = Awaited<ReturnType<typeof login>>;
async function post(
  client: Client,
  route: string,
  input: unknown,
  status = 200,
) {
  const response = await client(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    status,
    `${route}: ${result.error || "unexpected status"}`,
  );
  return result;
}
async function main() {
  assert.ok(
    ["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
    "Only the local test database is allowed.",
  );
  const createUser = async (
    name: string,
    agencyAdmin = false,
    staffRole: string | null = null,
  ) => {
    const user = await controlDb.user.create({
      data: {
        name,
        agencyAdmin,
        staffRole,
        email: `calling-${name.toLowerCase()}-${suffix}@example.invalid`,
        passwordHash: await passwordHash(password, 12),
      },
    });
    users.push(user.id);
    return user;
  };
  const owner = await createUser("Owner", true),
    caller = await createUser("Caller", false, "CALLER"),
    other = await createUser("Other", false, "CALLER"),
    client = await createUser("Client");
  const createBusiness = async (name: string) => {
    const business = await controlDb.$transaction((tx) =>
      createOrganizationInTransaction(tx, owner, {
        name,
        websiteUrl: "https://agency.example.invalid",
      }),
    );
    workspaces.push(business.workspaceId);
    return business;
  };
  const a = await createBusiness("Calling fixture A"),
    b = await createBusiness("Calling fixture B"),
    c = await createBusiness("Calling fixture C");
  for (const [workspaceId, userId, role] of [
    [a.workspaceId, caller.id, "CALLER"],
    [a.workspaceId, other.id, "CALLER"],
    [b.workspaceId, other.id, "CALLER"],
    [a.workspaceId, client.id, "CLIENT_VIEWER"],
  ])
    await controlDb.membership.create({ data: { workspaceId, userId, role } });
  const admin = await login(owner.email),
    employee = await login(caller.email),
    colleague = await login(other.email),
    customer = await login(client.email);
  const path = `/api/platform/${a.workspaceId}/caller`;
  const write = (
    input: Record<string, unknown>,
    status = 200,
    who = employee,
  ) =>
    post(
      who,
      path,
      { ...input, requestId: input.requestId || randomUUID() },
      status,
    );
  const firstSession = await (
    await employee("/api/platform/caller/session")
  ).json();
  assert.deepEqual(
    firstSession.businesses.map(
      (row: { workspaceId: string }) => row.workspaceId,
    ),
    [a.workspaceId],
  );
  assert.equal(
    (await employee(`/api/platform/${b.workspaceId}/caller`)).status,
    403,
  );
  assert.equal((await employee("/api/platform/admin/call-centre")).status, 403);
  assert.equal((await customer(path)).status, 403);
  assert.equal(
    (await employee(`/api/platform/${a.workspaceId}/leads`)).status,
    403,
  );
  assert.equal(firstSession.businesses[0].name, "Concrete");
  assert.ok(!JSON.stringify(firstSession).includes("agency.example.invalid"));
  const safeSession = await (await employee("/api/platform/session")).json();
  assert.ok(!JSON.stringify(safeSession).includes("agency.example.invalid"));
  for (const route of ["portal", "business", "mailboxes", "campaigns"])
    assert.equal(
      (await employee(`/api/platform/${a.workspaceId}/${route}`)).status,
      403,
    );
  assert.equal((await employee("/")).headers.get("location"), "/caller");
  pass(
    "Caller login redirects to its own dashboard; client, administration and unassigned-business operations are denied",
  );
  const idempotency = randomUUID();
  const lead = await write({
    action: "add-lead",
    company: "Real fixture workshop",
    phone: "0821234567",
    email: `prospect-${suffix}@example.invalid`,
    requestId: idempotency,
  });
  assert.equal(
    (
      await write({
        action: "add-lead",
        company: "Real fixture workshop",
        phone: "0821234567",
        email: `prospect-${suffix}@example.invalid`,
        requestId: idempotency,
      })
    ).id,
    lead.id,
  );
  await write(
    { action: "add-lead", company: "Altered replay", requestId: idempotency },
    409,
  );
  await write(
    { action: "edit-lead", id: lead.id, eligibility: "CONSENT" },
    400,
  );
  const foreignLead = await controlDb.platformLead.create({
    data: {
      workspaceId: a.workspaceId,
      company: "Colleague only",
      ownerId: other.id,
      phone: "0831234567",
    },
  });
  const outside = await controlDb.platformLead.create({
    data: {
      workspaceId: b.workspaceId,
      company: "Other business",
      phone: "0841234567",
    },
  });
  await write(
    { action: "edit-lead", id: foreignLead.id, company: "Steal" },
    404,
  );
  await write(
    { action: "prepare-call", leadId: outside.id, mode: "PHONE" },
    404,
  );
  const queueLead = await controlDb.platformLead.create({
    data: { workspaceId: a.workspaceId, company: "Unassigned" },
  });
  const claims = await Promise.all(
    [employee, colleague].map((who) =>
      who(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          id: queueLead.id,
          requestId: randomUUID(),
        }),
      }),
    ),
  );
  assert.deepEqual(
    claims.map((response) => response.status).sort(),
    [200, 404],
  );
  await write({
    action: "qualify",
    id: lead.id,
    qualification: "QUALIFIED",
    notes: "Prospect confirmed a need and a budget.",
  });
  const saved = await controlDb.platformLead.findUniqueOrThrow({
    where: { id: lead.id },
  });
  assert.equal(saved.ownerId, caller.id);
  assert.equal(saved.createdById, caller.id);
  assert.equal(saved.salesQualification, "QUALIFIED");
  assert.equal(saved.eligibility, "UNKNOWN");
  assert.equal(saved.verificationStatus, "UNKNOWN");
  assert.ok(
    !(await (await employee(path)).json()).leads.some(
      (row: { id: string }) => row.id === foreignLead.id,
    ),
  );
  pass(
    "Lead ownership, concurrent claiming and idempotency hold; qualification cannot grant email consent or verification",
  );
  const beforeCalls = await controlDb.platformCall.count({
    where: { workspaceId: a.workspaceId },
  });
  await write(
    { action: "prepare-call", leadId: lead.id, mode: "BROWSER" },
    409,
  );
  assert.equal(
    await controlDb.platformCall.count({
      where: { workspaceId: a.workspaceId },
    }),
    beforeCalls,
  );
  const phone = await write({
    action: "prepare-call",
    leadId: lead.id,
    mode: "PHONE",
  });
  assert.equal(phone.toNumber, "+27821234567");
  assert.ok(!phone.token);
  await write(
    {
      action: "call-outcome",
      id: phone.callId,
      outcome: "CONNECTED",
      notes: "Spoke to the prospect",
      durationSeconds: 999,
    },
    400,
  );
  await write({
    action: "call-outcome",
    id: phone.callId,
    outcome: "QUALIFIED",
    notes: "They requested a meeting",
    reportedDurationSeconds: 120,
  });
  const phoneRecord = await controlDb.platformCall.findUniqueOrThrow({
    where: { id: phone.callId },
  });
  assert.equal(phoneRecord.status, "MANUAL_LOGGED");
  assert.equal(phoneRecord.durationSeconds, null);
  assert.equal(phoneRecord.reportedDurationSeconds, 120);
  assert.equal(phoneRecord.providerSid, null);
  await write(
    { action: "call-outcome", id: phone.callId, outcome: "CONNECTED" },
    404,
    colleague,
  );
  pass(
    "Vodacom handoffs remain manual logs; unconfigured browser calls do not create records, and callers cannot forge provider durations",
  );
  const startAt = new Date(Date.now() + 2 * 86400000).toISOString(),
    endAt = new Date(Date.now() + 2 * 86400000 + 1800000).toISOString();
  const configuration = {
    action: "configure-prospecting",
    workspaceId: a.workspaceId,
    enabled: false,
    categories: ["Restaurants", "Beauty"],
    cities: [...prospectCities],
    dailyLimit: 3,
    maxQueue: 10,
    meetingHostId: owner.id,
    notifyAdminEmail: true,
  };
  await post(admin, "/api/platform/admin/call-centre", configuration);
  await post(admin, "/api/platform/admin/call-centre", {
    ...configuration,
    workspaceId: b.workspaceId,
  });
  const available = await (await employee(`${path}/availability`)).json();
  assert.ok(available.slots.length > 0);
  assert.equal(available.timezone, "Africa/Johannesburg");
  for (const slot of available.slots) {
    const local = new Date(new Date(slot.startAt).getTime() + 7200000);
    assert.ok(local.getUTCDay() > 0 && local.getUTCDay() < 6);
    assert.ok(local.getUTCHours() >= 9 && local.getUTCHours() < 17);
    assert.equal(
      new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime(),
      1800000,
    );
  }
  assert.ok(!JSON.stringify(available).includes(owner.email));
  const bookingInput = {
    action: "book",
    leadId: lead.id,
    callId: phone.callId,
    title: "Discovery appointment",
    startAt,
    endAt,
    customerAgreed: true,
    notes: "PRIVATE-INTERNAL-NOTES",
    requestId: randomUUID(),
  };
  const booking = await write(bookingInput);
  assert.equal((await write(bookingInput)).id, booking.id);
  assert.equal(
    await controlDb.platformNotice.count({
      where: { workspaceId: a.workspaceId, kind: "BOOKING_BOOKED" },
    }),
    1,
  );
  assert.equal(
    (await employee("/api/platform/admin/call-centre/notifications")).status,
    403,
  );
  const notices = await (
    await admin("/api/platform/admin/call-centre/notifications")
  ).json();
  const meetingNotice = notices.items.find(
    (row: { workspaceId: string }) => row.workspaceId === a.workspaceId,
  );
  assert.ok(meetingNotice && !meetingNotice.read);
  assert.ok(!JSON.stringify(meetingNotice).includes("PRIVATE-INTERNAL-NOTES"));
  await post(admin, "/api/platform/admin/call-centre/notifications", {
    id: meetingNotice.id,
  });
  assert.ok(
    (
      await (
        await admin("/api/platform/admin/call-centre/notifications")
      ).json()
    ).items.find((row: { id: string }) => row.id === meetingNotice.id).read,
  );
  await write({ ...bookingInput, customerAgreed: false }, 400);
  const secondBusinessBooking = await post(
    colleague,
    `/api/platform/${b.workspaceId}/caller`,
    {
      ...bookingInput,
      leadId: outside.id,
      callId: undefined,
      requestId: randomUUID(),
    },
    409,
  );
  assert.ok(
    !JSON.stringify(secondBusinessBooking).includes("Discovery appointment"),
  );
  const calendar = await employee(`${path}/bookings/${booking.id}/calendar`);
  assert.equal(calendar.status, 200);
  const ics = await calendar.text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok(!ics.includes("PRIVATE-INTERNAL-NOTES"));
  assert.equal(
    (await colleague(`${path}/bookings/${booking.id}/calendar`)).status,
    404,
  );
  await write({
    action: "update-booking",
    id: booking.id,
    version: 0,
    status: "COMPLETED",
  });
  await write(
    {
      action: "update-booking",
      id: booking.id,
      version: 0,
      status: "CANCELED",
    },
    409,
  );
  assert.equal(
    await controlDb.platformMailMessage.count({
      where: { workspaceId: a.workspaceId },
    }),
    0,
  );
  pass(
    "Bookings enforce customer agreement, host conflicts across businesses and revisions; private notes stay out of calendars and no email is sent",
  );
  const campaignRoute = `${path}/campaigns`,
    campaign = {
      action: "preview",
      name: "Caller outreach",
      subject: "Meeting with {{company}}",
      body: "Hello {{name}}",
      leadIds: [lead.id],
      dailyLimit: 5,
    };
  await post(employee, campaignRoute, campaign, 403);
  await post(
    admin,
    "/api/platform/admin/call-centre",
    {
      action: "assign-caller",
      userId: caller.id,
      assignments: [{ workspaceId: a.workspaceId, canSend: true }],
    },
    400,
  );
  // Even an older saved email grant cannot reopen the caller's admin workflows.
  await controlDb.membership.update({
    where: {
      workspaceId_userId: { workspaceId: a.workspaceId, userId: caller.id },
    },
    data: { callerCanSend: true },
  });
  await post(employee, campaignRoute, campaign, 403);
  await post(
    employee,
    campaignRoute,
    { ...campaign, leadIds: [foreignLead.id] },
    403,
  );
  await post(
    employee,
    campaignRoute,
    {
      ...campaign,
      action: "create-and-send",
      permissionConfirmed: true,
      previewHash: "unavailable",
      requestId: randomUUID(),
    },
    403,
  );
  assert.equal(
    await controlDb.platformCampaign.count({
      where: { workspaceId: a.workspaceId },
    }),
    0,
  );
  pass(
    "Caller accounts cannot access email campaigns, including accounts with an obsolete saved email grant",
  );
  const accountSid = "AC" + "a".repeat(32),
    authToken = "test-auth-" + randomUUID(),
    apiKeySid = "SK" + "b".repeat(32),
    applicationSid = "AP" + "c".repeat(32);
  await controlDb.platformVoiceProvider.create({
    data: {
      businessId: a.workspaceId,
      fromNumber: "+27871112222",
      encryptedCredentials: encrypt(
        JSON.stringify({
          accountSid,
          authToken,
          apiKeySid,
          apiKeySecret: randomUUID(),
          applicationSid,
        }),
      ),
      updatedBy: owner.id,
    },
  });
  const browser = await write({
    action: "prepare-call",
    leadId: lead.id,
    mode: "BROWSER",
  });
  const jwt = JSON.parse(
    Buffer.from(browser.token.split(".")[1], "base64url").toString("utf8"),
  );
  assert.equal(jwt.grants.voice.outgoing.application_sid, applicationSid);
  assert.ok(!jwt.grants.voice.incoming?.allow);
  assert.equal(jwt.exp - jwt.iat, 300);
  const parent = "CA" + "d".repeat(32),
    child = "CA" + "e".repeat(32);
  const outgoing = `/api/voice/${a.workspaceId}/outgoing`,
    status = `/api/voice/${a.workspaceId}/status?callId=${browser.callId}`;
  const fields = {
    AccountSid: accountSid,
    CallSid: parent,
    From: "client:concrete_" + caller.id.replace(/[^a-zA-Z0-9_]/g, ""),
    CallRecordId: browser.callId,
    CallNonce: browser.nonce,
    To: "+19005551234",
  };
  const webhook = (route: string, body: Record<string, string>, valid = true) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": valid
          ? twilio.getExpectedTwilioSignature(authToken, base + route, body)
          : "forged",
      },
      body: new URLSearchParams(body),
    });
  assert.equal((await webhook(outgoing, fields, false)).status, 403);
  const dial = await webhook(outgoing, fields);
  assert.equal(dial.status, 200);
  const xml = await dial.text();
  assert.ok(xml.includes("+27821234567"));
  assert.ok(!xml.includes("+19005551234"));
  assert.equal((await webhook(outgoing, fields)).status, 200);
  assert.equal(
    (await webhook(outgoing, { ...fields, CallSid: "CA" + "f".repeat(32) }))
      .status,
    409,
  );
  await write(
    { action: "call-outcome", id: browser.callId, outcome: "CONNECTED" },
    409,
  );
  const callback = (
    state: string,
    sequence: string,
    extra: Record<string, string> = {},
  ) =>
    webhook(status, {
      AccountSid: accountSid,
      CallSid: child,
      ParentCallSid: parent,
      CallStatus: state,
      SequenceNumber: sequence,
      ...extra,
    });
  assert.equal((await callback("ringing", "0")).status, 200);
  assert.equal((await callback("in-progress", "1")).status, 200);
  assert.equal(
    (await callback("completed", "3", { CallDuration: "90" })).status,
    200,
  );
  assert.equal(
    (await callback("completed", "3", { CallDuration: "90" })).status,
    200,
  );
  assert.equal((await callback("ringing", "2")).status, 200);
  const recorded = await controlDb.platformCall.findUniqueOrThrow({
    where: { id: browser.callId },
  });
  assert.equal(recorded.status, "COMPLETED");
  assert.equal(recorded.durationSeconds, 90);
  assert.equal(recorded.lastSequence, 3);
  assert.equal(
    await controlDb.platformCallEvent.count({
      where: { callId: browser.callId },
    }),
    4,
  );
  await write({
    action: "call-outcome",
    id: browser.callId,
    outcome: "CONNECTED",
    notes: "Provider-confirmed fixture",
  });
  const abandoned = await write({
    action: "prepare-call",
    leadId: lead.id,
    mode: "BROWSER",
  });
  await write({ action: "abandon-call", id: abandoned.callId });
  pass(
    "Signed voice callbacks bind identity, single-use nonce and stored phone; duplicates, arbitrary dial targets and out-of-order events cannot fabricate calls",
  );
  const report = await (
    await admin(`/api/platform/admin/call-centre?workspaceId=${a.workspaceId}`)
  ).json();
  const metric = report.callers.find(
    (row: { id: string }) => row.id === caller.id,
  );
  assert.equal(metric.phoneLogs, 1);
  assert.equal(metric.browserAttempts, 1);
  assert.equal(metric.browserConnected, 1);
  assert.equal(metric.leadsAdded, 1);
  assert.equal(metric.qualified, 1);
  assert.equal(metric.bookings, 1);
  assert.ok(!JSON.stringify(report).includes(authToken));
  assert.ok(
    !JSON.stringify(await (await employee(path)).json()).includes("nonceHash"),
  );
  const adminBusinesses = await (await admin("/api/platform/admin")).json();
  assert.ok(
    !adminBusinesses.organizations
      .find((row: { workspaceId: string }) => row.workspaceId === a.workspaceId)
      .clientLogins.some((row: { id: string }) => row.id === caller.id),
  );
  await withTenantDatabase(a.workspaceId, async () => {
    await assert.rejects(
      () =>
        db.$queryRaw`SELECT "encryptedCredentials" FROM "PlatformVoiceProvider"`,
    );
    await assert.rejects(
      () => db.$queryRaw`SELECT * FROM "PlatformProspectingConfig"`,
    );
    assert.equal(
      await db.platformProspectSearch.count({
        where: { workspaceId: b.workspaceId },
      }),
      0,
    );
  });
  await write({
    action: "call-outcome",
    id: phone.callId,
    outcome: "DO_NOT_CALL",
  });
  const duplicate = await controlDb.platformLead.create({
    data: {
      workspaceId: a.workspaceId,
      company: "Same number duplicate",
      phone: "+27 82 123 4567",
    },
  });
  await write(
    { action: "prepare-call", leadId: duplicate.id, mode: "PHONE" },
    409,
  );
  pass(
    "Administrator metrics count real provider attempts only; credentials are control-only, staff are separate from clients, and opt-outs block duplicate phone numbers",
  );
  await post(employee, `${path}/prospects`, { requestId: randomUUID() }, 409);
  await post(
    employee,
    "/api/platform/admin/call-centre",
    { ...configuration, enabled: true },
    403,
  );
  await post(admin, "/api/platform/admin/call-centre", {
    ...configuration,
    enabled: true,
    notifyAdminEmail: false,
  });
  const researchRequest = {
    requestId: randomUUID(),
    industry: "ALL",
    city: "Gauteng",
  };
  const research = await post(employee, `${path}/prospects`, researchRequest);
  assert.equal(
    (await post(employee, `${path}/prospects`, researchRequest)).search.id,
    research.search.id,
  );
  const makeCandidate = (
    id: string,
    phone: string,
    category = "beauty_salon",
  ) =>
    candidateFromPlace(
      {
        id,
        company: `Public fixture ${id}`,
        phone,
        category,
        confidence: 0.9,
        websites: null,
        addresses: [{ country: "ZA", region: "GP", locality: "Johannesburg" }],
        sources: [{ dataset: "synthetic local fixture" }],
        lon: 28.04,
        lat: -26.2,
      },
      "2026-10-21.0",
    )!;
  const candidates = [
    makeCandidate("first", "0812345678"),
    makeCandidate("second", "0812345679", "restaurant"),
    makeCandidate("repeat-phone", "0812345678"),
    makeCandidate("opted-out", "+27821234567"),
  ];
  await prospectingTick(async () => ({ checked: 4, candidates }));
  const imported = await controlDb.platformLead.findMany({
    where: { workspaceId: a.workspaceId, sourceKind: "OVERTURE" },
  });
  assert.equal(imported.length, 2);
  assert.ok(
    imported.every(
      (row) =>
        !row.ownerId &&
        row.eligibility === "UNKNOWN" &&
        row.verificationStatus === "UNKNOWN" &&
        row.websitePresence === "NO_WEBSITE_LISTED" &&
        row.websiteCheckedAt,
    ),
  );
  const readyWorkspace = await (await employee(path)).json();
  assert.equal(readyWorkspace.totals.ready, 2);
  assert.ok(!JSON.stringify(readyWorkspace).includes("agency.example.invalid"));
  assert.deepEqual(readyWorkspace.mailboxes, []);
  assert.deepEqual(readyWorkspace.campaigns, []);
  assert.equal(
    await controlDb.platformLead.count({
      where: { workspaceId: b.workspaceId, sourceKind: "OVERTURE" },
    }),
    0,
  );
  await controlDb.platformProspectSearch.create({
    data: {
      workspaceId: a.workspaceId,
      actorId: caller.id,
      idempotencyKey: `test-cap:${suffix}`,
    },
  });
  await prospectingTick(async () => ({
    checked: 3,
    candidates: [
      ...candidates,
      makeCandidate("third", "0812345680"),
      makeCandidate("fourth", "0812345681"),
    ],
  }));
  assert.equal(
    await controlDb.platformLead.count({
      where: { workspaceId: a.workspaceId, sourceKind: "OVERTURE" },
    }),
    3,
  );
  pass(
    "Automatic research creates real queued records, deduplicates phone/source IDs, respects opt-outs and daily caps, and does not grant email consent",
  );
  await controlDb.platformProspectingConfig.update({
    where: { businessId: a.workspaceId },
    data: { dailyLimit: 5 },
  });
  const revoked = await controlDb.platformProspectSearch.create({
    data: {
      workspaceId: a.workspaceId,
      actorId: caller.id,
      idempotencyKey: `test-revoked:${suffix}`,
    },
  });
  await prospectingTick(async () => {
    await controlDb.membership.delete({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: caller.id },
      },
    });
    return { checked: 1, candidates: [makeCandidate("revoked", "0812345682")] };
  });
  assert.equal(
    (
      await controlDb.platformProspectSearch.findUniqueOrThrow({
        where: { id: revoked.id },
      })
    ).status,
    "FAILED",
  );
  assert.equal(
    await controlDb.platformLead.count({
      where: { workspaceId: a.workspaceId, sourceRecordId: "OVERTURE:revoked" },
    }),
    0,
  );
  await controlDb.membership.create({
    data: { workspaceId: a.workspaceId, userId: caller.id, role: "CALLER" },
  });
  pass(
    "Changes to caller access during a research job prevent its results from being saved",
  );
  await post(admin, "/api/platform/admin/call-centre", {
    ...configuration,
    workspaceId: b.workspaceId,
    enabled: true,
    categories: ["ALL"],
    cities: ["South Africa"],
    notifyAdminEmail: false,
  });
  const nationwide = await post(
    colleague,
    `/api/platform/${b.workspaceId}/caller/prospects`,
    {
      industry: "Dentists",
      city: "Cape Town, Western Cape",
      requestId: randomUUID(),
    },
  );
  assert.equal(nationwide.search.industry, "Dentists");
  const capeDentist = candidateFromPlace(
    {
      id: "cape-dentist",
      company: "Dental fixture",
      phone: "0212345678",
      category: "dentist",
      confidence: 0.9,
      websites: null,
      addresses: [{ country: "ZA", region: "WC", locality: "Cape Town" }],
      sources: [],
      lon: 18.42,
      lat: -33.92,
    },
    "2026-10-21.0",
  )!;
  await prospectingTick(async (options) => {
    assert.equal(options.industry, "Dentists");
    assert.equal(options.city, "Cape Town, Western Cape");
    return {
      checked: 2,
      candidates: [capeDentist, makeCandidate("wrong-niche", "0812345688")],
    };
  });
  assert.equal(
    await controlDb.platformLead.count({
      where: {
        workspaceId: b.workspaceId,
        sourceRecordId: "OVERTURE:cape-dentist",
      },
    }),
    1,
  );
  assert.equal(
    await controlDb.platformLead.count({
      where: {
        workspaceId: b.workspaceId,
        sourceRecordId: "OVERTURE:wrong-niche",
      },
    }),
    0,
  );
  assert.equal(
    await controlDb.platformLead.count({
      where: {
        workspaceId: a.workspaceId,
        sourceRecordId: "OVERTURE:cape-dentist",
      },
    }),
    0,
  );
  pass(
    "Typed national searches accept new niches and non-Gauteng towns, import only matching source facts and retain business isolation",
  );
  await post(admin, "/api/platform/admin/call-centre", {
    ...configuration,
    workspaceId: b.workspaceId,
    enabled: true,
    categories: ["Plumbers", "Auto spares"],
    cities: ["South Africa"],
    dailyLimit: 115,
    dailyCallTarget: 100,
    requireMissingWebsite: false,
    maxQueue: 150,
    notifyAdminEmail: false,
  });
  const websiteProspect = candidateFromPlace(
    {
      id: "website-parts",
      company: "Public parts fixture",
      category: "auto_parts_store",
      phone: "0212345699",
      websites: ["https://example.invalid/"],
      confidence: 0.95,
      operatingStatus: "open",
      addresses: [{ country: "ZA", region: "WC", locality: "Cape Town" }],
      sources: [{ dataset: "synthetic local fixture" }],
      lon: 18.42,
      lat: -33.92,
    },
    "2026-10-21.0",
    { requireMissingWebsite: false },
  )!;
  await controlDb.platformProspectSearch.create({
    data: {
      workspaceId: b.workspaceId,
      idempotencyKey: `sales-websites:${suffix}`,
      actorId: other.id,
      city: "South Africa",
    },
  });
  await prospectingTick(async (options) => {
    assert.equal(options.requireMissingWebsite, false);
    return { checked: 2, candidates: [websiteProspect, capeDentist] };
  });
  const websiteLead = await controlDb.platformLead.findFirstOrThrow({
    where: {
      workspaceId: b.workspaceId,
      sourceRecordId: "OVERTURE:website-parts",
    },
  });
  assert.equal(websiteLead.websitePresence, "WEBSITE_LISTED");
  assert.equal(websiteLead.website, "https://example.invalid/");
  assert.equal(websiteLead.salesQualification, "UNREVIEWED");
  assert.equal(websiteLead.eligibility, "UNKNOWN");
  const salesQueue = await (
    await colleague(`/api/platform/${b.workspaceId}/caller`)
  ).json();
  assert.equal(salesQueue.totals.ready, 1);
  assert.equal(salesQueue.prospecting.dailyLimit, 115);
  assert.equal(salesQueue.prospecting.dailyCallTarget, 100);
  assert.equal(salesQueue.prospecting.requireMissingWebsite, false);
  assert.ok(
    salesQueue.leads.some(
      (row: { id: string; sourceRecordId: string }) =>
        row.id !== websiteLead.id &&
        row.sourceRecordId === "OVERTURE:cape-dentist",
    ),
  );
  pass(
    "Sales targets accept 115 leads and 100 calls, include listed websites without granting consent or qualification, and preserve earlier leads outside the ready niche",
  );
  const createdEmail = `calling-new-${suffix}@example.invalid`;
  const calendlyUrl = "https://calendly.com/tristandearaujo261/30min";
  await post(colleague, `/api/platform/${b.workspaceId}/caller`, {
    action: "edit-lead",
    id: websiteLead.id,
    name: "Fixture attendee",
    email: "attendee@example.invalid",
    requestId: randomUUID(),
  });
  const preserved = await controlDb.platformLead.findUniqueOrThrow({
    where: { id: websiteLead.id },
  });
  for (const key of [
    "company",
    "phone",
    "website",
    "industry",
    "location",
    "sourceUrl",
    "notes",
  ] as const)
    assert.equal(preserved[key], websiteLead[key], key);
  await post(admin, "/api/platform/admin/call-centre", {
    ...configuration,
    workspaceId: b.workspaceId,
    calendlyUrl,
  });
  const externalAvailability = await (
    await colleague(`/api/platform/${b.workspaceId}/caller/availability`)
  ).json();
  assert.equal(externalAvailability.provider, "CALENDLY");
  assert.equal(externalAvailability.schedulingUrl, calendlyUrl);
  assert.deepEqual(externalAvailability.slots, []);
  assert.notEqual(
    (await (await employee(`${path}/availability`)).json()).provider,
    "CALENDLY",
  );
  const bookingsBefore = await controlDb.platformBooking.count({
    where: { workspaceId: b.workspaceId },
  });
  await post(
    colleague,
    `/api/platform/${b.workspaceId}/caller`,
    {
      action: "book",
      leadId: websiteLead.id,
      title: "Must reserve in Calendly",
      startAt,
      endAt,
      timezone: "Africa/Johannesburg",
      customerAgreed: true,
      requestId: randomUUID(),
    },
    409,
  );
  assert.equal(
    await controlDb.platformBooking.count({
      where: { workspaceId: b.workspaceId },
    }),
    bookingsBefore,
  );
  await post(
    admin,
    "/api/platform/admin/call-centre",
    {
      ...configuration,
      workspaceId: b.workspaceId,
      calendlyUrl: "https://calendly.com.evil.invalid/user/30min",
    },
    400,
  );
  assert.equal(
    (
      await controlDb.platformProspectingConfig.findUniqueOrThrow({
        where: { businessId: b.workspaceId },
      })
    ).calendlyUrl,
    calendlyUrl,
  );
  pass(
    "Calendly is business-scoped, replaces internal slots and rejects local-only bookings without claiming an external reservation",
  );
  const provisioned = await post(admin, "/api/platform/admin/call-centre", {
    action: "create-caller",
    name: "Provisioned caller",
    email: createdEmail,
    assignments: [{ workspaceId: c.workspaceId, canSend: false }],
  });
  users.push(provisioned.caller.id);
  assert.ok(provisioned.login.password.length >= 16);
  const created = await login(createdEmail, provisioned.login.password);
  assert.equal(
    (await created(`/api/platform/${c.workspaceId}/caller`)).status,
    200,
  );
  const digest = (
    await controlDb.user.findUniqueOrThrow({ where: { email: createdEmail } })
  ).passwordHash;
  await post(
    admin,
    "/api/platform/admin/call-centre",
    {
      action: "create-caller",
      name: "Overwrite",
      email: createdEmail,
      assignments: [],
    },
    409,
  );
  assert.equal(
    (await controlDb.user.findUniqueOrThrow({ where: { email: createdEmail } }))
      .passwordHash,
    digest,
  );
  await post(admin, "/api/platform/admin/call-centre", {
    action: "caller-status",
    userId: caller.id,
    enabled: false,
  });
  assert.equal((await employee(path)).status, 401);
  pass(
    "Admin-generated caller credentials work; duplicate emails preserve passwords and suspension invalidates existing sessions",
  );
  console.log(
    JSON.stringify({
      callerIntegration: "passed",
      checkGroups: checks,
      realCallsPlaced: 0,
      emailsSent: 0,
    }),
  );
}
main()
  .catch((problem) => {
    console.error(
      problem instanceof assert.AssertionError
        ? problem.message
        : `Calling integration failed (${problem?.name || "Error"}, ${problem?.code || "no code"}) at ${
            String(problem?.stack || "")
              .split("\n")
              .find((line) => line.includes("calling-integration.ts:")) ||
            "setup"
          }; private settings suppressed.`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    const accounts = await controlDb.user.findMany({
      where: { id: { in: users } },
      select: { email: true },
    });
    await controlDb.identityEmail.deleteMany({
      where: { to: { in: accounts.map((row) => row.email) } },
    });
    for (const workspaceId of workspaces) {
      await controlDb.platformBooking.deleteMany({ where: { workspaceId } });
      await controlDb.workspace.delete({ where: { id: workspaceId } });
    }
    await controlDb.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    await controlDb.$disconnect();
  });
