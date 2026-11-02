import { PrismaClient, type Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { databaseContext, type TenantDatabaseContext } from "./tenancy";

type DatabaseGlobals = {
  prisma?: PrismaClient;
  tenantPrisma?: PrismaClient;
  tenantRoleCheck?: Promise<void>;
  tenantCleanupAt?: number;
};
const globalDb = globalThis as unknown as DatabaseGlobals;

// Authentication, bootstrap, public capabilities and cross-tenant discovery
// use this control pool. db switches to the restricted pool after tenant().
export const controlDb =
  globalDb.prisma ??
  new PrismaClient(
    process.env.CONTROL_DATABASE_URL
      ? { datasourceUrl: process.env.CONTROL_DATABASE_URL }
      : undefined,
  );
if (process.env.NODE_ENV !== "production") globalDb.prisma = controlDb;

function tenantClient() {
  const url = process.env.TENANT_DATABASE_URL;
  if (!url)
    throw new Error(
      "Tenant database is unavailable: configure TENANT_DATABASE_URL with a restricted crm_tenant role",
    );
  return (globalDb.tenantPrisma ??= new PrismaClient({ datasourceUrl: url }));
}

/** Verify that the runtime login cannot bypass the RLS policies. */
export async function assertTenantDatabase() {
  const client = tenantClient();
  if (!globalDb.tenantRoleCheck) {
    globalDb.tenantRoleCheck = (async () => {
      const [role] = await client.$queryRaw<
        {
          restricted: boolean;
          privileged: boolean;
          control: boolean;
          ownsTables: boolean;
        }[]
      >`
        SELECT pg_has_role(current_user, 'crm_tenant', 'MEMBER') AS restricted,
          (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS privileged,
          pg_has_role(current_user, 'crm_control', 'MEMBER') AS control,
          EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND pg_has_role(current_user, c.relowner, 'MEMBER')
          ) AS "ownsTables"
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      if (
        !role?.restricted ||
        role.privileged ||
        role.control ||
        role.ownsTables
      )
        throw new Error(
          "TENANT_DATABASE_URL must use a non-owner, non-privileged crm_tenant login without crm_control membership",
        );
      const [coverage] = await client.$queryRaw<{ missing: bigint }[]>`
        SELECT count(*) AS missing
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND (c.relname IN ('Workspace', 'User') OR EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'workspaceId' AND NOT a.attisdropped
          ))
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (
            SELECT 1 FROM pg_policy p
            WHERE p.polrelid = c.oid AND p.polname = 'crm_tenant_isolation'
          ))
      `;
      if (!coverage || coverage.missing !== BigInt(0))
        throw new Error(
          "Tenant RLS policies are incomplete; apply database migrations",
        );
    })().catch((error) => {
      delete globalDb.tenantRoleCheck;
      throw error;
    });
  }
  return globalDb.tenantRoleCheck;
}

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

async function tenantCapability(context: TenantDatabaseContext) {
  let capability = context.capability && (await context.capability);
  if (!capability || capability.expiresAt < Date.now() + 60_000) {
    context.capability = (async () => {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = Date.now() + 15 * 60_000;
      await controlDb.$executeRaw`
        INSERT INTO public."TenantDatabaseCapability" ("tokenHash", "tenantId", "expiresAt")
        VALUES (${tokenHash}, ${context.workspaceId}, ${new Date(expiresAt)})
      `;
      if (
        !globalDb.tenantCleanupAt ||
        globalDb.tenantCleanupAt < Date.now() - 60_000
      ) {
        globalDb.tenantCleanupAt = Date.now();
        await controlDb.$executeRaw`
          DELETE FROM public."TenantDatabaseCapability" WHERE "expiresAt" < now()
        `;
      }
      return { token, expiresAt };
    })();
    capability = await context.capability;
  }
  return capability;
}

async function scopedTransaction<T>(
  context: TenantDatabaseContext,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions,
) {
  await assertTenantDatabase();
  const capability = await tenantCapability(context);
  return tenantClient().$transaction(
    async (transaction) => {
      // true means transaction-local: pooled connections never retain a tenant.
      await transaction.$queryRaw`
        SELECT set_config('app.tenant_token', ${capability.token}, true)
      `;
      return callback(transaction);
    },
    { maxWait: 10_000, timeout: 30_000, ...options },
  );
}

type DynamicClient = Record<
  string,
  Record<string, (...args: unknown[]) => unknown>
>;
const delegates = new Map<string, object>();

// Select the pool at invocation, after tenant() has bound the request. Native
// transaction clients stay on the transaction's existing scoped connection.
export const db = new Proxy(controlDb, {
  get(target, property) {
    if (typeof property !== "string") return Reflect.get(target, property);
    if (property === "$disconnect")
      return async () => {
        await Promise.all([
          controlDb.$disconnect(),
          globalDb.tenantPrisma?.$disconnect(),
        ]);
        delete globalDb.tenantRoleCheck;
      };
    if (property === "$transaction")
      return (callback: unknown, options?: TransactionOptions) => {
        const context = databaseContext();
        if (!context)
          return Reflect.apply(target.$transaction, target, [
            callback,
            options,
          ]);
        if (typeof callback !== "function")
          throw new Error(
            "Tenant transactions require an interactive callback; array transactions are not supported",
          );
        return scopedTransaction(
          context,
          callback as (
            transaction: Prisma.TransactionClient,
          ) => Promise<unknown>,
          options,
        );
      };
    if (property.startsWith("$")) {
      return (...args: unknown[]) => {
        const context = databaseContext();
        if (!context)
          return Reflect.apply(Reflect.get(target, property), target, args);
        if (
          ![
            "$queryRaw",
            "$queryRawUnsafe",
            "$executeRaw",
            "$executeRawUnsafe",
          ].includes(property)
        )
          throw new Error(
            `Prisma ${property} is unavailable in tenant context`,
          );
        return scopedTransaction(context, async (transaction) =>
          Reflect.apply(Reflect.get(transaction, property), transaction, args),
        );
      };
    }
    if (!delegates.has(property))
      delegates.set(
        property,
        new Proxy(
          {},
          {
            get(_delegate, operation) {
              return (...args: unknown[]) => {
                const context = databaseContext();
                const invoke = (
                  client: PrismaClient | Prisma.TransactionClient,
                ) => {
                  const delegate = (client as unknown as DynamicClient)[
                    property
                  ];
                  return Reflect.apply(
                    delegate[operation as string],
                    delegate,
                    args,
                  );
                };
                return context
                  ? scopedTransaction(context, async (transaction) =>
                      invoke(transaction),
                    )
                  : invoke(target);
              };
            },
          },
        ),
      );
    return delegates.get(property);
  },
}) as PrismaClient;
