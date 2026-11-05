import { workerTick } from "./platform/worker";
import { sendIdentityEmails } from "./lib/identity";
import { prospectingTick } from "./platform/calling/prospecting";
import { db, assertTenantDatabase } from "./lib/db";
import { setTimeout as pause } from "node:timers/promises";
let stopping = false;
const shutdown = new AbortController();
process.on("SIGINT", () => {
  stopping = true;
  shutdown.abort();
});
process.on("SIGTERM", () => {
  stopping = true;
  shutdown.abort();
});
async function main() {
  const interval = Number(process.env.WORKER_POLL_MS || 3000);
  if (!Number.isInteger(interval) || interval < 3000 || interval > 900000)
    throw new Error("WORKER_POLL_MS must be between 3000 and 900000");
  await assertTenantDatabase();
  console.log(
    "Concrete worker started. Public prospecting and admin account emails run directly. Other provider jobs require n8n admission; campaign sending requires client approval.",
  );
  while (!stopping) {
    try {
      await workerTick();
      await sendIdentityEmails();
      await prospectingTick();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Worker cycle failed",
      );
    }
    if (!stopping)
      await pause(interval, undefined, { signal: shutdown.signal }).catch(
        () => {},
      );
  }
  await db.$disconnect();
}
main().catch(() => {
  console.error(
    "Concrete worker could not initialize. Check database configuration.",
  );
  process.exitCode = 1;
});
