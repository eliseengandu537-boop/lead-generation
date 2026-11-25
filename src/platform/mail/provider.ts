import { db } from "@/lib/db";
import { gmailToken } from "./google";
import { microsoftToken } from "./microsoft";
import { appPasswordCredentials, type AppPasswordCredentials } from "./app-password";

/** Mailbox providers that can send client outreach. GMAIL_APP is a personal Gmail connected with
 * an App Password (SMTP and IMAP) instead of Google OAuth. */
export const sendingProviders = ["GMAIL", "MICROSOFT", "GMAIL_APP"] as const;
export type SendingProvider = (typeof sendingProviders)[number];
export const isSendingProvider = (provider: string): provider is SendingProvider =>
  (sendingProviders as readonly string[]).includes(provider);
export const providerName = (provider: string) =>
  provider === "MICROSOFT" ? "Microsoft 365" : "Gmail";

export type MailboxAccess =
  | { provider: "GMAIL" | "MICROSOFT"; token: string }
  | { provider: "GMAIL_APP"; token: ""; credentials: AppPasswordCredentials };

export async function mailboxAccess(
  workspaceId: string,
  mailboxId: string,
  request: typeof fetch = fetch,
): Promise<MailboxAccess> {
  const mailbox = await db.platformMailbox.findFirst({
    where: { id: mailboxId, workspaceId },
    select: { provider: true },
  });
  if (!mailbox || !isSendingProvider(mailbox.provider))
    throw new Error("Email account is disconnected or requires authorization");
  if (mailbox.provider === "GMAIL_APP")
    return {
      provider: "GMAIL_APP",
      token: "",
      credentials: await appPasswordCredentials(workspaceId, mailboxId),
    };
  return mailbox.provider === "MICROSOFT"
    ? { provider: "MICROSOFT", token: await microsoftToken(workspaceId, mailboxId, request) }
    : { provider: "GMAIL", token: await gmailToken(workspaceId, mailboxId, request) };
}
