import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const runtime = import("../scripts/render-runtime.mjs");
test("Render startup derives a restricted URL and stable shared encryption without exposing secrets", async () => {
  const { renderRuntimeEnvironment } = await runtime;
  const input = {
    DATABASE_URL:
      "postgresql://owner:fixture@db.internal/orbit?sslmode=require",
    NEXTAUTH_SECRET: "a".repeat(44),
    PLATFORM_ENCRYPTION_SEED: "b".repeat(44),
    TENANT_DATABASE_PASSWORD: "quoted/'" + "c".repeat(40),
    RENDER_EXTERNAL_URL: "https://orbit.onrender.com",
  };
  const env = renderRuntimeEnvironment(input);
  const tenant = new URL(env.TENANT_DATABASE_URL!);
  assert.equal(tenant.username, "orbit_tenant_runtime");
  assert.equal(
    decodeURIComponent(tenant.password),
    input.TENANT_DATABASE_PASSWORD,
  );
  assert.equal(tenant.searchParams.get("sslmode"), "require");
  assert.equal(tenant.searchParams.get("connection_limit"), "5");
  assert.equal(
    env.ENCRYPTION_KEY,
    createHash("sha256").update(input.PLATFORM_ENCRYPTION_SEED).digest("hex"),
  );
  assert.equal(env.NEXTAUTH_URL, input.RENDER_EXTERNAL_URL);
  assert.equal("TENANT_DATABASE_URL" in input, false);
});
test("Render startup refuses missing secrets and a non-HTTPS public origin", async () => {
  const { renderRuntimeEnvironment } = await runtime;
  assert.throws(() => renderRuntimeEnvironment({}), /DATABASE_URL/);
  assert.throws(
    () =>
      renderRuntimeEnvironment({
        DATABASE_URL: "postgresql://owner@db/orbit",
        NEXTAUTH_URL: "http://localhost:3100",
      }),
    /HTTPS/,
  );
});
