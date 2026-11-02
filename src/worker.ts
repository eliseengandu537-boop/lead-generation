import { workerTick } from "./platform/worker";
import { sendIdentityEmails } from "./lib/identity";
import { db, assertTenantDatabase } from "./lib/db";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  await assertTenantDatabase();
  console.log(
    "Orbit worker started. Provider work requires authenticated n8n admission; real email also requires explicit client approval.",
  );
  while (!stopping) {
    try {
      await workerTick();
      await sendIdentityEmails();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Worker cycle failed",
      );
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await db.$disconnect();
}
main().catch(() => {
  console.error(
    "Orbit worker could not initialize. Check database configuration.",
  );
  process.exitCode = 1;
});
