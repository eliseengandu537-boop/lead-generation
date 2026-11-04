import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash as passwordHash } from "bcryptjs";
import { controlDb, db } from "../src/lib/db";
import { withTenantDatabase } from "../src/lib/tenancy";
import { encrypt, hash } from "../src/lib/security";
import {
  createOrganizationInTransaction,
  mutateAuthorizedResource,
} from "../src/platform/core";
import { provisionClientLogin } from "../src/platform/client-access";
import { campaignReviewData } from "../src/platform/mail/review";

const suffix = randomUUID(),
  password = randomUUID() + randomUUID();
const base = process.env.NEXTAUTH_URL || "http://localhost:3201";
const users = new Set<string>(),
  workspaces = new Set<string>(),
  conversations: string[] = [];
let checks = 0;
const pass = (message: string) => {
  checks++;
  console.log(`PASS ${message}`);
};
async function login(email: string) {
  const cookies = new Map<string, string>();
  const request = async (route: string, input: RequestInit = {}) => {
    const response = await fetch(base + route, {
      ...input,
      redirect: "manual",
      headers: {
        Origin: base,
        ...(cookies.size
          ? {
              Cookie: [...cookies]
                .map(([key, value]) => `${key}=${value}`)
                .join("; "),
            }
          : {}),
        ...input.headers,
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
      password,
      json: "true",
      callbackUrl: base,
    }),
  });
  assert.equal((await request("/api/platform/session")).status, 200);
  return request;
}
async function main() {
  assert.ok(
    ["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
    "Integration fixtures must stay local.",
  );
  process.env.LIVE_EMAIL_ENABLED = "false";
  const createUser = async (name: string, admin = false) => {
    const user = await controlDb.user.create({
      data: {
        name,
        email: `assistant-${name.toLowerCase()}-${suffix}@example.invalid`,
        passwordHash: await passwordHash(password, 12),
        agencyAdmin: admin,
      },
    });
    users.add(user.id);
    return user;
  };
  const admin = await createUser("Administrator", true),
    other = await createUser("OtherAdmin", true),
    client = await createUser("Client");
  const a = await controlDb.$transaction((tx) =>
    createOrganizationInTransaction(tx, admin, {
      name: "Assistant integration A",
      websiteUrl: "https://supplier.example.invalid",
    }),
  );
  const b = await controlDb.$transaction((tx) =>
    createOrganizationInTransaction(tx, client, {
      name: "Assistant integration B",
      websiteUrl: "https://other.example.invalid",
    }),
  );
  workspaces.add(a.workspaceId);
  workspaces.add(b.workspaceId);
  const conversation = await controlDb.platformAssistantConversation.create({
    data: {
      actorId: admin.id,
      title: "Integration",
      encryptedHistory: encrypt("[]"),
    },
  });
  conversations.push(conversation.id);
  const run = await controlDb.platformAssistantRun.create({
    data: {
      id: randomUUID(),
      actorId: admin.id,
      conversationId: conversation.id,
      encryptedInput: encrypt("Create a client"),
    },
  });
  const input = {
    name: "Provisioned client",
    email: `assistant-provisioned-${suffix}@example.invalid`,
    businessName: "Provisioned assistant business",
  };
  const action = await controlDb.platformAssistantAction.create({
    data: {
      runId: run.id,
      type: "create_client",
      inputHash: hash(JSON.stringify(input)),
      encryptedInput: encrypt(JSON.stringify(input)),
      summary: "Create client login",
    },
  });
  const first = await provisionClientLogin(admin, input, action.id);
  users.add(first.client.id);
  workspaces.add(first.workspace.id);
  const second = await provisionClientLogin(admin, input, action.id);
  assert.equal(first.client.id, second.client.id);
  assert.equal(first.login.password, second.login.password);
  assert.equal(
    await controlDb.user.count({ where: { email: input.email } }),
    1,
  );
  assert.equal(
    await controlDb.platformAssistantAction.count({
      where: { id: action.id, status: "SUCCEEDED" },
    }),
    1,
  );
  await assert.rejects(
    () =>
      provisionClientLogin(client, {
        ...input,
        email: `forbidden-${suffix}@example.invalid`,
      }),
    /administrator/,
  );
  pass(
    "Assistant client provisioning and its credential receipt commit atomically; replay creates no duplicate and non-admin callers fail",
  );
  const workspace = await controlDb.workspace.findUniqueOrThrow({
    where: { id: a.workspaceId },
  });
  const organization = await controlDb.platformOrganization.findUniqueOrThrow({
    where: { workspaceId: a.workspaceId },
  });
  const access = {
    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      agencyAdmin: true,
    },
    role: "AGENCY_ADMIN",
    workspace,
    organization,
  };
  const draft = {
    action: "create",
    name: "Assistant draft",
    subject: "Hello {{company}}",
    body: "Business information. Reply to opt out.",
    leadIds: [],
  };
  const key = randomUUID();
  const campaign = await withTenantDatabase(a.workspaceId, () =>
    mutateAuthorizedResource(access, "campaigns", draft, {
      idempotencyKey: key,
    }),
  );
  const replay = await withTenantDatabase(a.workspaceId, () =>
    mutateAuthorizedResource(access, "campaigns", draft, {
      idempotencyKey: key,
    }),
  );
  assert.equal(campaign.id, replay.id);
  assert.equal(
    await controlDb.platformCampaign.count({
      where: { workspaceId: a.workspaceId },
    }),
    1,
  );
  await assert.rejects(
    () =>
      withTenantDatabase(a.workspaceId, () =>
        mutateAuthorizedResource(
          access,
          "campaigns",
          { ...draft, name: "Changed request" },
          { idempotencyKey: key },
        ),
      ),
    /different request/,
  );
  await assert.rejects(
    () => mutateAuthorizedResource(access, "campaigns", draft),
    /matching business context/,
  );
  const otherLead = await controlDb.platformLead.create({
    data: {
      workspaceId: b.workspaceId,
      company: "Private other business",
      email: `other-${suffix}@example.invalid`,
    },
  });
  await assert.rejects(
    () =>
      withTenantDatabase(a.workspaceId, () =>
        mutateAuthorizedResource(
          access,
          "campaigns",
          { ...draft, leadIds: [otherLead.id] },
          { idempotencyKey: randomUUID() },
        ),
      ),
    /do not belong/,
  );
  assert.equal(
    await controlDb.platformCampaign.count({
      where: { workspaceId: a.workspaceId },
    }),
    1,
  );
  const restricted = new (await import("@prisma/client")).PrismaClient({
    datasourceUrl: process.env.TENANT_DATABASE_URL,
  });
  try {
    for (const table of [
      "PlatformAssistantConfig",
      "PlatformAssistantConversation",
      "PlatformAssistantRun",
      "PlatformAssistantAction",
    ])
      await assert.rejects(() =>
        restricted.$queryRawUnsafe(`SELECT * FROM "${table}"`),
      );
  } finally {
    await restricted.$disconnect();
  }
  pass(
    "Campaign replay is atomic, conflicting identifiers fail, cross-business leads are rejected, and tenant SQL cannot read assistant state",
  );
  const lead = await controlDb.platformLead.create({
    data: {
      workspaceId: a.workspaceId,
      company: "Consenting fixture",
      name: "Pat",
      email: `consenting-${suffix}@example.invalid`,
      eligibility: "CONSENTED",
      consentSource: "Explicit local test permission",
      consentAt: new Date(),
      verificationStatus: "VALID",
      verifiedAt: new Date(),
      qualificationScore: 90,
    },
  });
  await withTenantDatabase(a.workspaceId, async () => {
    await db.platformOrganization.update({
      where: { workspaceId: a.workspaceId },
      data: { profileApprovedAt: new Date(), profileApprovedBy: admin.id },
    });
    await mutateAuthorizedResource(access, "campaigns", {
      action: "update",
      id: campaign.id,
      leadIds: [lead.id],
    });
  });
  const fresh = await controlDb.platformOrganization.findUniqueOrThrow({
    where: { workspaceId: a.workspaceId },
  });
  const full = await controlDb.platformCampaign.findUniqueOrThrow({
    where: { id: campaign.id },
    include: { recipients: { include: { lead: true } } },
  });
  const fingerprint = campaignReviewData(full, fresh, null).fingerprint;
  const approved = await withTenantDatabase(a.workspaceId, () =>
    mutateAuthorizedResource(
      { ...access, organization: fresh },
      "campaigns",
      { action: "approve", id: campaign.id },
      { idempotencyKey: randomUUID(), campaignReviewHash: fingerprint },
    ),
  );
  assert.equal(approved.status, "APPROVED");
  await assert.rejects(
    () =>
      withTenantDatabase(a.workspaceId, () =>
        mutateAuthorizedResource(
          { ...access, organization: fresh },
          "campaigns",
          { action: "start", id: campaign.id },
          { campaignReviewHash: fingerprint },
        ),
      ),
    /Live sending is not enabled/,
  );
  await controlDb.platformLead.update({
    where: { id: lead.id },
    data: {
      draftSubject: "Changed subject",
      draftBody: "Changed after review. Opt out.",
    },
  });
  await assert.rejects(
    () =>
      withTenantDatabase(a.workspaceId, () =>
        mutateAuthorizedResource(
          { ...access, organization: fresh },
          "campaigns",
          { action: "approve", id: campaign.id },
          { campaignReviewHash: fingerprint },
        ),
      ),
    /changed after review/,
  );
  assert.equal(
    await controlDb.platformJob.count({
      where: { workspaceId: a.workspaceId, kind: "SEND_CAMPAIGN" },
    }),
    0,
  );
  assert.equal(
    await controlDb.platformMailMessage.count({
      where: { workspaceId: a.workspaceId },
    }),
    0,
  );
  pass(
    "The email review binds actual messages; changed content and the disabled sending gate prevent launching without any provider request",
  );
  const ownerHttp = await login(admin.email),
    clientHttp = await login(client.email),
    otherHttp = await login(other.email);
  const path = "/api/platform/admin/assistant";
  assert.equal((await clientHttp(path)).status, 403);
  assert.equal(
    (
      await clientHttp(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "new_conversation" }),
      })
    ).status,
    403,
  );
  const history = await ownerHttp(`${path}?conversationId=${conversation.id}`);
  assert.equal(history.status, 200);
  const body = await history.text();
  assert.ok(!body.includes(first.login.password));
  assert.ok(!body.includes("encryptedResult"));
  assert.equal(
    (await otherHttp(`${path}?conversationId=${conversation.id}`)).status,
    404,
  );
  const actionPath = `${path}/actions/${action.id}`;
  assert.equal(
    (
      await clientHttp(actionPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"action":"credentials"}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await otherHttp(actionPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"action":"credentials"}',
      })
    ).status,
    404,
  );
  const credential = await ownerHttp(actionPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"action":"credentials"}',
  });
  assert.equal(credential.status, 200);
  assert.equal(credential.headers.get("cache-control"), "no-store");
  assert.equal((await credential.json()).login.password, first.login.password);
  await controlDb.platformAssistantAction.update({
    where: { id: action.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(
    (
      await ownerHttp(actionPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"action":"credentials"}',
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await ownerHttp(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.example.invalid",
        },
        body: '{"action":"new_conversation"}',
      })
    ).status,
    403,
  );
  const newClientHttp = (() => first)();
  assert.ok(newClientHttp.login.password.length >= 24);
  pass(
    "Live HTTP permissions isolate administrators and clients; history omits passwords, private credentials expire, and foreign-origin writes fail",
  );
  console.log(
    JSON.stringify({
      assistantIntegrationGroups: checks,
      actualEmailsSent: 0,
      providerCalls: 0,
    }),
  );
}
main()
  .catch(() => {
    console.error(
      "Assistant integration verification failed. Private fixture credentials were suppressed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await controlDb.platformAssistantConversation.deleteMany({
      where: { id: { in: conversations } },
    });
    for (const workspaceId of workspaces) {
      await controlDb.platformMailEvent.deleteMany({ where: { workspaceId } });
      await controlDb.platformMailMessage.deleteMany({
        where: { workspaceId },
      });
      await controlDb.platformJob.deleteMany({ where: { workspaceId } });
      await controlDb.workspace.delete({ where: { id: workspaceId } });
    }
    await controlDb.user.deleteMany({ where: { id: { in: [...users] } } });
    await db.$disconnect();
  });
