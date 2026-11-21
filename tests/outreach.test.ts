import test from "node:test";
import assert from "node:assert/strict";
import { mimeMessage } from "../src/platform/mail/google";
import {
  meetsQualification,
  permissionRequestBlocker,
} from "../src/platform/mail/permission";
import {
  outreachReplyTo,
  nextSearch,
  outreachSettings,
  placeholdersLeft,
  senderBusinessName,
} from "../src/platform/outreach-settings";

const mail = {
  from: "gary@client.example",
  to: "owner@workshop.example",
  subject: "Quick question",
  body: "Hello",
  rfcMessageId: "<abc@client.example>",
};

test("replies can go to the client's sales reps as well as the sending inbox", () => {
  const raw = mimeMessage({
    ...mail,
    replyTo: ["sales@client.example", "Rep@Client.example ", "gary@client.example"],
  });
  assert.match(
    raw,
    /\r\nReply-To: sales@client\.example, Rep@Client\.example, gary@client\.example\r\n/,
  );
  assert.doesNotMatch(mimeMessage(mail), /Reply-To:/);
  assert.throws(() => mimeMessage({ ...mail, replyTo: ["not an email\r\nBcc: x@y.z"] }));
});

test("a niche match qualifies a lead without an AI score; unscored leads still do not", () => {
  assert.ok(meetsQualification({ qualificationScore: null, qualificationCategory: "NICHE_MATCH" }, 70));
  assert.ok(meetsQualification({ qualificationScore: 80, qualificationCategory: null }, 70));
  assert.ok(!meetsQualification({ qualificationScore: null, qualificationCategory: null }, 70));
  assert.ok(!meetsQualification({ qualificationScore: 40, qualificationCategory: "COLD" }, 70));
  const lead = {
    status: "QUALIFIED",
    email: "owner@workshop.example",
    verificationStatus: "VALID",
    verifiedAt: new Date(Date.now() - 86400000),
    qualificationScore: null,
    qualificationCategory: "NICHE_MATCH",
    eligibility: "UNKNOWN",
    consentSource: null,
    consentAt: null,
    repliedAt: null,
    unsubscribedAt: null,
  };
  assert.equal(permissionRequestBlocker(lead, 70, false), null);
  assert.match(
    permissionRequestBlocker({ ...lead, verificationStatus: "UNKNOWN" }, 70, false) ?? "",
    /verification/,
  );
  assert.match(permissionRequestBlocker(lead, 70, true) ?? "", /only one request/);
});

test("outreach settings fall back to safe defaults and flag leftover placeholders", () => {
  const empty = outreachSettings(null);
  assert.equal(empty.enabled, false);
  assert.equal(empty.dailyLimit, 20);
  assert.deepEqual(empty.niches, []);
  assert.deepEqual(outreachSettings({ replyTo: ["not-an-email"] }).replyTo, []);
  assert.deepEqual(outreachReplyTo({ replyTo: ["rep@client.example"] }), ["rep@client.example"]);
  assert.deepEqual(
    placeholdersLeft("Quick question for {{company}}", "Hi {{name}}, I'm {{your name}} from {{ client }}."),
    ["your name", "client"],
  );
});

test("emails and the POPIA notice name the business from its profile, not the workspace label", () => {
  assert.equal(
    senderBusinessName({ companyName: " DCB Auto Electrical Spares " }, "dcbspare"),
    "DCB Auto Electrical Spares",
  );
  assert.equal(senderBusinessName({ companyName: "" }, "dcbspare"), "dcbspare");
  assert.equal(senderBusinessName(null, "dcbspare"), "dcbspare");
  assert.equal(senderBusinessName(["not", "a", "profile"], "dcbspare"), "dcbspare");
});

test("a failed business search retries the same area once in 30 minutes, then moves on", () => {
  const now = Date.UTC(2026, 10, 21, 12);
  const wc = { niche: "forklift", area: "Western Cape" };
  const ok = nextSearch(1, null, { ...wc }, now);
  assert.deepEqual(ok, { nicheCursor: 2, nextFindAt: new Date(now + 6 * 3600000).toISOString() });
  const retry = nextSearch(1, { niche: "forklift", area: "Gauteng" }, { ...wc, error: "Interrupted" }, now);
  assert.deepEqual(retry, { nicheCursor: 1, nextFindAt: new Date(now + 30 * 60000).toISOString() });
  const moveOn = nextSearch(1, { ...wc, error: "Interrupted" }, { ...wc, error: "Interrupted" }, now);
  assert.equal(moveOn.nicheCursor, 2);
});
