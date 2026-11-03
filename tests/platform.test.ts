import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicAddress,
  normalizeWebsite,
} from "../src/platform/research/web";
import {
  verifyCitations,
  qualificationCategory,
  structuredAnalysis,
  qualificationSchema,
} from "../src/platform/research/analysis";
import { senderMatchesWebsite } from "../src/platform/mail/domain";
import { classifyReply, assessMailSafety } from "../src/platform/mail/policy";
import { withinSendingWindow } from "../src/platform/mail/schedule";
import { googleRawMessage } from "../src/platform/mail/google";
import { verifyFeedback } from "../src/platform/mail/feedback";
import {
  parseGmailDeliveryStatus,
  senderAddress,
} from "../src/platform/mail/mime";
import { jobToken } from "../src/platform/jobs";
import { sign, canManage } from "../src/lib/security";

test("client and legacy workspace roles cannot authorize operations", () => {
  for (const role of [
    "CLIENT_VIEWER",
    "DEMO_VIEWER",
    "CLIENT_ADMIN",
    "SALES_MEMBER",
    "OWNER",
    "ADMIN",
    "",
  ]) {
    assert.equal(canManage(role), false, role);
  }
  assert.equal(canManage("AGENCY_ADMIN"), true);
});

test("website research rejects private networks, tunnels, credential URLs and social accounts", () => {
  for (const value of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "fc00::1",
    "224.0.0.1",
  ])
    assert.equal(isPublicAddress(value), false, value);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  for (const url of [
    "http://localhost",
    "https://127.0.0.1",
    "https://user:pass@acme.com",
    "https://acme.com:8080",
    "https://linkedin.com/company/acme",
  ])
    assert.throws(() => normalizeWebsite(url));
  assert.equal(
    normalizeWebsite("https://www.acme.com/about?utm=123"),
    "https://www.acme.com",
  );
});
test("business sender ownership is an exact normalized domain comparison", () => {
  assert.equal(
    senderMatchesWebsite("hello@acme.com", ["https://www.acme.com/about"]),
    true,
  );
  for (const sender of [
    "x@acme.com.evil.net",
    "x@evilacme.com",
    "x@gmail.com",
    "x@acme.com@evil.net",
  ])
    assert.equal(senderMatchesWebsite(sender, ["https://acme.com"]), false);
});
test("AI evidence must quote a supplied source; suitability scores stay bounded", () => {
  const evidence = [
    {
      url: "https://acme.com",
      excerpt: "We provide commercial cleaning services.",
    },
  ];
  verifyCitations(
    [{ sourceUrl: evidence[0].url, quote: "commercial cleaning services" }],
    evidence,
  );
  assert.throws(() => verifyCitations([], evidence));
  assert.throws(() =>
    verifyCitations(
      [
        {
          sourceUrl: "https://other.com",
          quote: "commercial cleaning services",
        },
      ],
      evidence,
    ),
  );
  assert.throws(() =>
    qualificationSchema.parse({
      score: 101,
      explanation: "fit",
      facts: [],
      uncertainties: [],
    }),
  );
  assert.deepEqual([0, 25, 50, 80].map(qualificationCategory), [
    "UNQUALIFIED",
    "COLD",
    "WARM",
    "HOT",
  ]);
});
test("incomplete AI output is rejected before persisting any result", async () => {
  let sent: Record<string, unknown> = {};
  await assert.rejects(
    () =>
      structuredAnalysis(
        { key: "fixture", model: "fixture" },
        qualificationSchema,
        "Assess fit",
        {},
        async (_url, init) => {
          sent = JSON.parse(String(init?.body));
          return Response.json({ status: "incomplete", output: [] });
        },
      ),
    /incomplete/,
  );
  assert.equal(sent.store, false);
  assert.equal(sent.tools, undefined);
});
test("opt-outs take priority over positive phrases and quoted history", () => {
  assert.equal(
    classifyReply("Interested, but please unsubscribe me."),
    "UNSUBSCRIBE",
  );
  assert.equal(
    classifyReply("No thanks\nOn Tuesday someone wrote:\nI'm interested"),
    "NOT_INTERESTED",
  );
  assert.equal(classifyReply("How much will it cost?"), "PRICING");
});
test("complaints pause immediately and bounce thresholds use the configured minimum", () => {
  const policy = {
    safetyWindowHours: 24,
    safetyMinimumSent: 20,
    bounceThresholdPercent: 5,
    complaintThresholdPercent: 0.1,
  };
  assert.equal(
    assessMailSafety(policy, { accepted: 2, bounces: 1, complaints: 0 }).reason,
    null,
  );
  assert.equal(
    assessMailSafety(policy, { accepted: 20, bounces: 1, complaints: 0 })
      .reason,
    "BOUNCE_RATE",
  );
  assert.equal(
    assessMailSafety(policy, { accepted: 2, bounces: 0, complaints: 1 }).reason,
    "COMPLAINT_RATE",
  );
});
test("sending windows use the client timezone and weekday", () => {
  const policy = {
    sendStartHour: 9,
    sendEndHour: 17,
    sendWeekdays: [1, 2, 3, 4, 5],
  };
  assert.equal(
    withinSendingWindow(
      new Date("2026-11-02T07:00:00Z"),
      "Africa/Johannesburg",
      policy,
    ),
    true,
  );
  assert.equal(
    withinSendingWindow(
      new Date("2026-11-02T15:00:00Z"),
      "Africa/Johannesburg",
      policy,
    ),
    false,
  );
  assert.equal(
    withinSendingWindow(
      new Date("2026-11-01T10:00:00Z"),
      "Africa/Johannesburg",
      policy,
    ),
    false,
  );
});
test("outbound MIME prevents header injection and includes a one-click unsubscribe", () => {
  const input = {
    from: "owner@acme.com",
    to: "hello@client.com",
    subject: "Hello",
    body: "Test",
    rfcMessageId: "<one@acme.com>",
    unsubscribeUrl: "https://app.acme.com/unsubscribe",
    oneClickUrl: "https://app.acme.com/unsubscribe?oneClick=1",
  };
  const raw = Buffer.from(googleRawMessage(input), "base64url").toString();
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.throws(() =>
    googleRawMessage({ ...input, subject: "Hello\r\nBcc: thief@evil.com" }),
  );
  assert.equal(senderAddress("a@acme.com, b@acme.com"), null);
});
test("delivery failures require structured permanent DSN evidence", () => {
  assert.equal(
    parseGmailDeliveryStatus({
      mimeType: "text/plain",
      body: { data: Buffer.from("Delivery failed").toString("base64url") },
    }),
    null,
  );
});
test("feedback signatures bind the exact mailbox, payload and recent timestamp", () => {
  const key = "k".repeat(32),
    raw = '{"kind":"BOUNCE"}',
    stamp = "1793550000",
    now = Number(stamp) * 1000;
  const signature = sign(`${stamp}.mailbox-a.${raw}`, key);
  assert.equal(
    verifyFeedback("mailbox-a", raw, stamp, signature, key, now),
    true,
  );
  assert.equal(
    verifyFeedback("mailbox-b", raw, stamp, signature, key, now),
    false,
  );
  assert.equal(
    verifyFeedback("mailbox-a", raw, stamp, signature, key, now + 301000),
    false,
  );
});
test("automation tokens cannot be reused across tenants or dispatch attempts", () => {
  const job = {
      id: "job",
      workspaceId: "a",
      kind: "REPORT",
      dispatchAttempts: 1,
    },
    key = "x".repeat(32);
  assert.notEqual(
    jobToken(job, key),
    jobToken({ ...job, workspaceId: "b" }, key),
  );
  assert.notEqual(
    jobToken(job, key),
    jobToken({ ...job, dispatchAttempts: 2 }, key),
  );
});
