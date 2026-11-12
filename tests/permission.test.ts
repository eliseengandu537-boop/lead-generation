import test from "node:test";
import assert from "node:assert/strict";
import {
  clearConsentReply,
  hasMarketingPermission,
  permissionRequestBlocker,
  replyBlocksOutreach,
  withPermissionNotice,
} from "../src/platform/mail/permission";

test("only an unambiguous yes in the first paragraph counts as consent", () => {
  for (const reply of [
    "Yes please",
    "yes",
    "Okay, send it through.",
    "Sure!\n\nRegards,\nThabo\nDCB Workshop\n082 000 0000",
    "Yes please\n\nOn Tue, 12 Nov 2026 at 09:00, Gary <gary@dcb.example> wrote:\n> Would you like to hear from us? Reply YES and we will be in touch.",
    "Go ahead\n\n________________________________\nFrom: Gary\nSent: Tuesday\nDo not reply NO",
  ])
    assert.ok(clearConsentReply(reply), reply);
  for (const reply of [
    "",
    "No thanks",
    "Yes, but not now",
    "Please remove me from your list",
    "Yes\nunsubscribe me",
    "Who is this?",
    "Maybe later",
    `Yes ${"we would like to know more about your pricing and delivery times ".repeat(4)}`,
    "Yes\nline two\nline three\nline four",
  ])
    assert.equal(clearConsentReply(reply), null, reply);
});

const lead = {
  status: "QUALIFIED",
  email: "owner@workshop.example",
  verificationStatus: "VALID",
  verifiedAt: new Date(Date.now() - 86400000),
  qualificationScore: 85,
  eligibility: "UNKNOWN",
  consentSource: null as string | null,
  consentAt: null as Date | null,
  repliedAt: null as Date | null,
  unsubscribedAt: null as Date | null,
};

test("a permission request needs a verified, qualified lead that was never asked or contacted", () => {
  assert.equal(permissionRequestBlocker(lead, 70, false), null);
  assert.match(permissionRequestBlocker(lead, 70, true)!, /only one request/);
  assert.match(permissionRequestBlocker({ ...lead, qualificationScore: 60 }, 70, false)!, /qualification/);
  assert.match(permissionRequestBlocker({ ...lead, verificationStatus: "RISKY" }, 70, false)!, /verification/);
  assert.match(
    permissionRequestBlocker({ ...lead, verifiedAt: new Date(Date.now() - 40 * 86400000) }, 70, false)!,
    /verification/,
  );
  assert.match(permissionRequestBlocker({ ...lead, eligibility: "SUPPRESSED" }, 70, false)!, /opted out/);
  assert.match(permissionRequestBlocker({ ...lead, status: "NOT_INTERESTED" }, 70, false)!, /declined/);
  assert.match(permissionRequestBlocker({ ...lead, repliedAt: new Date() }, 70, false)!, /already replied/);
  const consented = {
    ...lead,
    eligibility: "CONSENTED",
    consentSource: "Replied yes",
    consentAt: new Date(Date.now() - 1000),
  };
  assert.ok(hasMarketingPermission(consented));
  assert.match(permissionRequestBlocker(consented, 70, false)!, /already has recorded permission/);
});

test("the reply that granted permission does not stop outreach, but any later reply does", () => {
  const at = new Date("2026-11-12T08:00:00Z");
  assert.equal(replyBlocksOutreach({ ...lead, repliedAt: null }), false);
  assert.equal(replyBlocksOutreach({ ...lead, repliedAt: at, consentAt: at }), false);
  assert.equal(
    replyBlocksOutreach({ ...lead, repliedAt: new Date(at.getTime() + 1000), consentAt: at }),
    true,
  );
  assert.equal(replyBlocksOutreach({ ...lead, repliedAt: at, consentAt: null }), true);
});

test("every permission request carries the fixed one-time notice", () => {
  const body = withPermissionNotice("Hello team,\n\nMay we email you?\n\n", "DCB Spares");
  assert.match(body, /^Hello team,\n\nMay we email you\?\n\nThis is a one-time request/);
  assert.match(body, /DCB Spares will only send you marketing emails if you reply YES/);
  assert.match(body, /we will not email you again\.$/);
});
