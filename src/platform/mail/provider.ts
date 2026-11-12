import { db } from "@/lib/db";
import { gmailToken } from "./google";
import { microsoftToken } from "./microsoft";

/** Mailbox providers that can send client outreach. */
export const sendingProviders = ["GMAIL", "MICROSOFT"] as const;
export type SendingProvider = (typeof sendingProviders)[number];
export const isSendingProvider = (provider: string): provider is SendingProvider =>
  (sendingProviders as readonly string[]).includes(provider);
export const providerName = (provider: string) =>
  provider === "MICROSOFT" ? "Microsoft 365" : "Gmail";

export async function mailboxAccess(
  workspaceId: string,
  mailboxId: string,
  request: typeof fetch = fetch,
) {
  const mailbox = await db.platformMailbox.findFirst({
    where: { id: mailboxId, workspaceId },
    select: { provider: true },
  });
  if (!mailbox || !isSendingProvider(mailbox.provider))
    throw new Error("Email account is disconnected or requires authorization");
  return {
    provider: mailbox.provider,
    token:
      mailbox.provider === "MICROSOFT"
        ? await microsoftToken(workspaceId, mailboxId, request)
        : await gmailToken(workspaceId, mailboxId, request),
  };
}
export type MailboxAccess = Awaited<ReturnType<typeof mailboxAccess>>;
