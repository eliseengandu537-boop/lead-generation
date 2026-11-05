import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { localAutomationEnvironment } from "./local-runtime.mjs";
import { waitForRenderDatabase } from "./render-runtime.mjs";

// Public prospecting and transactional notifications can run without Docker.
// General research/campaign jobs retain their existing n8n admission gates.
let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
async function main() {
  const stored = parseEnv(readFileSync(".local/hosted-worker.env", "utf8"));
  const env = localAutomationEnvironment(stored);
  const privateValues = Object.entries(env)
    .filter(
      ([key, value]) =>
        /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(key) &&
        value?.length >= 8,
    )
    .map(([, value]) => value);
  const redact = (value) => {
    let output = String(value);
    for (const secret of privateValues)
      output = output.replaceAll(secret, "[private]");
    return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[database URL]");
  };
  await waitForRenderDatabase(env);
  if (stopping) return;
  console.log(
    "Concrete hosted worker starting. Keep this computer awake for automatic leads and queued admin notifications.",
  );
  child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (value) => process.stdout.write(redact(value)));
  child.stderr.on("data", (value) => process.stderr.write(redact(value)));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0 && !stopping) throw new Error("Worker exited.");
}
main().catch(() => {
  console.error(
    "Concrete hosted worker could not start or stopped. Check its private configuration and database connectivity.",
  );
  process.exitCode = 1;
});
