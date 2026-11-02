import { spawn } from "node:child_process";
import {
  renderRuntimeEnvironment,
  bootstrapRenderDatabase,
  waitForRenderDatabase,
} from "./render-runtime.mjs";

let active;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    active?.kill(signal);
  });
function run(args, env) {
  return new Promise((resolve, reject) => {
    active = spawn(process.execPath, args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    active.once("error", reject);
    active.once("exit", (code) => {
      active = undefined;
      code === 0 || stopping
        ? resolve()
        : reject(new Error("Deployment process exited unsuccessfully"));
    });
  });
}
async function main() {
  const mode = process.argv[2];
  if (!["web", "worker"].includes(mode))
    throw new Error("Choose web or worker startup");
  const env = renderRuntimeEnvironment();
  if (mode === "web") {
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
    if (stopping) return;
    await bootstrapRenderDatabase(env);
  } else await waitForRenderDatabase(env);
  if (stopping) return;
  await run(
    mode === "web"
      ? ["scripts/start.mjs"]
      : ["--import", "tsx", "src/worker.ts"],
    env,
  );
}
main().catch(() => {
  // Prisma role errors can embed the credential-bearing SQL. Keep bootstrap
  // details out of logs; required variable names are documented in the repo.
  console.error(
    "Orbit deployment startup failed. Check database permissions, migration status, public HTTPS URL and required Render secret settings.",
  );
  process.exitCode = 1;
});
