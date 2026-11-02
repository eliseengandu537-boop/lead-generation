import test from "node:test";
import assert from "node:assert/strict";
import { orchestrationConfig, dispatchOneJob } from "../src/platform/jobs";

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
