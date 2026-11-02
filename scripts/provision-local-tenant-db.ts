import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

// Development convenience only. Production credentials belong in the host's
// secret store and must be provisioned by the database administrator.
async function main() {
  const base = new URL(process.env.DATABASE_URL || "");
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error(
      "This command only provisions a local development database",
    );
  const database = new PrismaClient();
  try {
    const [installed] = await database.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regprocedure('public.crm_current_workspace()') IS NOT NULL AS ready
    `;
    if (!installed?.ready)
      throw new Error("Apply the tenant RLS migration first");
    const login = "crm_tenant_runtime";
    const password = randomBytes(32).toString("hex");
    const exists = await database.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = ${login}
    `;
    // Fixed identifier and hex-only generated password, never user input.
    await database.$executeRawUnsafe(
      `${exists.length ? "ALTER" : "CREATE"} ROLE crm_tenant_runtime LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`,
    );
    await database.$executeRawUnsafe("GRANT crm_tenant TO crm_tenant_runtime");
    base.username = login;
    base.password = password;
    base.searchParams.set("connection_limit", "5");
    const content = await readFile(".env", "utf8");
    const next = content
      .replace(/^TENANT_DATABASE_URL=.*\r?\n?/gm, "")
      .trimEnd();
    await writeFile(
      ".env",
      `${next}\nTENANT_DATABASE_URL="${base.toString()}"\n`,
    );
    console.log(
      "Restricted local tenant login provisioned; TENANT_DATABASE_URL saved in ignored .env.",
    );
  } finally {
    await database.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Tenant provisioning failed",
  );
  process.exitCode = 1;
});
