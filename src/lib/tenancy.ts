import { AsyncLocalStorage } from "node:async_hooks";

export type TenantDatabaseContext = {
  workspaceId: string;
  capability?: Promise<{ token: string; expiresAt: number }>;
};
type RequestContext = { tenant?: TenantDatabaseContext };
const storage = new AsyncLocalStorage<RequestContext>();

/** A fresh mutable context belongs to exactly one HTTP handler invocation. */
export function withDatabaseRequest<T>(callback: () => Promise<T>) {
  return storage.run({}, callback);
}

export function databaseContext() {
  return storage.getStore()?.tenant;
}

/** Only call after membership and workspace status have been authorized. */
export function bindTenantDatabase(workspaceId: string) {
  const context = storage.getStore();
  if (!context)
    throw new Error(
      "Tenant authorization requires an isolated database request context",
    );
  if (context.tenant && context.tenant.workspaceId !== workspaceId)
    throw new Error("A request cannot switch its authorized workspace");
  if (!workspaceId) throw new Error("A workspace ID is required");
  context.tenant = { workspaceId };
}

/** Workers can restrict a single previously claimed tenant operation. */
export function withTenantDatabase<T>(
  workspaceId: string,
  callback: () => Promise<T>,
) {
  const current = databaseContext();
  if (current && current.workspaceId !== workspaceId)
    throw new Error("A tenant operation cannot switch workspaces");
  if (!workspaceId) throw new Error("A workspace ID is required");
  return storage.run({ tenant: { workspaceId } }, callback);
}
