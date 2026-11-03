import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type PlatformLead } from "@prisma/client";
import { hash as passwordHash } from "bcryptjs";
import { controlDb, db, assertTenantDatabase } from "../src/lib/db";
import { withTenantDatabase } from "../src/lib/tenancy";
import { encrypt, hash, sign } from "../src/lib/security";
import { createOrganizationInTransaction } from "../src/platform/core";
import {
  sendCampaignMessage,
  sendApprovedReply,
} from "../src/platform/mail/send";
import { syncMailbox } from "../src/platform/mail/sync";
import { recordMailEvent } from "../src/platform/mail/events";
import { unsubscribeMessage } from "../src/platform/mail/feedback";
import {
  enqueueJob,
  dispatchOneJob,
  authenticateJob,
  jobToken,
} from "../src/platform/jobs";
import { processOneJob } from "../src/platform/worker";
import { reportData } from "../src/platform/analytics";

const suffix = randomUUID(),
  password = randomUUID() + randomUUID();
const workspaces: string[] = [],
  users: string[] = [];
const restricted = new PrismaClient({
  datasourceUrl: process.env.TENANT_DATABASE_URL,
});
const oldLive = process.env.LIVE_EMAIL_ENABLED,
  oldN8n = process.env.N8N_BASE_URL,
  oldKey = process.env.N8N_WEBHOOK_SECRET;
