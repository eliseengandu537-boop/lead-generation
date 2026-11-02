import test from "node:test";
import assert from "node:assert/strict";
import { orchestrationConfig, dispatchOneJob } from "../src/platform/jobs";
import { createHash } from "node:crypto";

test("the hosted worker cannot inherit local database or encryption credentials", async () => {
  const { localAutomationEnvironment } =
    await import("../scripts/local-runtime.mjs");
  const stored = {
    DATABASE_URL:
      "postgresql://owner:fixture@ep-fixture.eu-central-1.aws.neon.tech/orbit?sslmode=require",
    NEXTAUTH_URL: "https://orbit.onrender.com",
    NEXTAUTH_SECRET: "a".repeat(44),
    PLATFORM_ENCRYPTION_SEED: "b".repeat(44),
    TENANT_DATABASE_PASSWORD: "c".repeat(44),
  };
  const env = localAutomationEnvironment(stored, {
    PATH: "system-path",
    TENANT_DATABASE_URL: "postgresql://unrelated@localhost/old",
    CONTROL_DATABASE_URL: "postgresql://unrelated@localhost/old",
    ENCRYPTION_KEY: "d".repeat(64),
    GOOGLE_CLIENT_SECRET: "unrelated-local-secret",
    BREVO_API_KEY: "unrelated-account-email-key",
    IDENTITY_EMAIL_PROVIDER: "BREVO",
    SMTP_PASSWORD: "unrelated-smtp-password",
    IDENTITY_SMTP_READY: "true",
    BOOTSTRAP_ADMIN_PASSWORD: "unrelated-password",
    LIVE_EMAIL_ENABLED: "true",
  });
  const tenant = new URL(env.TENANT_DATABASE_URL!);
  assert.equal(tenant.hostname, "ep-fixture-pooler.eu-central-1.aws.neon.tech");
  assert.equal(tenant.username, "orbit_tenant_runtime");
  assert.equal(env.CONTROL_DATABASE_URL, env.DATABASE_URL);
  assert.equal(
    env.ENCRYPTION_KEY,
    createHash("sha256").update(stored.PLATFORM_ENCRYPTION_SEED).digest("hex"),
  );
  assert.equal(env.GOOGLE_CLIENT_SECRET, "");
  assert.equal(env.BREVO_API_KEY, "");
  assert.equal(env.IDENTITY_EMAIL_PROVIDER, "");
  assert.equal(env.SMTP_PASSWORD, "");
  assert.equal(env.IDENTITY_SMTP_READY, "");
  assert.equal(env.BOOTSTRAP_ADMIN_PASSWORD, "");
  assert.equal(env.LIVE_EMAIL_ENABLED, "false");
  assert.equal(env.PATH, "system-path");
  assert.equal(new URL(stored.DATABASE_URL).hostname.includes("pooler"), false);
});

test("local automation keeps admission authentication on the web without dispatching to a fake endpoint", async () => {
  const keys = [
    "N8N_BASE_URL",
    "N8N_WEBHOOK_SECRET",
    "ORBIT_AUTOMATION_LOCATION",
    "NODE_ENV",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ORBIT_AUTOMATION_LOCATION = "local";
    process.env.N8N_WEBHOOK_SECRET =
      "fixture-local-automation-secret-32-characters";
    delete process.env.N8N_BASE_URL;
    assert.equal(orchestrationConfig()?.url, null);
    assert.equal(orchestrationConfig()?.location, "local");
    assert.equal(await dispatchOneJob(), false);
    process.env.N8N_BASE_URL = "http://127.0.0.1:5678";
    assert.equal(orchestrationConfig()?.url, "http://127.0.0.1:5678");
    for (const url of [
      "http://169.254.169.254",
      "http://private.example",
      "http://n8n",
      "https://user:pass@host.test",
      "https://host.test?token=secret",
    ]) {
      process.env.N8N_BASE_URL = url;
      assert.throws(() => orchestrationConfig(), /trusted HTTPS/);
    }
    process.env.N8N_BASE_URL = "http://127.0.0.1:5678";
    process.env.ORBIT_AUTOMATION_LOCATION = "hosted";
    assert.throws(() => orchestrationConfig(), /trusted HTTPS/);
    delete process.env.N8N_BASE_URL;
    assert.equal(orchestrationConfig(), null);
    process.env.ORBIT_AUTOMATION_LOCATION = "local";
    process.env.N8N_WEBHOOK_SECRET = "short";
    assert.equal(orchestrationConfig(), null);
  } finally {
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: saved[key] });
  }
});
