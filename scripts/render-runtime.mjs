import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash as passwordHash } from "bcryptjs";

const tenantRole = "orbit_tenant_runtime";
/** @param {Record<string, string | undefined>} input */
export function renderRuntimeEnvironment(input = process.env) {
  const env = { ...input };
  if (!env.DATABASE_URL)
    throw new Error("A PostgreSQL DATABASE_URL is required");
  const owner = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(owner.protocol))
    throw new Error("Use a PostgreSQL connection URL");
  if (!env.NEXTAUTH_URL && env.RENDER_EXTERNAL_URL)
    env.NEXTAUTH_URL = env.RENDER_EXTERNAL_URL;
  if (!env.NEXTAUTH_URL || new URL(env.NEXTAUTH_URL).protocol !== "https:")
    throw new Error("Set the public HTTPS application URL");
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32)
    throw new Error("NEXTAUTH_SECRET must contain at least 32 characters");
  if (!env.ENCRYPTION_KEY && env.PLATFORM_ENCRYPTION_SEED?.length >= 32)
    env.ENCRYPTION_KEY = createHash("sha256")
      .update(env.PLATFORM_ENCRYPTION_SEED)
      .digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || ""))
    throw new Error(
      "Configure a stable encryption key or generated encryption seed",
    );
  if (!env.TENANT_DATABASE_URL) {
    if (
      !env.TENANT_DATABASE_PASSWORD ||
      env.TENANT_DATABASE_PASSWORD.length < 32
    )
      throw new Error("A generated tenant database password is required");
    const tenant = new URL(owner);
    tenant.username = tenantRole;
    tenant.password = env.TENANT_DATABASE_PASSWORD;
    tenant.searchParams.set("connection_limit", "5");
    env.TENANT_DATABASE_URL = tenant.toString();
  }
  owner.searchParams.set("connection_limit", "5");
  env.DATABASE_URL = owner.toString();
  return env;
}

export async function bootstrapRenderDatabase(env) {
  const database = new PrismaClient({
    datasourceUrl: env.CONTROL_DATABASE_URL || env.DATABASE_URL,
  });
  try {
    // This is the dedicated deployment owner connection. Tenant traffic never
    // receives its credentials; the app binds the restricted pool after auth.
    if (env.TENANT_DATABASE_PASSWORD) {
      const password = env.TENANT_DATABASE_PASSWORD;
      if (
        password.length < 32 ||
        password.length > 256 ||
        /[\u0000\r\n]/.test(password)
      )
        throw new Error("Invalid runtime database password configuration");
      await database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('orbit-runtime-provisioning'))`;
        const exists =
          await tx.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname = ${tenantRole}`;
        // Fixed role identifier, escaped SQL literal; never log this statement.
        const literal = "'" + password.replaceAll("'", "''") + "'";
        await tx.$executeRawUnsafe(
          `${exists.length ? "ALTER" : "CREATE"} ROLE orbit_tenant_runtime LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`,
        );
        await tx.$executeRawUnsafe(
          "REVOKE crm_control FROM orbit_tenant_runtime",
        );
        await tx.$executeRawUnsafe("GRANT crm_tenant TO orbit_tenant_runtime");
      });
    }
    const count = await database.user.count();
    if (count === 0) {
      const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase(),
        password = env.BOOTSTRAP_ADMIN_PASSWORD || "";
      if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 16 ||
        password.length > 128
      )
        throw new Error(
          "Set the initial administrator email and a 16+ character password in Render before first startup",
        );
      const digest = await passwordHash(password, 12);
      await database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('orbit-first-administrator'))`;
        if (await tx.user.count()) return;
        await tx.user.create({
          data: {
            email,
            name: "Platform administrator",
            passwordHash: digest,
            agencyAdmin: true,
            emailVerifiedAt: new Date(),
          },
        });
      });
      console.log(
        "Initial platform administrator created. Remove the bootstrap password from Render after signing in.",
      );
    }
  } finally {
    await database.$disconnect();
  }
}

export async function waitForRenderDatabase(env) {
  const client = new PrismaClient({ datasourceUrl: env.TENANT_DATABASE_URL });
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await client.platformOrganization.count();
        return;
      } catch {
        if (!attempt)
          console.log(
            "Waiting for the web service to finish migrations and tenant-role provisioning.",
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(
      "Database bootstrap did not become ready within five minutes",
    );
  } finally {
    await client.$disconnect();
  }
}
