import test from "node:test";
import assert from "node:assert/strict";
import { mimeMessage } from "../src/platform/mail/google";
import {
  meetsQualification,
  permissionRequestBlocker,
} from "../src/platform/mail/permission";
import {
  outreachReplyTo,
  excluded,
  laneFor,
  lanesOf,
  nextSearch,
  outreachSettings,
  placeholdersLeft,
  searchTargets,
  senderBusinessName,
  senderFirstName,
  withSender,
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
  assert.deepEqual(ok, { nicheCursor: 2, nextFindAt: new Date(now + 2 * 3600000).toISOString() });
  const retry = nextSearch(1, { niche: "forklift", area: "Gauteng" }, { ...wc, error: "Interrupted" }, now);
  assert.deepEqual(retry, { nicheCursor: 1, nextFindAt: new Date(now + 30 * 60000).toISOString() });
  const moveOn = nextSearch(1, { ...wc, error: "Interrupted" }, { ...wc, error: "Interrupted" }, now);
  assert.equal(moveOn.nicheCursor, 2);
});

test("older single-campaign settings read as one campaign called Main", () => {
  const settings = outreachSettings({
    niches: [{ niche: "forklift", area: "Gauteng" }, { niche: "forklift", area: "Western Cape" }],
    replyTo: ["gary@dcbspares.co.za"],
    subject: "forklift parts for {{company}}",
    body: "Hi",
    campaignId: "camp-1",
  });
  const [lane] = lanesOf(settings);
  assert.equal(lanesOf(settings).length, 1);
  assert.deepEqual(
    { id: lane.id, niches: lane.niches, areas: lane.areas, replyTo: lane.replyTo, campaignId: lane.campaignId },
    { id: "main", niches: ["forklift"], areas: ["Gauteng", "Western Cape"], replyTo: ["gary@dcbspares.co.za"], campaignId: "camp-1" },
  );
  assert.deepEqual(lanesOf(outreachSettings({})), []);
});

test("Western Cape businesses go to the Cape campaign and its reps; the rest to head office", () => {
  const lanes = lanesOf(
    outreachSettings({
      lanes: [
        { id: "fl-wc", name: "Forklift · WC", niches: ["forklift"], areas: ["Western Cape"], replyTo: ["warren@dcbspares.co.za", "shane@dcbspares.co.za"], subject: "s", body: "b" },
        { id: "fl-nat", name: "Forklift · Rest", niches: ["forklift"], areas: ["Gauteng", "KwaZulu-Natal"], replyTo: ["gary@dcbspares.co.za"], subject: "s", body: "b" },
        { id: "ae", name: "Auto electricians", niches: ["auto electrician", "mechanic"], areas: [], replyTo: [], subject: "s", body: "b" },
      ],
    }),
  );
  assert.deepEqual(
    searchTargets(lanes).map((t) => `${t.niche}/${t.area}/${t.lane}`),
    ["forklift/Western Cape/fl-wc", "forklift/Gauteng/fl-nat", "forklift/KwaZulu-Natal/fl-nat", "auto electrician/South Africa/ae", "mechanic/South Africa/ae"],
  );
  assert.equal(laneFor(lanes, { niche: "Forklift", area: "western cape" })?.id, "fl-wc");
  assert.equal(laneFor(lanes, { niche: "forklift", area: "Gauteng" })?.id, "fl-nat");
  assert.equal(laneFor(lanes, { lane: "ae", niche: "forklift", area: "Gauteng" })?.id, "ae", "where it was found wins");
  assert.equal(laneFor(lanes, { niche: "plumber", area: "Gauteng" }), null, "no campaign, no email");
});

test("replies go to the campaign's own reps, else the client's general list", async () => {
  const { outreachReplyTo } = await import("../src/platform/outreach-settings");
  const raw = {
    replyTo: ["sales@dcbspares.co.za"],
    lanes: [
      { id: "wc", name: "WC", niches: ["forklift"], replyTo: ["warren@dcbspares.co.za"], subject: "s", body: "b" },
      { id: "nat", name: "NAT", niches: ["forklift"], replyTo: [], subject: "s", body: "b" },
    ],
  };
  assert.deepEqual(outreachReplyTo(raw, "wc"), ["warren@dcbspares.co.za"]);
  assert.deepEqual(outreachReplyTo(raw, "nat"), ["sales@dcbspares.co.za"]);
  assert.deepEqual(outreachReplyTo(raw, undefined), ["sales@dcbspares.co.za"]);
});

test("{{sender}} becomes the sending inbox's first name; skip words match names", () => {
  assert.equal(senderFirstName("warren@dcbspares.com"), "Warren");
  assert.equal(senderFirstName("gary.basel@dcbspares.com"), "Gary");
  assert.equal(withSender("I'm {{sender}} from DCB. {{ sender }}", "hans@dcbspares.com"), "I'm Hans from DCB. Hans");
  assert.deepEqual(placeholdersLeft("Hi {{company}}", "I'm {{sender}}"), []);
  assert.ok(excluded(["training", "battery"], "Forklift Training Academy"));
  assert.ok(excluded(["battery"], "Acme", "forklift_battery_supplier"));
  assert.ok(!excluded(["training"], "Fred's Forklift and Plant Hire"));
});

test("the From line shows the sender's name, safely encoded", () => {
  assert.match(mimeMessage({ ...mail, fromName: "Warren at DCB Auto Cape" }), /^From: "Warren at DCB Auto Cape" <gary@client\.example>\r\n/);
  assert.match(mimeMessage({ ...mail, fromName: 'Bad "name"\r\nBcc: x@y.z' }), /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <gary@client\.example>\r\n/);
  assert.doesNotMatch(mimeMessage({ ...mail, fromName: 'x\r\nBcc: x@y.z' }), /\r\nBcc:/);
  assert.match(mimeMessage(mail), /^From: gary@client\.example\r\n/);
});
