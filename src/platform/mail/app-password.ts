import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { HttpError } from "@/lib/auth";

/**
 * A personal Gmail inbox connected with a Google "App Password" instead of a Google Cloud OAuth
 * app: mail goes out through Gmail's SMTP server and replies and bounces are read over IMAP.
 * Gmail requires 2-Step Verification on the account before it offers App Passwords.
 */
export const APP_PASSWORD_PROVIDER = "GMAIL_APP";
const gmailDomains = new Set(["gmail.com", "googlemail.com"]);
const credentialsSchema = z.object({
  email: z.email(),
  appPassword: z.string().regex(/^[a-z]{16}$/),
});
export type AppPasswordCredentials = z.infer<typeof credentialsSchema>;

/** "abcd efgh ijkl mnop" as Google shows it → "abcdefghijklmnop", or null when it is not one. */
export function normalizeAppPassword(value: string) {
  const clean = value.replace(/\s+/g, "").toLowerCase();
  return /^[a-z]{16}$/.test(clean) ? clean : null;
}
export const isGmailAddress = (email: string) =>
  gmailDomains.has((email.split("@").pop() || "").toLowerCase());

function withTimeout<T>(work: Promise<T>, ms: number, what: string) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out`), { code: "ETIMEDOUT" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function openImap(credentials: AppPasswordCredentials) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: credentials.email, pass: credentials.appPassword },
    logger: false,
    disableAutoIdle: true,
  });
  // Without a listener an emitted socket error would end the process.
  client.on("error", () => undefined);
  await withTimeout(client.connect(), 30000, "Connecting to Gmail");
  return client;
}
async function closeImap(client: ImapFlow) {
  await withTimeout(client.logout(), 10000, "Closing the Gmail connection").catch(() => client.close());
}
const authFailure = (error: unknown) => {
  const value = error as { authenticationFailed?: boolean; responseText?: string; code?: string };
  return (
    !!value?.authenticationFailed ||
    value?.code === "EAUTH" ||
    /AUTHENTICATIONFAILED|Invalid credentials|Application-specific password/i.test(value?.responseText || "")
  );
};

/** Proves the App Password works by signing in to the inbox. A network problem is reported
 * separately, so a blocked connection is not mistaken for a wrong password. */
export async function checkAppPassword(credentials: AppPasswordCredentials) {
  try {
    await closeImap(await openImap(credentials));
    return { ok: true as const };
  } catch (error) {
    if (authFailure(error))
      throw new HttpError(
        400,
        "Gmail did not accept this App Password. Check the address, that 2-Step Verification is on, and create a new App Password.",
      );
    return { ok: false as const, reason: (error as Error)?.message || "Gmail could not be reached" };
  }
}

export async function appPasswordCredentials(workspaceId: string, mailboxId: string) {
  const mailbox = await db.platformMailbox.findFirst({
    where: {
      id: mailboxId,
      workspaceId,
      provider: APP_PASSWORD_PROVIDER,
      status: { in: ["CONNECTED", "LIVE_ENABLED"] },
    },
    select: { encryptedCredentials: true },
  });
  if (!mailbox) throw new Error("Email account is disconnected or requires authorization");
  return credentialsSchema.parse(JSON.parse(decrypt(mailbox.encryptedCredentials)));
}

/** A rejected App Password stops all sending from the inbox until it is reconnected. */
async function markReconnect(workspaceId: string, mailboxId: string) {
  await db.platformMailbox.updateMany({
    where: { id: mailboxId, workspaceId },
    data: {
      status: "RECONNECT_REQUIRED",
      syncError: "Gmail no longer accepts the App Password; create a new one and reconnect.",
    },
  });
}

/** Sends one prepared RFC 5322 message through Gmail's SMTP server. Gmail keeps the message's own
 * Message-ID and files a copy in Sent Mail. */
export async function appPasswordSend(
  workspaceId: string,
  mailboxId: string,
  credentials: AppPasswordCredentials,
  raw: string,
  envelope: { from: string; to: string },
) {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: credentials.email, pass: credentials.appPassword },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
  });
  try {
    const info = await transport.sendMail({ envelope, raw });
    if (!info.accepted?.length || info.rejected?.length)
      throw new Error("Gmail did not accept the recipient");
    return info;
  } catch (error) {
    if (authFailure(error)) await markReconnect(workspaceId, mailboxId);
    throw error;
  } finally {
    transport.close();
  }
}

async function folders(client: ImapFlow) {
  const list = await client.list();
  const find = (use: string, fallback: string) =>
    list.find((box) => box.specialUse === use)?.path ?? fallback;
  return { sent: find("\\Sent", "[Gmail]/Sent Mail"), junk: find("\\Junk", "[Gmail]/Spam") };
}

/** Whether exactly one message with this Message-ID is in Sent Mail (to reconcile an unclear send). */
export async function appPasswordFindSent(credentials: AppPasswordCredentials, rfcMessageId: string) {
  const client = await openImap(credentials);
  try {
    const lock = await client.getMailboxLock((await folders(client)).sent);
    try {
      const found = await client.search({ header: { "message-id": rfcMessageId } }, { uid: true });
      return Array.isArray(found) && found.length === 1;
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(client);
  }
}

export type AppPasswordMessage = {
  id: string;
  threadId?: string;
  receivedAt: Date;
  source: Buffer;
};
/** Messages that arrived in the inbox or spam folder since `after`, oldest first. Throws when
 * there are more than `limit`, so the caller never skips feedback silently. */
export async function appPasswordFetchSince(
  workspaceId: string,
  mailboxId: string,
  credentials: AppPasswordCredentials,
  after: Date,
  limit = 1000,
) {
  let client: ImapFlow;
  try {
    client = await openImap(credentials);
  } catch (error) {
    if (authFailure(error)) await markReconnect(workspaceId, mailboxId);
    throw error;
  }
  try {
    const messages: AppPasswordMessage[] = [];
    const { junk } = await folders(client);
    for (const path of ["INBOX", junk]) {
      const lock = await client.getMailboxLock(path);
      try {
        // IMAP SINCE compares dates only, so the exact time is filtered below.
        const uids = await client.search({ since: new Date(after.getTime() - 86400000) }, { uid: true });
        if (!Array.isArray(uids) || !uids.length) continue;
        if (uids.length + messages.length > limit)
          throw new Error(
            "Mailbox backlog exceeds 1000 messages; feedback checkpoint was not advanced. Review the backlog before enabling further outreach.",
          );
        const validity = String(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.uidValidity : "");
        for await (const message of client.fetch(
          uids,
          { uid: true, internalDate: true, emailId: true, threadId: true, source: { maxLength: 400000 } },
          { uid: true },
        )) {
          const receivedAt = new Date(message.internalDate ?? 0);
          if (!message.source || !(receivedAt.getTime() >= after.getTime())) continue;
          messages.push({
            id: message.emailId || `${path}:${validity}:${message.uid}`,
            threadId: message.threadId,
            receivedAt,
            source: message.source,
          });
        }
      } finally {
        lock.release();
      }
    }
    return messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  } finally {
    await closeImap(client);
  }
}
