import test from "node:test";
import assert from "node:assert/strict";
import { mimeMessage } from "../src/platform/mail/google";
import {
  meetsQualification,
  permissionRequestBlocker,
} from "../src/platform/mail/permission";
import {
  outreachReplyTo,
  outreachSettings,
  placeholdersLeft,
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
