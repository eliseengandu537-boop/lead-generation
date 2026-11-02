import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import {
  renderRuntimeEnvironment,
  waitForRenderDatabase,
} from "./render-runtime.mjs";

const mode = process.argv[2] || "check";
const configPath = resolve(".local/hosted-worker.env");
let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { env, stdio: "inherit", windowsHide: true });
    child.once("error", () =>
      reject(
        new Error("Could not start local automation. Check Docker and Node."),
      ),
    );
    child.once("exit", (code) => {
      child = undefined;
      if (code === 0 || stopping) resolve();
      else
        reject(
          new Error("Local automation exited. Review the service status."),
        );
    });
  });
}
async function main() {
  if (!["check", "start", "stop"].includes(mode))
    throw new Error("Choose check, start or stop");
  let stored;
  try {
    stored = parseEnv(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(
      "The hosted worker is not connected yet. Configure .local/hosted-worker.env; your existing .env is preserved.",
    );
  }
  const env = renderRuntimeEnvironment({
    ...process.env,
    ...stored,
    NODE_ENV: "production",
    ORBIT_AUTOMATION_LOCATION: "local",
    WORKER_POLL_MS: stored.WORKER_POLL_MS || "60000",
  });
  const n8n = new URL(env.N8N_BASE_URL || "http://127.0.0.1:5678");
  if (
    n8n.origin !== "http://127.0.0.1:5678" ||
    n8n.pathname !== "/" ||
    n8n.search ||
    n8n.hash
  )
    throw new Error("Local automation must use http://127.0.0.1:5678");
  env.N8N_BASE_URL = n8n.origin;
  if (
    !env.N8N_WEBHOOK_SECRET ||
    env.N8N_WEBHOOK_SECRET.length < 32 ||
    !env.N8N_ENCRYPTION_KEY ||
    env.N8N_ENCRYPTION_KEY.length < 32
  )
    throw new Error(
      "Configure stable n8n authentication and encryption secrets",
    );
  delete env.BOOTSTRAP_ADMIN_PASSWORD;
  delete env.BOOTSTRAP_ADMIN_EMAIL;
  if (mode === "check") {
    console.log(
      "Local worker configuration is valid. Connectivity and workflow activation must be verified separately.",
    );
    return;
  }
  const compose = [
    "compose",
    "--project-name",
    "orbit-local-automation",
    "-f",
    "docker-compose.n8n.local.yml",
  ];
  if (mode === "stop") {
    await run("docker", [...compose, "stop"], env);
    return;
  }
  await run("docker", [...compose, "up", "-d"], env);
  if (stopping) return;
  await waitForRenderDatabase(env);
  if (stopping) return;
  console.log(
    "Starting automation for the hosted app. Keep this computer awake. Press Ctrl+C to stop the worker.",
  );
  await run(process.execPath, ["--import", "tsx", "src/worker.ts"], env);
}
main().catch((error) => {
  // Runtime and credential errors may include SQL/connection strings. Only
  // explicitly written setup messages are safe to display here.
  console.error(
    error.message?.startsWith("The hosted worker") ||
      error.message?.startsWith("Choose ") ||
      error.message?.startsWith("Local automation") ||
      error.message?.startsWith("Configure stable") ||
      error.message?.startsWith("Could not start")
      ? error.message
      : "Local automation could not initialize. Check its private configuration, Docker and hosted database readiness.",
  );
  process.exitCode = 1;
});
