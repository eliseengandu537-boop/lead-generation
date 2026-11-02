import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEmailConfig,
  accountEmailRetryWindowMs,
  deliverAccountEmail,
} from "../src/lib/account-email";

const message = {
  id: "verification-fixture-one",
  to: "client@example.com",
  subject: "Verify your Concrete account",
  body: "Verify your account using the single-use link.",
};
const brevo = {
  provider: "BREVO" as const,
  apiKey: "fixture-brevo-private-key",
  sender: "owner@example.com",
};

test("account email requires the selected provider's key and a valid sender", () => {
  assert.equal(accountEmailConfig({}), null);
  assert.equal(
    accountEmailConfig({
      IDENTITY_EMAIL_PROVIDER: "BREVO",
      RESEND_API_KEY: "other-provider",
      IDENTITY_FROM_EMAIL: brevo.sender,
    }),
    null,
  );
  assert.equal(
    accountEmailConfig({
      IDENTITY_EMAIL_PROVIDER: "UNKNOWN",
      RESEND_API_KEY: "key",
      IDENTITY_FROM_EMAIL: brevo.sender,
    }),
    null,
  );
  assert.equal(
    accountEmailConfig({
      BREVO_API_KEY: brevo.apiKey,
      IDENTITY_EMAIL_PROVIDER: "BREVO",
      IDENTITY_FROM_EMAIL: "Concrete <owner@example.com>",
    }),
    null,
  );
  assert.deepEqual(
    accountEmailConfig({
      BREVO_API_KEY: brevo.apiKey,
      IDENTITY_EMAIL_PROVIDER: "BREVO",
      IDENTITY_FROM_EMAIL: brevo.sender,
    }),
    brevo,
  );
  assert.equal(
    accountEmailConfig({
      RESEND_API_KEY: "key",
      IDENTITY_FROM_EMAIL: brevo.sender,
    })?.provider,
    "RESEND",
  );
});

test("Brevo uses its HTTPS API and stable per-message UUID deduplication", async () => {
  const keys: string[] = [];
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("api-key"), brevo.apiKey);
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.sender, { name: "Concrete", email: brevo.sender });
    assert.deepEqual(body.to, [{ email: message.to }]);
    assert.equal(body.textContent, message.body);
    assert.ok(!JSON.stringify(body).includes(brevo.apiKey));
    assert.match(
      body.headers.idempotencyKey,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    keys.push(body.headers.idempotencyKey);
    return Response.json({ messageId: "provider-accepted" }, { status: 201 });
  };
  await deliverAccountEmail(brevo, message, request);
  await deliverAccountEmail(brevo, message, request);
  await deliverAccountEmail(
    brevo,
    { ...message, id: "different-verification" },
    request,
  );
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("Resend retains its original idempotency key and authorizes only through headers", async () => {
  const config = { ...brevo, provider: "RESEND" as const };
  await deliverAccountEmail(config, message, async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${config.apiKey}`);
    assert.equal(headers.get("Idempotency-Key"), `identity/${message.id}`);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.from, `Concrete <${config.sender}>`);
    assert.equal(body.text, message.body);
    return Response.json({ id: "provider-accepted" });
  });
});

test("provider rejection cannot become success or expose returned secrets", async () => {
  await assert.rejects(
    deliverAccountEmail(brevo, message, async () =>
      Response.json({ message: brevo.apiKey }, { status: 401 }),
    ),
    (error) =>
      error instanceof Error &&
      /HTTP 401/.test(error.message) &&
      !error.message.includes(brevo.apiKey),
  );
  await assert.rejects(
    deliverAccountEmail(brevo, message, async () => Response.json({})),
    /request failed/,
  );
});

test("only a provider-confirmed idempotency duplicate is accepted as a prior send", async () => {
  assert.deepEqual(
    await deliverAccountEmail(brevo, message, async () =>
      Response.json(
        {
          code: "duplicate_parameter",
          message: "idempotencyKey has already been used",
        },
        { status: 400 },
      ),
    ),
    { accepted: true, duplicate: true },
  );
  await assert.rejects(
    deliverAccountEmail(brevo, message, async () =>
      Response.json(
        { code: "duplicate_parameter", message: "Other duplicate field" },
        { status: 400 },
      ),
    ),
    /request failed/,
  );
});

test("retry retention stays within the selected provider's deduplication period", () => {
  assert.ok(accountEmailRetryWindowMs("BREVO") < 15 * 60_000);
  assert.ok(accountEmailRetryWindowMs("RESEND") < 24 * 3_600_000);
});
