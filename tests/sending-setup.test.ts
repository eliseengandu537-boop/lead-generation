import test from "node:test";
import assert from "node:assert/strict";
import {
  checkSendingDomain,
  domainBlockers,
  domainWarnings,
} from "../src/platform/mail/authentication";
import {
  campaignMailboxIds,
  dailyAllowance,
  pickSendingMailbox,
  warmupProgress,
} from "../src/platform/mail/rotation";
import { senderAllowed, sendingDomain } from "../src/platform/mail/domain";

const dnsError = (code: string) => Object.assign(new Error(code), { code });
/** A resolver over a fixed zone: name → TXT strings, or an error code. */
function zone(txt: Record<string, string[] | string>, cname: Record<string, string[]> = {}) {
  return {
    resolveTxt: async (name: string) => {
      const value = txt[name];
      if (typeof value === "string") throw dnsError(value);
      if (!value) throw dnsError("ENODATA");
      return value.map((record) => [record]);
    },
    resolveCname: async (name: string) => {
      if (!cname[name]) throw dnsError("ENODATA");
      return cname[name];
    },
  } as never;
}
const googleKey = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";

test("a fully set-up Google Workspace domain passes all three checks", async () => {
  const health = await checkSendingDomain(
    "sales@getacme.co.za",
    "GMAIL",
    zone({
      "getacme.co.za": ["v=spf1 include:_spf.google.com ~all", "google-site-verification=abc"],
      "google._domainkey.getacme.co.za": [googleKey],
      "_dmarc.getacme.co.za": ["v=DMARC1; p=none; rua=mailto:d@getacme.co.za"],
    }),
  );
  assert.deepEqual(
    [health.spf.status, health.dkim.status, health.dmarc.status],
    ["PASS", "PASS", "PASS"],
  );
  assert.deepEqual(domainBlockers(health), []);
  assert.deepEqual(domainWarnings(health), []);
});

test("missing SPF and DMARC block sending and say which record to add", async () => {
  const health = await checkSendingDomain("sales@getacme.co.za", "GMAIL", zone({}));
  const blockers = domainBlockers(health);
  assert.equal(blockers.length, 2);
  assert.match(blockers[0], /v=spf1 include:_spf\.google\.com ~all/);
  assert.match(blockers[1], /_dmarc\.getacme\.co\.za: v=DMARC1; p=none/);
  assert.match(domainWarnings(health)[0], /DKIM/);
});

test("two SPF records are a hard failure; SPF without the provider is a warning", async () => {
  const doubled = await checkSendingDomain(
    "a@x.com",
    "GMAIL",
    zone({ "x.com": ["v=spf1 include:_spf.google.com ~all", "v=spf1 mx -all"], "_dmarc.x.com": ["v=DMARC1; p=reject"] }),
  );
  assert.equal(doubled.spf.status, "FAIL");
  const elsewhere = await checkSendingDomain(
    "a@x.com",
    "MICROSOFT",
    zone({ "x.com": ["v=spf1 include:_spf.google.com ~all"], "_dmarc.x.com": ["v=DMARC1; p=quarantine"] }),
  );
  assert.equal(elsewhere.spf.status, "WARN");
  assert.deepEqual(domainBlockers(elsewhere), []);
});

test("SPF found through a nested include, and Microsoft DKIM through its CNAME", async () => {
  const health = await checkSendingDomain(
    "a@x.com",
    "MICROSOFT",
    zone(
      {
        "x.com": ["v=spf1 include:_spf.x.com -all"],
        "_spf.x.com": ["v=spf1 include:spf.protection.outlook.com -all"],
        "_dmarc.x.com": ["v=DMARC1; p=none"],
      },
      { "selector1._domainkey.x.com": ["selector1-x-com._domainkey.x.onmicrosoft.com"] },
    ),
  );
  assert.equal(health.spf.status, "PASS");
  assert.equal(health.dkim.status, "WARN");
  assert.match(health.dkim.detail, /no key is published yet/);
});

