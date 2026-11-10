import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEmailConfig,
  accountEmailConfigured,
  accountEmailRetryWindowMs,
  deliverAccountEmail,
} from "../src/lib/account-email";

const message = {
  id: "verification-fixture-one",
  to: "client@example.com",
  subject: "Verify your Monettic account",
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
      IDENTITY_FROM_EMAIL: "Monettic <owner@example.com>",
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

test("SMTP requires encrypted transport settings and credentials", () => {
  const env = {
    IDENTITY_EMAIL_PROVIDER: "SMTP",
    IDENTITY_FROM_EMAIL: "owner@example.com",
    SMTP_HOST: "smtp-relay.brevo.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "fixture@smtp-brevo.com",
    SMTP_PASSWORD: "fixture-private-smtp-key",
  };
  assert.equal(accountEmailConfig(env)?.provider, "SMTP");
  for (const change of [
    { SMTP_PASSWORD: "" },
    { SMTP_USER: "" },
    { SMTP_PORT: "25" },
    { SMTP_SECURE: "true" },
    { SMTP_HOST: "localhost" },
    { SMTP_HOST: "https://smtp-relay.brevo.com" },
    { SMTP_PASSWORD: "key\r\ninjected" },
  ])
    assert.equal(accountEmailConfig({ ...env, ...change }), null);
  assert.equal(
    accountEmailConfig({ ...env, SMTP_PORT: "465", SMTP_SECURE: "true" })
      ?.provider,
    "SMTP",
  );
  assert.equal(
    accountEmailConfigured({
      IDENTITY_EMAIL_PROVIDER: "SMTP",
      IDENTITY_FROM_EMAIL: env.IDENTITY_FROM_EMAIL,
    }),
    false,
  );
  assert.equal(
    accountEmailConfigured({
      IDENTITY_EMAIL_PROVIDER: "SMTP",
      IDENTITY_FROM_EMAIL: env.IDENTITY_FROM_EMAIL,
      IDENTITY_SMTP_READY: "true",
    }),
    true,
  );
  assert.equal(
    accountEmailConfig({
      IDENTITY_EMAIL_PROVIDER: "SMTP",
      IDENTITY_FROM_EMAIL: env.IDENTITY_FROM_EMAIL,
      IDENTITY_SMTP_READY: "true",
    }),
    null,
  );
});

test("SMTP confirms the intended recipient and keeps uncertain sends out of automatic replay", async () => {
  const { deliverSmtpAccountEmail, smtpTransportOptions } =
    await import("../src/lib/account-smtp");
  const config = {
    provider: "SMTP" as const,
    sender: "owner@example.com",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    username: "fixture@smtp-brevo.com",
    password: "fixture-private-smtp-key",
  };
  const options = smtpTransportOptions(config);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls?.rejectUnauthorized, true);
  assert.equal(options.logger, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  let closed = 0;
  let attempts = 0;
  const identifiers: string[] = [];
  const successful = () => ({
    sendMail: async (mail: {
      messageId?: string;
      from?: unknown;
      to?: unknown;
    }) => {
      attempts++;
      assert.equal(mail.to, message.to);
      assert.deepEqual(mail.from, { name: "Monettic", address: config.sender });
      identifiers.push(mail.messageId || "");
      return { accepted: [message.to], rejected: [] };
    },
    close: () => {
      closed++;
    },
  });
  assert.deepEqual(await deliverSmtpAccountEmail(config, message, successful), {
    accepted: true,
    duplicate: false,
  });
  await deliverSmtpAccountEmail(config, message, successful);
  assert.equal(identifiers[0], identifiers[1]);
  assert.match(identifiers[0], /^<[a-f0-9]{64}@example\.com>$/);
  await assert.rejects(
    deliverSmtpAccountEmail(config, message, () => ({
      sendMail: async () => {
        attempts++;
        throw new Error(config.password);
      },
      close: () => {
        closed++;
      },
    })),
    (error) =>
      error instanceof Error &&
      /automatic replay is blocked/.test(error.message) &&
      !error.message.includes(config.password),
  );
  assert.equal(attempts, 3);
  assert.equal(closed, 3);
  await assert.rejects(
    deliverSmtpAccountEmail(config, message, () => ({
      sendMail: async () => ({
        accepted: ["different@example.com"],
        rejected: [],
      }),
      close: () => {},
    })),
    /not confirmed/,
  );
});

test("Brevo uses its HTTPS API and stable per-message UUID deduplication", async () => {
  const keys: string[] = [];
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("api-key"), brevo.apiKey);
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.sender, { name: "Monettic", email: brevo.sender });
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
    assert.equal(body.from, `Monettic <${config.sender}>`);
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
