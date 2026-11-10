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
    "Monettic worker started. Public prospecting and admin account emails run directly. Other provider jobs require n8n admission; campaign sending requires client approval.",
  );
  async function loop(name: string, tick: () => Promise<unknown>) {
    while (!stopping) {
      try {
        await tick();
      } catch {
        console.error(
          `${name} cycle failed. Existing queued work is retained.`,
        );
      }
      if (!stopping)
        await pause(interval, undefined, { signal: shutdown.signal }).catch(
          () => {},
        );
    }
  }
  // A slow public-data query or unavailable orchestration endpoint must not
  // delay booking notifications. Each queue has independent durable claims.
  await Promise.all([
    loop("Platform jobs", workerTick),
    loop("Account notifications", sendIdentityEmails),
    loop("Calling prospects", prospectingTick),
  ]);
  await db.$disconnect();
}
main().catch(() => {
  console.error(
    "Monettic worker could not initialize. Check database configuration.",
  );
  process.exitCode = 1;
});