test("a subdomain inherits DMARC; a DNS timeout never counts as a pass", async () => {
  const inherited = await checkSendingDomain(
    "a@mail.x.com",
    "GMAIL",
    zone({ "mail.x.com": ["v=spf1 include:_spf.google.com ~all"], "_dmarc.x.com": ["v=DMARC1; p=none"] }),
  );
  assert.equal(inherited.dmarc.status, "PASS");
  const timedOut = await checkSendingDomain("a@x.com", "GMAIL", zone({ "x.com": "ETIMEOUT", "_dmarc.x.com": "ETIMEOUT" }));
  assert.equal(timedOut.spf.status, "ERROR");
  assert.equal(domainBlockers(timedOut).length, 2);
  assert.deepEqual(domainBlockers(null), ["The sending domain has not been checked yet."]);
});

test("warm-up starts at 5 a day, adds 2 a day and stops at the mailbox limit", () => {
  const start = new Date("2026-11-01T08:00:00Z");
  const mailbox = { dailyLimit: 25, warmupStartedAt: start };
  assert.equal(dailyAllowance(mailbox, start), 5);
  assert.equal(dailyAllowance(mailbox, new Date("2026-11-04T09:00:00Z")), 11);
  assert.equal(dailyAllowance(mailbox, new Date("2026-11-30T09:00:00Z")), 25);
  assert.equal(dailyAllowance({ dailyLimit: 25, warmupStartedAt: null }, start), 25);
  assert.deepEqual(warmupProgress(mailbox, start), { allowance: 5, complete: false, daysLeft: 10 });
});

const healthy = {
  domain: "x.com",
  checkedAt: "2026-11-12T00:00:00Z",
  spf: { status: "PASS", detail: "" },
  dkim: { status: "PASS", detail: "" },
  dmarc: { status: "PASS", detail: "" },
};
const now = new Date("2026-11-12T10:00:00Z");
const box = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "LIVE_ENABLED",
  dailyLimit: 25,
  warmupStartedAt: null,
  lastSentAt: null,
  lastSyncedAt: new Date(now.getTime() - 10_000),
  minimumIntervalSeconds: 30,
  domainHealth: healthy,
  ...extra,
});

test("rotation keeps a recipient on its mailbox and otherwise spreads the load", () => {
  const rotation = ["a", "b", "c"];
  const sent = new Map([["a", 10], ["b", 2], ["c", 2]]);
  const mailboxes = [
    box("a"),
    box("b", { lastSentAt: new Date(now.getTime() - 5_000) }),
    box("c"),
  ];
  assert.equal(pickSendingMailbox(rotation, mailboxes, sent, "a", now), "a");
  // b is still inside its sending interval, so c goes next.
  assert.equal(pickSendingMailbox(rotation, mailboxes, sent, null, now), "c");
});

test("rotation skips disabled, unhealthy, unsynced and full mailboxes", () => {
  const rotation = ["a", "b", "c", "d"];
  const mailboxes = [
    box("a", { status: "DISABLED" }),
    box("b", { domainHealth: { ...healthy, dmarc: { status: "FAIL", detail: "no DMARC" } } }),
    box("c", { warmupStartedAt: now }),
    box("d", { lastSyncedAt: new Date(now.getTime() - 120_000) }),
  ];
  // c has used its warm-up allowance of 5, so d gets the email; the send then waits for d to sync.
  assert.equal(pickSendingMailbox(rotation, mailboxes, new Map([["c", 5]]), null, now), "d");
  // A recipient pinned to a disabled mailbox moves to a working one.
  assert.equal(pickSendingMailbox(rotation, mailboxes, new Map(), "a", now), "c");
  assert.equal(pickSendingMailbox(["a", "b"], mailboxes, new Map(), null, now), null);
  assert.deepEqual(campaignMailboxIds({ mailboxId: "a", extraMailboxIds: ["b", "a", "c"] }), ["a", "b", "c"]);
});

test("extra sending domains are allowed only once an administrator adds them", () => {
  const organization = { websiteUrl: "https://www.acme.co.za", sendingDomains: ["getacme.co.za"] };
  assert.equal(senderAllowed("sales@acme.co.za", organization), true);
  assert.equal(senderAllowed("tom@getacme.co.za", organization), true);
  assert.equal(senderAllowed("tom@acme-mail.co.za", organization), false);
  assert.equal(sendingDomain("https://GetAcme.co.za/"), "getacme.co.za");
  assert.equal(sendingDomain("gmail.com"), null);
  assert.equal(sendingDomain("not a domain"), null);
});
