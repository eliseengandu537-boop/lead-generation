// End-to-end check of the POPIA permission request, Microsoft 365 sending and mailbox rotation against the LOCAL
// database. Microsoft Graph is simulated; no request leaves this process and no email is sent.
// It creates one temporary workspace and removes everything it created, even on failure.
import fs from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const local = parseEnv(fs.readFileSync(".env", "utf8"));
for (const key of ["DATABASE_URL", "TENANT_DATABASE_URL"] as const)
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(local[key]!).hostname),
    `${key} must point at the local database.`,
  );
Object.assign(process.env, {
  DATABASE_URL: local.DATABASE_URL,
  CONTROL_DATABASE_URL: local.DATABASE_URL,
  TENANT_DATABASE_URL: local.TENANT_DATABASE_URL,
  ENCRYPTION_KEY: local.ENCRYPTION_KEY || randomBytes(32).toString("hex"),
  ...(local.PLATFORM_ENCRYPTION_SEED
    ? { PLATFORM_ENCRYPTION_SEED: local.PLATFORM_ENCRYPTION_SEED }
    : {}),
  NEXTAUTH_URL: "http://localhost:3999",
  NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
  LIVE_EMAIL_ENABLED: "true",
  NODE_ENV: "test",
});

async function main() {
  const { controlDb: db, assertTenantDatabase } = await import("../src/lib/db");
  const { encrypt } = await import("../src/lib/security");
  const { withTenantDatabase } = await import("../src/lib/tenancy");
  const { sendCampaignMessage, syncMailbox } = await import("../src/platform/mail");
  const { leadSendBlocker } = await import("../src/platform/core");
  const { withPermissionNotice } = await import("../src/platform/mail/permission");
  await assertTenantDatabase();

  const suffix = randomUUID().replaceAll("-", "");
  const workspaceId = `outreach-check-${suffix}`;
  const planId = `OUTREACH_CHECK_${suffix}`;
  const domain = `parts-${suffix.slice(0, 8)}.example.invalid`;
  let userId: string | undefined;
  let created = false;
  const step = (name: string) => console.log(JSON.stringify({ check: name, ok: true }));

  // Simulated Microsoft Graph. Anything unexpected fails the run instead of reaching the network.
  const drafts: { id: string; mime: string }[] = [];
  let inbox: Record<string, unknown>[] = [];
  const graph = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const prefer = new Headers(init?.headers).get("Prefer") || "";
    assert.match(prefer, /IdType="ImmutableId"/);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer check-token");
    if (method === "POST" && url === "https://graph.microsoft.com/v1.0/me/messages") {
      const n = drafts.length + 1;
      drafts.push({ id: `draft-${n}`, mime: Buffer.from(String(init?.body), "base64").toString() });
      return Response.json(
        { id: `draft-${n}`, conversationId: `conv-${n}`, internetMessageId: `<exchange-${n}@prod.outlook.example>`, isDraft: true },
        { status: 201 },
      );
    }
    const send = /\/me\/messages\/(draft-\d+)\/send$/.exec(url);
    if (method === "POST" && send) return new Response(null, { status: 202 });
    if (method === "GET" && url.includes("/me/messages?$filter=receivedDateTime"))
      return Response.json({ value: inbox.map((item) => ({ id: item.id })) });
    const one = /\/me\/messages\/([^/?]+)\?/.exec(url);
    if (method === "GET" && one) {
      const found = inbox.find((item) => item.id === decodeURIComponent(one[1]));
      if (found) return Response.json(found);
    }
    throw new Error(`Simulated Graph rejected ${method} ${url}`);
  }) as typeof fetch;

  try {
    const admin = await db.user.create({
      // A random non-bcrypt value: this temporary user can never sign in.
      data: { name: "Outreach check", email: `outreach-check-${suffix}@example.invalid`, agencyAdmin: true, passwordHash: `unusable:${randomBytes(16).toString("hex")}` },
    });
    userId = admin.id;
    await db.platformPlan.create({
      data: { id: planId, name: "Outreach check", priceMinor: 0, available: false, dailyEmails: 50, dailyAi: 0, monthlyProspects: 0, teamMembers: 1, features: [] },
    });
    await db.workspace.create({
      data: {
        id: workspaceId,
        name: "Check Spares",
        timezone: "Africa/Johannesburg",
        status: "ACTIVE",
        platformOrganization: {
          create: {
            websiteUrl: `https://${domain}`,
            profileApprovedAt: new Date(),
            profileApprovedBy: admin.id,
            onboardingStatus: "ACTIVE",
            qualificationCriteria: { minimumScore: 70 },
            subscription: { create: { planId, status: "TRIAL", periodEnd: new Date(Date.now() + 86400000) } },
          },
        },
      },
    });
    created = true;
    // The fixture domain has no DNS; record the SPF/DKIM/DMARC result a set-up domain would give.
    const health = { domain: domain, checkedAt: new Date().toISOString(), spf: { status: "PASS", detail: "SPF ok" }, dkim: { status: "PASS", detail: "DKIM ok" }, dmarc: { status: "PASS", detail: "DMARC ok" } };
    const mailbox = await db.platformMailbox.create({
      data: {
        workspaceId,
        email: `gary@${domain}`,
        provider: "MICROSOFT",
        status: "LIVE_ENABLED",
        createdBy: admin.id,
        dailyLimit: 50,
        minimumIntervalSeconds: 5,
        lastSyncedAt: new Date(),
        domainHealth: health,
        domainCheckedAt: new Date(),
        encryptedCredentials: encrypt(JSON.stringify({ accessToken: "check-token", refreshToken: "unused", expiresAt: Date.now() + 3600000 })),
      },
    });
    const verified = { verificationStatus: "VALID", verifiedAt: new Date(), qualificationScore: 90, status: "QUALIFIED" };
    const yes = await db.platformLead.create({
      data: { workspaceId, company: "Yes Workshop", email: `owner@yes-${suffix.slice(0, 8)}.example.invalid`, ...verified },
    });
    const gone = await db.platformLead.create({
      data: { workspaceId, company: "Gone Workshop", email: `owner@gone-${suffix.slice(0, 8)}.example.invalid`, ...verified },
    });
    const campaign = async (purpose: string, leadIds: string[], extraMailboxIds: string[] = [], steps: object[] = []) => {
      const record = await db.platformCampaign.create({
        data: {
          workspaceId,
          mailboxId: mailbox.id,
          extraMailboxIds,
          steps,
          name: `${purpose} check`,
          purpose,
          subject: "Quick question",
          body: "Hello team,\n\nMay we email you about starter motors?",
          status: "RUNNING",
          approvedAt: new Date(),
          approvedBy: admin.id,
          dailyLimit: 50,
          sendStartHour: 0,
          sendEndHour: 24,
          sendWeekdays: [1, 2, 3, 4, 5, 6, 7],
        },
      });
      for (const leadId of leadIds)
        await db.platformCampaignRecipient.create({
          data: {
            workspaceId,
            campaignId: record.id,
            leadId,
            subject: "Quick question",
            body:
              purpose === "PERMISSION_REQUEST"
                ? withPermissionNotice("Hello team,\n\nMay we email you about starter motors?", "Check Spares")
                : "Hello team,\n\nHere are this month's starter motors.",
            approvedAt: new Date(),
            approvedBy: admin.id,
          },
        });
      return record;
    };
    const ready = () =>
      db.platformMailbox.update({ where: { id: mailbox.id }, data: { lastSentAt: null, lastSyncedAt: new Date() } });
    const send = (campaignId: string, leadId: string, followup = 0) =>
      withTenantDatabase(workspaceId, () =>
        sendCampaignMessage(workspaceId, campaignId, leadId, followup, `check-${campaignId}-${leadId}-${followup}`, graph),
      );

    // 0. A sending domain without DMARC holds the mailbox before anything reaches Microsoft.
    const ask = await campaign("PERMISSION_REQUEST", [yes.id, gone.id]);
    await db.platformMailbox.update({
      where: { id: mailbox.id },
      data: { domainHealth: { ...health, dmarc: { status: "FAIL", detail: "no DMARC record" } } },
    });
    await assert.rejects(send(ask.id, yes.id), /Sending domain for gary@.* needs attention: no DMARC record/);
    await db.platformMailbox.update({ where: { id: mailbox.id }, data: { domainHealth: health } });
    assert.equal(drafts.length, 0);
    step("sending domain without DMARC blocked before reaching Microsoft");

    // 1. The permission request goes out once per lead through Microsoft 365.
    assert.equal((await send(ask.id, yes.id)).status, "ACCEPTED");
    await ready();
    assert.equal((await send(ask.id, gone.id)).status, "ACCEPTED");
    const sent = await db.platformMailMessage.findMany({ where: { workspaceId, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(sent.map((message) => [message.status, message.providerMessageId, message.providerThreadId]), [
      ["ACCEPTED", "draft-1", "conv-1"],
      ["ACCEPTED", "draft-2", "conv-2"],
    ]);
    assert.equal(sent[0].originalRfcMessageId, "<exchange-1@prod.outlook.example>");
    assert.match(drafts[0].mime, new RegExp(`^From: gary@${domain.replaceAll(".", "\\.")}\\r\\n`));
    assert.match(drafts[0].mime, /\r\nList-Unsubscribe: <http:\/\/localhost:3999\/api\/platform\/unsubscribe\?/);
    assert.match(Buffer.from(drafts[0].mime.split("\r\n\r\n")[1].replaceAll("\r\n", ""), "base64").toString(), /one-time request for permission/);
    step("permission request sent through Microsoft 365 with notice and unsubscribe header");

    // 2. A second request to the same lead, and outreach before consent, are both refused.
    await ready();
    const again = await campaign("PERMISSION_REQUEST", [yes.id]);
    await assert.rejects(send(again.id, yes.id), /only one request/);
    const early = await campaign("OUTREACH", [yes.id]);
    await assert.rejects(send(early.id, yes.id), /lacks recorded marketing permission/);
    assert.equal(drafts.length, 2);
    step("second request and pre-consent outreach blocked before reaching Microsoft");

    // 3. A clear yes records consent; an Exchange non-delivery report suppresses the address.
    const now = new Date();
    inbox = [
      {
        id: "reply-yes",
        conversationId: "conv-1",
        internetMessageId: "<reply-yes@workshop.example>",
        isDraft: false,
        receivedDateTime: now.toISOString(),
        subject: "RE: Quick question",
        from: { emailAddress: { address: yes.email } },
        body: { content: "Yes please\r\n\r\nRegards,\r\nThabo\r\n\r\nFrom: Gary\r\nSent: today" },
        internetMessageHeaders: [{ name: "In-Reply-To", value: "<exchange-1@prod.outlook.example>" }],
      },
      {
        id: "ndr-gone",
        conversationId: "conv-2",
        isDraft: false,
        receivedDateTime: now.toISOString(),
        subject: "Undeliverable: Quick question",
        from: { emailAddress: { address: `postmaster@${domain}` } },
        body: { content: "Remote server returned '550 5.1.1 User unknown'" },
        singleValueExtendedProperties: [{ id: "String 0x001A", value: "REPORT.IPM.Note.NDR" }],
      },
      {
        id: "own-copy",
        conversationId: "conv-1",
        isDraft: false,
        receivedDateTime: now.toISOString(),
        subject: "Quick question",
        from: { emailAddress: { address: mailbox.email } },
        body: { content: "our own sent copy" },
      },
    ];
    const synced = await withTenantDatabase(workspaceId, () => syncMailbox(workspaceId, mailbox.id, graph));
    assert.deepEqual(synced, { recorded: 2, checked: 3 });
    const consented = await db.platformLead.findUniqueOrThrow({ where: { id: yes.id } });
    assert.equal(consented.eligibility, "CONSENTED");
    assert.equal(consented.consentAt?.getTime(), consented.repliedAt?.getTime());
    assert.match(consented.consentSource || "", /Replied "Yes please".*one-time permission request/);
    assert.ok(await db.platformNotice.findFirst({ where: { workspaceId, kind: "PERMISSION_GRANTED" } }));
    assert.ok(await db.platformMailSuppression.findFirst({ where: { workspaceId, email: gone.email! } }));
    assert.ok(await db.platformMailEvent.findFirst({ where: { workspaceId, kind: "BOUNCE", externalId: "microsoft:ndr:ndr-gone" } }));
    const repeat = await withTenantDatabase(workspaceId, () => syncMailbox(workspaceId, mailbox.id, graph));
    assert.equal(repeat.recorded, 0);
    assert.equal(await db.platformMailMessage.count({ where: { workspaceId, direction: "INBOUND" } }), 1);
    step("yes reply recorded as consent with evidence; bounce suppressed; resync is idempotent");

    // 4. With permission recorded, the consenting lead can receive outreach.
    assert.equal(leadSendBlocker(consented, 70), null);
    await ready();
    const outreach = await campaign("OUTREACH", [yes.id]);
    assert.equal((await send(outreach.id, yes.id)).status, "ACCEPTED");
    assert.equal(drafts.length, 3);
    step("consented lead receives outreach; the consenting reply does not block it");

    // 5. A campaign rotates across mailboxes, and a follow-up stays with the mailbox that wrote first.
    const second = await db.platformMailbox.create({
      data: {
        workspaceId,
        email: `sales@${domain}`,
        provider: "MICROSOFT",
        status: "LIVE_ENABLED",
        createdBy: admin.id,
        dailyLimit: 50,
        minimumIntervalSeconds: 5,
        lastSyncedAt: new Date(),
        warmupStartedAt: new Date(),
        domainHealth: health,
        domainCheckedAt: new Date(),
        encryptedCredentials: encrypt(JSON.stringify({ accessToken: "check-token", refreshToken: "unused", expiresAt: Date.now() + 3600000 })),
      },
    });
    const two = await db.platformLead.create({
      data: {
        workspaceId,
        company: "Two Workshop",
        email: `owner@two-${suffix.slice(0, 8)}.example.invalid`,
        ...verified,
        eligibility: "CONSENTED",
        consentSource: "Replied yes to the permission request",
        consentAt: new Date(Date.now() - 60000),
      },
    });
    const rotating = await campaign("OUTREACH", [yes.id, two.id], [second.id], [
      { delayDays: 3, subject: "Following up", body: "Hello again,\n\nDo you need starter motors this month?" },
    ]);
    // gary@ sent a moment ago and is inside its 5-second interval, so the idle mailbox goes first.
    assert.equal((await send(rotating.id, yes.id)).status, "ACCEPTED");
    await ready();
    assert.equal((await send(rotating.id, two.id)).status, "ACCEPTED");
    const rotated = await db.platformMailMessage.findMany({
      where: { workspaceId, campaignId: rotating.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(rotated.map((message) => message.fromEmail), [second.email, mailbox.email]);
    const pinned = await db.platformCampaignRecipient.findFirstOrThrow({ where: { campaignId: rotating.id, leadId: yes.id } });
    assert.equal(pinned.mailboxId, second.id);
    await db.platformCampaignRecipient.update({ where: { id: pinned.id }, data: { step: 1 } });
    await ready();
    await db.platformMailbox.update({ where: { id: second.id }, data: { lastSentAt: null, lastSyncedAt: new Date() } });
    assert.equal((await send(rotating.id, yes.id, 1)).status, "ACCEPTED");
    const followup = await db.platformMailMessage.findFirstOrThrow({ where: { workspaceId, campaignId: rotating.id, step: 1 } });
    assert.equal(followup.fromEmail, second.email);
    assert.equal(drafts.length, 6);
    step("campaign rotates across two mailboxes; the follow-up comes from the first sender");
    console.log(JSON.stringify({ completed: true, simulatedGraphDrafts: drafts.length, realEmailsSent: 0 }));
  } finally {
    if (created) {
      await db.platformMailEvent.deleteMany({ where: { workspaceId } });
      await db.platformMailMessage.deleteMany({ where: { workspaceId } });
      await db.platformCampaign.deleteMany({ where: { workspaceId } });
      await db.platformMailSuppression.deleteMany({ where: { workspaceId } });
      await db.platformMailbox.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.platformPlan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(String(error?.stack || error).replace(/postgres(?:ql)?:\/\/\S+/g, "[private database]"));
  process.exitCode = 1;
});
