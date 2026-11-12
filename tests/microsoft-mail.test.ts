import test from "node:test";
import assert from "node:assert/strict";
import { googleRawMessage, mimeMessage } from "../src/platform/mail/google";
import {
  createGraphDraft,
  grantedMailScopes,
  graphDeliveryFailure,
  graphMessageIds,
  graphSentCopy,
  type GraphMessage,
} from "../src/platform/mail/microsoft";

const mail = {
  from: "gary@dcbspares.example",
  to: "owner@workshop.example",
  subject: "Quick question for Workshop",
  body: "Hello team,\n\nMay we email you?",
  rfcMessageId: "<abc123@dcbspares.example>",
  unsubscribeUrl: "https://crm.example/api/platform/unsubscribe?messageId=1",
};

test("Gmail and Microsoft 365 send the same MIME message in their own encodings", () => {
  const mime = mimeMessage(mail);
  assert.match(mime, /^From: gary@dcbspares\.example\r\nTo: owner@workshop\.example\r\n/);
  assert.match(mime, /\r\nMessage-ID: <abc123@dcbspares\.example>\r\n/);
  assert.match(mime, /\r\nList-Unsubscribe: <https:\/\/crm\.example\/api\/platform\/unsubscribe\?messageId=1>\r\n/);
  assert.equal(Buffer.from(googleRawMessage(mail), "base64url").toString(), mime);
  assert.throws(() => mimeMessage({ ...mail, subject: "Two\r\nBcc: x@y.example" }));
});

test("Microsoft drafts are created from base64 MIME with immutable IDs", async () => {
  let call: { url: string; init?: RequestInit } | undefined;
  const draft = await createGraphDraft("token", mimeMessage(mail), (async (url: string, init?: RequestInit) => {
    call = { url: String(url), init };
    return Response.json(
      { id: "AAkALg-immutable", conversationId: "conv-1", internetMessageId: "<x@prod.outlook.com>", isDraft: true },
      { status: 201 },
    );
  }) as typeof fetch);
  assert.equal(draft.id, "AAkALg-immutable");
  assert.equal(call!.url, "https://graph.microsoft.com/v1.0/me/messages");
  assert.equal(call!.init?.method, "POST");
  const headers = new Headers(call!.init?.headers);
  assert.equal(headers.get("Content-Type"), "text/plain");
  assert.equal(headers.get("Authorization"), "Bearer token");
  assert.match(headers.get("Prefer")!, /IdType="ImmutableId"/);
  assert.equal(Buffer.from(String(call!.init?.body), "base64").toString(), mimeMessage(mail));
});

test("a sent copy is found by immutable ID; drafts and missing items are not treated as sent", async () => {
  const reply = (status: number, body: unknown) =>
    (async () => (status === 200 ? Response.json(body) : new Response("", { status }))) as typeof fetch;
  assert.deepEqual(
    await graphSentCopy("t", "id1", reply(200, { id: "id1", conversationId: "c", isDraft: false })),
    { id: "id1", conversationId: "c", isDraft: false },
  );
  assert.equal(await graphSentCopy("t", "id1", reply(200, { id: "id1", conversationId: "c", isDraft: true })), null);
  assert.equal(await graphSentCopy("t", "id1", reply(404, {})), null);
  await assert.rejects(graphSentCopy("t", "id1", reply(503, {})), /HTTP 503/);
});

test("inbox listing follows Graph paging and reports an incomplete backlog", async () => {
  const pages: string[] = [];
  const request = (async (url: string) => {
    pages.push(String(url));
    return Response.json(
      pages.length === 1
        ? { value: [{ id: "m1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=2" }
        : { value: [{ id: "m2" }] },
    );
  }) as typeof fetch;
  const after = new Date("2026-11-12T06:00:00Z");
  assert.deepEqual(await graphMessageIds("t", after, request), { ids: ["m1", "m2"], complete: true });
  assert.match(pages[0], /receivedDateTime ge 2026-11-12T06:00:00\.000Z/);
  assert.equal(pages[1], "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=2");
  const endless = (async () =>
    Response.json({ value: [{ id: "x" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=n" })) as typeof fetch;
  assert.equal((await graphMessageIds("t", after, endless, 3)).complete, false);
});

test("only Exchange non-delivery reports count as bounces, with 4.x.x treated as temporary", () => {
  const message = (kind: string | null, body: string): GraphMessage => ({
    id: "m",
    receivedDateTime: "2026-11-12T08:00:00Z",
    body: { content: body },
    singleValueExtendedProperties: kind === null ? null : [{ id: "String 0x001A", value: kind }],
  });
  assert.deepEqual(graphDeliveryFailure(message("REPORT.IPM.Note.NDR", "Remote server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'")), {
    kind: "BOUNCE",
    detail: "Exchange non-delivery report 5.1.10",
  });
  assert.equal(graphDeliveryFailure(message("REPORT.IPM.Note.NDR", "Mailbox full 4.2.2"))?.kind, "SOFT_BOUNCE");
  assert.equal(graphDeliveryFailure(message("REPORT.IPM.Note.NDR", "No code given"))?.kind, "BOUNCE");
  // A scary subject or body on an ordinary message is not evidence of a bounce.
  assert.equal(graphDeliveryFailure(message("IPM.Note", "Undeliverable 5.1.1")), null);
  assert.equal(graphDeliveryFailure(message(null, "Undeliverable 5.1.1")), null);
  assert.equal(graphDeliveryFailure(message("REPORT.IPM.Note.IPNRN", "read receipt")), null);
});

test("Microsoft consent must include both mail permissions", () => {
  assert.ok(
    grantedMailScopes(
      "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read",
    ),
  );
  assert.ok(grantedMailScopes("Mail.Send Mail.ReadWrite offline_access"));
  assert.equal(grantedMailScopes("https://graph.microsoft.com/Mail.Send"), false);
  assert.equal(grantedMailScopes(undefined), false);
});