let checks = 0;
function pass(message: string) {
  checks++;
  console.log(`PASS ${message}`);
}
async function main() {
  await assertTenantDatabase();
  for (const name of ["A", "B"]) {
    const user = await controlDb.user.create({
      data: {
        email: `orbit-check-${name.toLowerCase()}-${suffix}@example.invalid`,
        name: `Integration ${name}`,
        passwordHash: await passwordHash(password, 12),
        emailVerifiedAt: new Date(),
      },
    });
    users.push(user.id);
    const organization = await controlDb.$transaction((tx) =>
      createOrganizationInTransaction(tx, user, {
        name: `Verification ${name}`,
        websiteUrl: "https://acme.com",
      }),
    );
    workspaces.push(organization.workspaceId);
  }
  const [a, b] = workspaces;
  const leads: PlatformLead[] = [];
  for (const workspaceId of workspaces) {
    leads.push(
      await controlDb.platformLead.create({
        data: {
          workspaceId,
          company: "Integration business",
          email: `prospect-${workspaceId}@example.invalid`,
          eligibility: "CONSENTED",
          consentSource:
            "Isolated integration fixture; no live network transport",
          consentAt: new Date(),
          verificationStatus: "VALID",
          verifiedAt: new Date(),
          qualificationScore: 90,
          qualificationCategory: "HOT",
          qualifiedAt: new Date(),
        },
      }),
    );
  }
  pass("new organizations get separate memberships and subscriptions");
  assert.equal(await restricted.platformLead.count(), 0);
  await restricted.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${b}, true)`;
    assert.equal(await tx.platformLead.count(), 0);
  });
  await assert.rejects(
    () =>
      restricted.$queryRaw`SELECT * FROM "TenantDatabaseCapability" LIMIT 1`,
  );
  await assert.rejects(
    () => restricted.$queryRaw`SELECT * FROM "Lead" LIMIT 1`,
  );
  await withTenantDatabase(a, async () => {
    assert.deepEqual(
      (await db.$queryRaw<{ id: string }[]>`SELECT id FROM "User"`).map(
        (user) => user.id,
      ),
      [users[0]],
    );
    assert.deepEqual(
      (await db.platformLead.findMany()).map((lead) => lead.id),
      [leads[0].id],
    );
    assert.equal(
      await db.platformLead.findUnique({ where: { id: leads[1].id } }),
      null,
    );
    await assert.rejects(() =>
      db.platformLead.create({
        data: { workspaceId: b, company: "Forbidden" },
      }),
    );
    await assert.rejects(() =>
      db.platformLead.update({
        where: { id: leads[1].id },
        data: { company: "Forbidden" },
      }),
    );
  });
  pass(
    "SQL without filters is tenant restricted; GUC spoofing, foreign writes and archived table reads fail",
  );
  const mailbox = await controlDb.platformMailbox.create({
    data: {
      workspaceId: a,
      email: "owner@acme.com",
      provider: "GMAIL",
      status: "LIVE_ENABLED",
      createdBy: users[0],
      lastSyncedAt: new Date(),
      minimumIntervalSeconds: 5,
      encryptedCredentials: encrypt(
        JSON.stringify({
          accessToken: "isolated-fixture-token",
          refreshToken: "isolated-fixture-refresh",
          expiresAt: Date.now() + 3600000,
        }),
      ),
    },
  });
  await controlDb.platformOrganization.update({
    where: { workspaceId: a },
    data: { profileApprovedAt: new Date(), profileApprovedBy: users[0] },
  });
  const campaign = await controlDb.platformCampaign.create({
    data: {
      workspaceId: a,
      name: "Integration campaign",
      mailboxId: mailbox.id,
      subject: "Hello",
      body: "A reviewed introduction",
      status: "RUNNING",
      approvedAt: new Date(),
      approvedBy: users[0],
      recipients: {
        create: {
          leadId: leads[0].id,
          subject: "Hello",
          body: "A reviewed introduction",
          approvedAt: new Date(),
          approvedBy: users[0],
        },
      },
    },
  });
  let sends = 0;
  const transport: typeof fetch = async (url) => {
    assert.equal(
      String(url),
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    sends++;
    assert.ok(
      await controlDb.platformMailMessage.count({
        where: { workspaceId: a, status: "SENDING" },
      }),
      "reservation must commit before provider call",
    );
    return Response.json({
      id: `fixture-send-${sends}`,
      threadId: "fixture-thread",
    });
  };
  process.env.LIVE_EMAIL_ENABLED = "false";
  await withTenantDatabase(a, () =>
    assert.rejects(
      () =>
        sendCampaignMessage(a, campaign.id, leads[0].id, 0, suffix, transport),
      /disabled/,
    ),
  );
  process.env.LIVE_EMAIL_ENABLED = "true";
  await withTenantDatabase(a, async () => {
    await db.platformLead.update({
      where: { id: leads[0].id },
      data: { eligibility: "UNKNOWN" },
    });
    await assert.rejects(
      () =>
        sendCampaignMessage(a, campaign.id, leads[0].id, 0, suffix, transport),
      /permission/,
    );
    await db.platformLead.update({
      where: { id: leads[0].id },
      data: { eligibility: "CONSENTED" },
    });
    await db.platformCampaignRecipient.updateMany({
      where: { campaignId: campaign.id },
      data: { approvedAt: null },
    });
    await assert.rejects(
      () =>
        sendCampaignMessage(a, campaign.id, leads[0].id, 0, suffix, transport),
      /approval/,
    );
    await db.platformCampaignRecipient.updateMany({
      where: { campaignId: campaign.id },
      data: { approvedAt: new Date() },
    });
    await assert.rejects(() =>
      sendCampaignMessage(a, campaign.id, leads[1].id, 0, suffix, transport),
    );
    const accepted = await sendCampaignMessage(
      a,
      campaign.id,
      leads[0].id,
      0,
      suffix,
      transport,
    );
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(
      (
        await sendCampaignMessage(
          a,
          campaign.id,
          leads[0].id,
          0,
          "different-job-key",
          transport,
        )
      ).duplicate,
      true,
    );
  });
  assert.equal(sends, 1);
  pass(
    "live flag, consent and approval gates hold; committed send reservations prevent duplicate sends",
  );
  const outbound = await controlDb.platformMailMessage.findFirstOrThrow({
    where: { workspaceId: a, direction: "OUTBOUND" },
  });
  const received = new Date(Date.now() + 1);
  const message = {
    id: "fixture-inbound",
    threadId: "fixture-thread",
    internalDate: String(received.getTime()),
    labelIds: ["INBOX"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: leads[0].email! },
        { name: "To", value: mailbox.email },
        { name: "Subject", value: "Re: Hello" },
        { name: "Message-ID", value: "<reply@example.invalid>" },
        { name: "In-Reply-To", value: outbound.rfcMessageId },
      ],
      body: {
        data: Buffer.from("Please send pricing information").toString(
          "base64url",
        ),
      },
    },
  };
  const syncTransport: typeof fetch = async (url) => {
    const value = String(url);
    if (value.includes("/messages/fixture-inbound"))
      return Response.json(message);
    if (value.includes("/messages?"))
      return Response.json({
        messages: [{ id: message.id, threadId: message.threadId }],
      });
    throw new Error("Unexpected fixture request");
  };
  await withTenantDatabase(a, async () => {
    await syncMailbox(a, mailbox.id, syncTransport);
    await syncMailbox(a, mailbox.id, syncTransport);
    assert.equal(
      await db.platformMailMessage.count({ where: { direction: "INBOUND" } }),
      1,
    );
    const lead = await db.platformLead.findUniqueOrThrow({
      where: { id: leads[0].id },
    });
    assert.ok(lead.repliedAt);
    assert.equal(
      (await db.platformCampaignRecipient.findFirstOrThrow()).status,
      "STOPPED",
    );
  });
  pass("mailbox sync records actual replies once and stops follow-ups");
  const incoming = await controlDb.platformMailMessage.findFirstOrThrow({
    where: { workspaceId: a, direction: "INBOUND" },
  });
  const subject = "Re: Hello",
    body = "We will review your request and follow up.",
    id = randomUUID();
  const reply = await controlDb.platformMailMessage.create({
    data: {
      id,
      workspaceId: a,
      mailboxId: mailbox.id,
      leadId: leads[0].id,
      direction: "OUTBOUND",
      status: "DRAFT",
      fromEmail: mailbox.email,
      toEmail: incoming.fromEmail,
      subject,
      body,
      dedupeKey: `reply:${id}`,
      rfcMessageId: `<${id}@acme.com>`,
      contentHash: hash(
        JSON.stringify({ subject, body, to: incoming.fromEmail }),
      ),
      replyToMessageId: incoming.id,
    },
  });
  await withTenantDatabase(a, async () => {
    await assert.rejects(
      () => sendApprovedReply(a, reply.id, transport),
      /Approve/,
    );
    await db.platformMailMessage.update({
      where: { id: reply.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedBy: users[0],
      },
    });
    await db.platformMailbox.update({
      where: { id: mailbox.id },
      data: { lastSentAt: null },
    });
    assert.equal(
      (await sendApprovedReply(a, reply.id, transport)).status,
      "ACCEPTED",
    );
    assert.equal(
      (await sendApprovedReply(a, reply.id, transport)).duplicate,
      true,
    );
  });
  assert.equal(sends, 2);
  pass("exact approved replies send once through a mocked provider");
  await withTenantDatabase(a, async () => {
    const subject = "Reviewed second reply",
      body = "A second reviewed response",
      id = randomUUID();
    const uncertain = await db.platformMailMessage.create({
      data: {
        id,
        workspaceId: a,
        mailboxId: mailbox.id,
        direction: "OUTBOUND",
        status: "APPROVED",
        fromEmail: mailbox.email,
        toEmail: incoming.fromEmail,
        subject,
        body,
        dedupeKey: `reply:${id}`,
        rfcMessageId: `<${id}@acme.com>`,
        contentHash: hash(
          JSON.stringify({ subject, body, to: incoming.fromEmail }),
        ),
        replyToMessageId: incoming.id,
        approvedAt: new Date(),
        approvedBy: users[0],
      },
    });
    await db.platformMailbox.update({
      where: { id: mailbox.id },
      data: { lastSentAt: null },
    });
    let attempts = 0;
    const timeoutTransport: typeof fetch = async () => {
      attempts++;
      throw new Error("Simulated uncertain network outcome");
    };
    await assert.rejects(
      () => sendApprovedReply(a, uncertain.id, timeoutTransport),
      /reconciliation/,
    );
    assert.equal(
      (await db.platformMailMessage.findUniqueOrThrow({ where: { id } }))
        .status,
      "REVIEW_REQUIRED",
    );
    await assert.rejects(
      () => sendApprovedReply(a, uncertain.id, timeoutTransport),
      /prior attempts cannot resend/,
    );
    assert.equal(attempts, 1);
  });
  pass(
    "uncertain network outcomes are retained for reconciliation and never automatically resend",
  );
  await withTenantDatabase(a, async () => {
    await assert.rejects(
      () =>
        recordMailEvent(a, mailbox.id, {
          messageId: outbound.id,
          externalId: "false-delivery",
          kind: "DELIVERED",
        }),
      /does not provide/,
    );
    const first = await recordMailEvent(a, mailbox.id, {
      messageId: outbound.id,
      externalId: "fixture-complaint",
      kind: "COMPLAINT",
    });
    assert.equal(first.duplicate, false);
    assert.equal(
      (
        await recordMailEvent(a, mailbox.id, {
          messageId: outbound.id,
          externalId: "fixture-complaint",
          kind: "COMPLAINT",
        })
      ).duplicate,
      true,
    );
    assert.equal(
      (
        await db.platformCampaign.findUniqueOrThrow({
          where: { id: campaign.id },
        })
      ).status,
      "PAUSED",
    );
    assert.equal(
      (await db.platformLead.findUniqueOrThrow({ where: { id: leads[0].id } }))
        .eligibility,
      "SUPPRESSED",
    );
  });
  await unsubscribeMessage(
    outbound.id,
    sign(`platform-unsubscribe:${outbound.id}`, process.env.NEXTAUTH_SECRET!),
  );
  pass(
    "provider acceptance never invents delivery; complaints pause campaigns and signed opt-outs suppress immediately",
  );
  process.env.N8N_BASE_URL = "http://localhost:5678";
  process.env.N8N_WEBHOOK_SECRET = "fixture-automation-secret-32-characters";
  const job = await withTenantDatabase(a, () =>
    enqueueJob(a, null, "REPORT", { period: "DAILY" }, `test:${suffix}`),
  );
  let admissions = 0;
  await withTenantDatabase(a, () =>
    dispatchOneJob(a, async () => {
      admissions++;
      return Response.json({ started: true });
    }),
  );
  assert.equal(admissions, 1);
  const claimed = await controlDb.platformJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  await assert.rejects(() =>
    authenticateJob(
      job.id,
      b,
      jobToken(claimed, process.env.N8N_WEBHOOK_SECRET!),
    ),
  );
  const valid = await authenticateJob(
    job.id,
    a,
    jobToken(claimed, process.env.N8N_WEBHOOK_SECRET!),
  );
  await controlDb.platformJob.update({
    where: { id: valid.id },
    data: { status: "READY", leaseUntil: null },
  });
  assert.equal(await processOneJob(a), true);
  const completedReport = await controlDb.platformJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(
    completedReport.status,
    "SUCCEEDED",
    completedReport.error || "Report job must complete",
  );
  await withTenantDatabase(a, async () => {
    const report = await reportData(a);
    assert.equal(report.metrics.emailsSent, 2);
    assert.equal(report.metrics.emailsDelivered, 0);
    assert.equal(report.metrics.replies, 1);
    assert.equal(report.metrics.complaints, 1);
    assert.equal(report.metrics.emailsOpened, null);
  });
  pass(
    "signed automation admission executes a durable report job and metrics match stored events",
  );
  const base = process.env.TEST_BASE_URL || "http://localhost:3100";
  const csrfResponse = await fetch(`${base}/api/auth/csrf`);
  const csrf = (await csrfResponse.json()) as { csrfToken: string };
  const cookie = csrfResponse.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const user = await controlDb.user.findUniqueOrThrow({
    where: { id: users[0] },
  });
  const login = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: base,
    },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: user.email,
      password,
      json: "true",
    }),
    redirect: "manual",
  });
  const session = login.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  assert.ok(
    session.includes("session-token"),
    "test login must create an authenticated session",
  );
  const headers = {
    Cookie: session,
    Origin: base,
    "Content-Type": "application/json",
  };
  for (const view of [
    "dashboard",
    "leads",
    "campaigns",
    "conversations",
    "results",
    "website",
    "updates",
  ]) {
    const response = await fetch(
      `${base}/api/platform/${a}/portal?view=${view}`,
      { headers },
    );
    assert.equal(
      response.status,
      200,
      `Client portal ${view}: ${await response.text()}`,
    );
  }
  for (const resource of [
    "business",
    "mailboxes",
    "automation",
    "settings",
    "billing",
    "team",
    "discovery",
    "templates",
    "leads",
    "campaigns",
    "inbox",
    "reports",
    "overview",
    "notifications",
  ]) {
    assert.equal(
      (await fetch(`${base}/api/platform/${a}/${resource}`, { headers }))
        .status,
      403,
      `Client cannot access raw ${resource}`,
    );
    const blockedWrite = await fetch(`${base}/api/platform/${a}/${resource}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "update" }),
    });
    assert.ok(
      [403, 405].includes(blockedWrite.status),
      `Client cannot mutate ${resource}: HTTP ${blockedWrite.status}`,
    );
  }
  assert.equal(
    (await fetch(`${base}/api/platform/${b}/portal`, { headers })).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/platform/admin`, { headers })).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/platform/admin/insights`, { headers })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/platform/organizations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Forbidden workspace" }),
      })
    ).status,
    403,
  );
  // Legacy role names must not restore the former client administration access.
  await controlDb.membership.update({
    where: { workspaceId_userId: { workspaceId: a, userId: user.id } },
    data: { role: "CLIENT_ADMIN" },
  });
  assert.equal(
    (await fetch(`${base}/api/platform/${a}/business`, { headers })).status,
    403,
  );
  pass(
    "client results work while operational reads, writes, cross-client data and legacy administrator roles remain blocked",
  );
  // Only this isolated fixture is elevated for the separate operator checks.
  await controlDb.user.update({
    where: { id: user.id },
    data: { agencyAdmin: true },
  });
  const importResult = await fetch(`${base}/api/platform/${a}/leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "import",
      items: [
        {
          company: "CSV permission check",
          email: "csv-fixture@example.invalid",
          eligibility: "CONSENTED",
          consentSource: "Untrusted CSV claim",
          consentAt: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(importResult.status, 200, await importResult.text());
  assert.equal(
    (
      await controlDb.platformLead.findFirstOrThrow({
        where: { workspaceId: a, email: "csv-fixture@example.invalid" },
      })
    ).eligibility,
    "UNKNOWN",
  );
  assert.equal(
    (await fetch(`${base}/api/platform/${a}/leads/${leads[1].id}`, { headers }))
      .status,
    404,
  );
  const oldDate = new Date(Date.now() - 400 * 86400000);
  const archived = await controlDb.platformLead.create({
    data: {
      workspaceId: a,
      company: "Retention fixture",
      name: "Private contact",
      notes: "Private notes",
      status: "ARCHIVED",
      eligibility: "SUPPRESSED",
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  });
  const otherArchived = await controlDb.platformLead.create({
    data: {
      workspaceId: b,
      company: "Other retention fixture",
      name: "Must remain private",
      status: "ARCHIVED",
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  });
  const retention = await fetch(`${base}/api/platform/${a}/settings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "redact-archived", confirmed: true }),
  });
  assert.equal(retention.status, 200, await retention.text());
  assert.equal(
    (
      await controlDb.platformLead.findUniqueOrThrow({
        where: { id: archived.id },
      })
    ).name,
    "",
  );
  assert.equal(
    (
      await controlDb.platformLead.findUniqueOrThrow({
        where: { id: otherArchived.id },
      })
    ).name,
    "Must remain private",
  );
  pass(
    "CSV import cannot establish consent; communication history and retention remain tenant restricted",
  );
  const created = await fetch(`${base}/api/platform/${a}/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      name: "HTTP checked",
      subject: "Hello {{company}}",
      body: "A real database write",
    }),
  });
  assert.equal(created.status, 200, await created.text());
  const blocked = await fetch(`${base}/api/platform/${a}/templates`, {
    method: "POST",
    headers: { ...headers, Origin: "https://evil.invalid" },
    body: JSON.stringify({
      action: "create",
      name: "Blocked",
      subject: "Hello",
      body: "No",
    }),
  });
  assert.equal(blocked.status, 403);
  for (const route of [
    "/dashboard",
    "/api/workspaces",
    "/api/automation",
    "/api/prospects",
  ])
    assert.equal((await fetch(base + route, { headers })).status, 404, route);
  for (const resource of [
    "overview",
    "business",
    "leads",
    "campaigns",
    "templates",
    "mailboxes",
    "inbox",
    "notifications",
    "team",
    "billing",
    "settings",
    "reports",
    "discovery",
    "automation",
  ]) {
    const response = await fetch(`${base}/api/platform/${a}/${resource}`, {
      headers,
    });
    assert.equal(response.status, 200, `${resource}: ${await response.text()}`);
  }
  pass(
    "operator HTTP resources work; CSRF and retired CRM routes remain blocked",
  );
  console.log(
    `${checks} integration groups passed. All email and automation network calls were mocked; no real outreach was sent.`,
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Only this run's new fixtures are removed. No pre-existing records are touched.
    for (const workspaceId of workspaces)
      await controlDb.workspace
        .delete({ where: { id: workspaceId } })
        .catch(() => {});
    for (const id of users)
      await controlDb.user.delete({ where: { id } }).catch(() => {});
    if (oldLive === undefined) delete process.env.LIVE_EMAIL_ENABLED;
    else process.env.LIVE_EMAIL_ENABLED = oldLive;
    if (oldN8n === undefined) delete process.env.N8N_BASE_URL;
    else process.env.N8N_BASE_URL = oldN8n;
    if (oldKey === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = oldKey;
    await restricted.$disconnect();
    await db.$disconnect();
  });
