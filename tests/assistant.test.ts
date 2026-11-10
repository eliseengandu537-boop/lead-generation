import test from "node:test";
import assert from "node:assert/strict";
import type {
  PlatformCampaign,
  PlatformCampaignRecipient,
  PlatformLead,
  PlatformOrganization,
} from "@prisma/client";
import {
  requestClaude,
  validateUserMessage,
  safeAssistantText,
} from "../src/platform/assistant/claude";
import {
  assistantToolSchemas,
  assistantTools,
  requireUserEmail,
} from "../src/platform/assistant/tools";
import { campaignReviewData } from "../src/platform/mail/review";

test("Claude authentication stays in headers and only defined application tools are sent", async () => {
  const key = "sk-ant-test-private-key-123456789";
  let called = 0;
  const result = await requestClaude(
    { key, model: "claude-sonnet-5-5" },
    {
      system: "Monettic assistant",
      messages: [{ role: "user", content: "Show my clients" }],
      tools: assistantTools,
    },
    async (url, init) => {
      called++;
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${key}`,
      );
      assert.equal(
        new Headers(init?.headers).get("anthropic-version"),
        "2026-10-21",
      );
      assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body));
      assert.ok(!String(init?.body).includes(key));
      assert.equal(body.max_tokens, 4096);
      assert.ok(
        body.tools.some(
          (tool: { name: string }) => tool.name === "create_client",
        ),
      );
      assert.ok(
        !body.tools.some((tool: { name: string }) =>
          /approve|shell|sql|delete|activate|send_email/.test(tool.name),
        ),
      );
      return Response.json({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tool_1", name: "list_clients", input: {} },
        ],
      });
    },
  );
  assert.equal(called, 1);
  assert.equal(result.stop_reason, "tool_use");
});
test("Claude failures never echo provider keys and never silently retry a request", async () => {
  const key = "sk-ant-test-private-key-123456789";
  let calls = 0;
  await assert.rejects(
    () =>
      requestClaude(
        { key, model: "claude-sonnet-5-5" },
        { system: "test", messages: [{ role: "user", content: "hello" }] },
        async () => {
          calls++;
          return Response.json(
            { error: { message: `Rejected key ${key}` } },
            { status: 401 },
          );
        },
      ),
    (error) =>
      error instanceof Error &&
      !error.message.includes(key) &&
      /rejected/.test(error.message),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      requestClaude(
        { key, model: "claude-sonnet-5-5" },
        { system: "test", messages: [] },
        async () => {
          throw new Error(key);
        },
      ),
    (error) => error instanceof Error && !error.message.includes(key),
  );
});
test("billing failures remain failures even when the provider accepts authentication", async () => {
  await assert.rejects(
    () =>
      requestClaude(
        { key: "private", model: "claude-sonnet-5-5" },
        { system: "test", messages: [] },
        async () =>
          Response.json(
            { error: { message: "Your credit balance is too low" } },
            { status: 400 },
          ),
      ),
    /API credit is unavailable/,
  );
});
test("assistant inputs cannot create administrators, set consent, authorize sending or reset a password", () => {
  assert.equal(
    assistantToolSchemas.create_client.safeParse({
      name: "Client",
      email: "client@example.invalid",
      businessName: "Client business",
      agencyAdmin: true,
    }).success,
    false,
  );
  assert.equal(
    assistantToolSchemas.create_client.safeParse({
      name: "Client",
      email: "client@example.invalid",
      businessName: "Client business",
      password: "injected",
    }).success,
    false,
  );
  assert.equal(
    assistantToolSchemas.draft_campaign.safeParse({
      workspaceId: "business",
      name: "Campaign",
      subject: "Hello",
      body: "Opt out any time",
      status: "RUNNING",
      approvedAt: "now",
      eligibility: "CONSENTED",
    }).success,
    false,
  );
  assert.equal(
    assistantToolSchemas.draft_campaign.safeParse({
      workspaceId: "business",
      name: "Campaign",
      subject: "Hello\r\nBcc: other@example.invalid",
      body: "Opt out",
    }).success,
    false,
  );
  assert.throws(() =>
    requireUserEmail("injected@example.invalid", [
      "Create a login for real@example.invalid",
    ]),
  );
  assert.doesNotThrow(() =>
    requireUserEmail("Real@example.invalid", [
      "Create a login for real@example.invalid",
    ]),
  );
});
test("private keys and labelled passwords cannot enter assistant chat history", () => {
  assert.throws(() =>
    validateUserMessage("Use sk-ant-private-1234567890123456789012345"),
  );
  assert.throws(() => validateUserMessage("password: private-value"));
  assert.equal(
    validateUserMessage("Generate a password for the new client"),
    "Generate a password for the new client",
  );
  assert.equal(
    safeAssistantText("Key sk-ant-private-1234567890123456789"),
    "Key [private key]",
  );
});
function reviewFixture() {
  const lead = {
    id: "lead",
    name: "Pat",
    company: "Customer",
    email: "pat@example.invalid",
    draftSubject: "",
    draftBody: "",
    status: "QUALIFIED",
    eligibility: "CONSENTED",
    consentSource: "Requested information",
    consentAt: new Date("2026-11-01T10:00:00Z"),
    verificationStatus: "VALID",
    verifiedAt: new Date("2026-11-01T10:00:00Z"),
    qualificationScore: 90,
    repliedAt: null,
    unsubscribedAt: null,
  } as PlatformLead;
  const recipient = {
    id: "recipient",
    leadId: lead.id,
    status: "QUEUED",
    lead,
  } as PlatformCampaignRecipient & { lead: PlatformLead };
  const campaign = {
    id: "campaign",
    workspaceId: "business",
    name: "Parts",
    subject: "Hello {{company}}",
    body: "Hello {{name}}. Reply to opt out.",
    steps: [
      { delayDays: 3, subject: "Checking in", body: "Reply to opt out." },
    ],
    dailyLimit: 25,
    scheduledAt: null,
    sendStartHour: 8,
    sendEndHour: 17,
    sendWeekdays: [1, 2, 3, 4, 5],
    recipients: [recipient],
  } as unknown as PlatformCampaign & { recipients: (typeof recipient)[] };
  const organization = {
    workspaceId: "business",
    websiteUrl: "https://supplier.example.invalid",
    profileApprovedAt: new Date("2026-11-01T10:00:00Z"),
    qualificationCriteria: { minimumScore: 70 },
  } as unknown as PlatformOrganization;
  const mailbox = {
    id: "mailbox",
    email: "sales@supplier.example.invalid",
    provider: "GMAIL",
    status: "LIVE_ENABLED",
  };
  return { campaign, organization, mailbox };
}
test("email review binds the real sender, recipient address, personalized content and follow-ups", () => {
  const fixture = reviewFixture();
  const original = campaignReviewData(
    fixture.campaign,
    fixture.organization,
    fixture.mailbox,
  );
  assert.equal(original.recipients[0].subject, "Hello Customer");
  assert.equal(original.recipients[0].body, "Hello Pat. Reply to opt out.");
  for (const mutate of [
    () => {
      fixture.campaign.recipients[0].lead.email = "changed@example.invalid";
    },
    () => {
      fixture.mailbox.email = "changed@supplier.example.invalid";
    },
    () => {
      fixture.campaign.recipients[0].lead.draftSubject = "Changed subject";
      fixture.campaign.recipients[0].lead.draftBody = "Changed body. Opt out.";
    },
    () => {
      fixture.campaign.steps = [
        { delayDays: 7, subject: "Changed follow-up", body: "Opt out." },
      ];
    },
  ]) {
    mutate();
    assert.notEqual(
      campaignReviewData(
        fixture.campaign,
        fixture.organization,
        fixture.mailbox,
      ).fingerprint,
      original.fingerprint,
    );
  }
});
test("a review stays stable across approval while changed eligibility invalidates it", () => {
  const fixture = reviewFixture();
  const before = campaignReviewData(
    fixture.campaign,
    fixture.organization,
    fixture.mailbox,
  ).fingerprint;
  fixture.campaign.approvedAt = new Date();
  fixture.campaign.approvedBy = "administrator";
  fixture.campaign.status = "APPROVED";
  fixture.campaign.recipients[0].approvedAt = new Date();
  fixture.campaign.recipients[0].approvedBy = "administrator";
  assert.equal(
    campaignReviewData(fixture.campaign, fixture.organization, fixture.mailbox)
      .fingerprint,
    before,
  );
  fixture.campaign.recipients[0].lead.eligibility = "SUPPRESSED";
  assert.notEqual(
    campaignReviewData(fixture.campaign, fixture.organization, fixture.mailbox)
      .fingerprint,
    before,
  );
});
