import test from "node:test";
import assert from "node:assert/strict";
import { parseRawMessage, rawText, decodeWords } from "../src/platform/mail/raw-mime";
import { gmailHeader, parseGmailDeliveryStatus, senderAddress } from "../src/platform/mail/mime";
import { isGmailAddress, normalizeAppPassword } from "../src/platform/mail/app-password";
import { freeAddressCheck, verificationSetup } from "../src/platform/research/verification";
import { isSendingProvider } from "../src/platform/mail/provider";

// The shape of a Gmail "Delivery Status Notification (Failure)" read over IMAP.
const bounce = [
  "Return-Path: <>",
  "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
  "To: dcbspares@gmail.com",
  "Subject: Delivery Status Notification (Failure)",
  "Message-ID: <bounce-1@mx.google.com>",
  'Content-Type: multipart/report; report-type=delivery-status; boundary="00000000000011112222"',
  "",
  "--00000000000011112222",
  'Content-Type: text/plain; charset="UTF-8"',
  "",
  "Address not found. Your message wasn't delivered to nobody@deadworkshop.co.za.",
  "--00000000000011112222",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; googlemail.com",
  "",
  "Final-Recipient: rfc822; nobody@deadworkshop.co.za",
  "Action: failed",
  "Status: 5.1.1",
  "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
  "",
  "--00000000000011112222",
  "Content-Type: message/rfc822",
  "",
  "From: DCB Auto Electrical Spares <dcbspares@gmail.com>",
  "To: nobody@deadworkshop.co.za",
  "Subject: forklift parts for Dead Workshop",
  "Message-ID: <abc123@monettic.mail>",
  "",
  "Hi Dead Workshop team,",
  "--00000000000011112222--",
  "",
].join("\r\n");

test("a Gmail bounce read over IMAP gives the failed address and our original message", () => {
  const part = parseRawMessage(Buffer.from(bounce, "latin1"));
  const feedback = parseGmailDeliveryStatus(part);
  assert.ok(feedback);
  assert.deepEqual(feedback.originalMessageIds, ["<abc123@monettic.mail>"]);
  assert.equal(feedback.recipients.length, 1);
  assert.equal(feedback.recipients[0].email, "nobody@deadworkshop.co.za");
  assert.equal(feedback.recipients[0].type, "BOUNCE");
  assert.equal(feedback.recipients[0].status, "5.1.1");
});

test("a reply read over IMAP keeps its sender, references and text", () => {
  const reply = [
    "From: =?UTF-8?B?Sm9oYW4gdmFuIFd5aw==?= <johan@forklifthire.co.za>",
    "To: dcbspares@gmail.com",
    "Subject: =?UTF-8?Q?Re:_forklift_parts_for_Benoni_Forklift_Hire?=",
    "Message-ID: <CAF123@mail.gmail.com>",
    "In-Reply-To: <abc123@monettic.mail>",
    "References: <abc123@monettic.mail>",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "YES please send prices =E2=80=93 we have 6 Toyota forklifts.",
    "--b1",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    "<p>YES please</p>",
    "--b1--",
    "",
  ].join("\r\n");
  const part = parseRawMessage(Buffer.from(reply, "latin1"));
  assert.equal(parseGmailDeliveryStatus(part), null);
  assert.equal(senderAddress(gmailHeader(part, "From")), "johan@forklifthire.co.za");
  assert.equal(gmailHeader(part, "Subject"), "Re: forklift parts for Benoni Forklift Hire");
  assert.match(gmailHeader(part, "In-Reply-To"), /<abc123@monettic\.mail>/);
  assert.equal(rawText(part), "YES please send prices – we have 6 Toyota forklifts.");
});

test("an HTML-only reply still gives readable text", () => {
  const html = [
    "From: a@b.co.za",
    'Content-Type: text/html; charset="windows-1252"',
    "",
    "<div>Yes, send it&nbsp;please<br>Thanks</div>",
    "",
  ].join("\r\n");
  assert.equal(rawText(parseRawMessage(html)), "Yes, send it please\nThanks");
  assert.equal(decodeWords("=?ISO-8859-1?Q?Caf=E9?="), "Café");
});

test("App Passwords and Gmail addresses are recognised", () => {
  assert.equal(normalizeAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(normalizeAppPassword("ABCD-EFGH"), null);
  assert.equal(isGmailAddress("dcbspares@gmail.com"), true);
  assert.equal(isGmailAddress("gary@dcbspares.co.za"), false);
  assert.equal(isSendingProvider("GMAIL_APP"), true);
});

test("the free email check needs no key and rejects scraping leftovers", () => {
  assert.deepEqual(verificationSetup({ EMAIL_VERIFICATION_PROVIDER: "domain" }), { provider: "domain" });
  assert.equal(verificationSetup({}), null);
  assert.equal(freeAddressCheck("sales@forklifthire.co.za").status, "VALID");
  assert.equal(freeAddressCheck("logo@2x.png").status, "INVALID");
  assert.equal(freeAddressCheck("you@yourdomain.com").status, "INVALID");
  assert.equal(freeAddressCheck("info@example.com").status, "INVALID");
  assert.equal(freeAddressCheck("x@mailinator.com").status, "INVALID");
});
