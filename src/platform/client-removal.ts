import { Prisma } from "@prisma/client";
import { z } from "zod";
import { controlDb } from "@/lib/db";
import { HttpError } from "@/lib/auth";

/*
 * Deleting a client removes everything that belongs to it: the workspace, its organization and
 * every platform record (leads, campaigns, emails, replies, inboxes, jobs, plan, usage), any data
 * left from the older app, and the client's own logins. Agency administrators and agency staff
 * (callers) keep their accounts; only their access to this client goes.
 */

// Older tables whose links block a cascading delete, or that have no link at all: cleared first.
const CLEAR_FIRST = ["Enquiry", "Campaign", "OAuthState"] as const;
const identifier = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unexpected table name");
  return `"${name}"`;
};
const quoted = (table: string) => `public.${identifier(table)}`;

/** Every table that stores rows by client (current and older ones), with the column that holds it. */
async function clientTables(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<{ table: string; column: string }[]>`
    SELECT c.table_name AS "table", c.column_name AS "column"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name IN ('workspaceId', 'businessId')`;
}

export async function deleteClient(actorId: string, workspaceId: string, raw: unknown) {
  const { confirm } = z.object({ confirm: z.string() }).passthrough().parse(raw);
  if (confirm.trim() !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  const workspace = await controlDb.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      memberships: {
        select: {
          userId: true,
          user: {
            select: {
              agencyAdmin: true,
              staffRole: true,
              memberships: { select: { workspaceId: true } },
            },
          },
        },
      },
    },
  });
  if (!workspace) throw new HttpError(404, "This client no longer exists.");
  // Client and demo logins that only exist for this client go with it.
  const logins = workspace.memberships
    .filter(
      ({ user }) =>
        !user.agencyAdmin &&
        !user.staffRole &&
        user.memberships.every((membership) => membership.workspaceId === workspaceId),
    )
    .map((membership) => membership.userId);
  const removed = await controlDb.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      for (const table of CLEAR_FIRST) {
        const [{ exists }] = await tx.$queryRaw<{ exists: boolean }[]>`
          SELECT to_regclass(${quoted(table)}) IS NOT NULL AS "exists"`;
        if (exists)
          await tx.$executeRawUnsafe(`DELETE FROM ${quoted(table)} WHERE "workspaceId" = $1`, workspaceId);
      }
      await tx.workspace.delete({ where: { id: workspaceId } });
      const users = logins.length
        ? await tx.user.deleteMany({ where: { id: { in: logins }, agencyAdmin: false, staffRole: null } })
        : { count: 0 };
      // Nothing of this client may be left behind; otherwise undo the whole delete.
      for (const { table, column } of await clientTables(tx)) {
        const [{ rows }] = await tx.$queryRawUnsafe<{ rows: number }[]>(
          `SELECT count(*)::int AS rows FROM ${quoted(table)} WHERE ${identifier(column)} = $1`,
          workspaceId,
        );
        if (rows) throw new HttpError(409, `Could not remove everything (${table}). Nothing was deleted.`);
      }
      return users.count;
    },
    { maxWait: 15000, timeout: 120000 },
  );
  console.info(
    JSON.stringify({ event: "CLIENT_DELETED", workspaceId, name: workspace.name, actorId, loginsRemoved: removed }),
  );
  return {
    message: `${workspace.name} was deleted with all its leads, emails, replies and logins.`,
  };
}
