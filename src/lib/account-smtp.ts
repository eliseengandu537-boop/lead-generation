import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { SmtpAccountEmailConfig } from "./account-email";

type SmtpTransportFactory = (options: SMTPTransport.Options) => {
  sendMail: (message: SMTPTransport.MailOptions) => Promise<{
    accepted?: unknown[];
    rejected?: unknown[];
  }>;
  close: () => void;
};

export function smtpTransportOptions(
  config: SmtpAccountEmailConfig,
): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    auth: { user: config.username, pass: config.password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

export async function verifySmtpAccountEmail(config: SmtpAccountEmailConfig) {
  const transport = nodemailer.createTransport(smtpTransportOptions(config));
  try {
    await transport.verify();
    return { authenticated: true };
  } catch (error) {
    const details = error as { code?: unknown; responseCode?: unknown };
    const code =
      typeof details.code === "string" && /^[A-Z_]+$/.test(details.code)
        ? details.code
        : "CONNECTION_ERROR";
    const response =
      typeof details.responseCode === "number" &&
      Number.isInteger(details.responseCode)
        ? `, SMTP ${details.responseCode}`
        : "";
    throw new Error(
      `SMTP connection or authentication failed (${code}${response}). Check the SMTP login, key, network and provider approval.`,
    );
  } finally {
    transport.close();
  }
}

export async function deliverSmtpAccountEmail(
  config: SmtpAccountEmailConfig,
  message: { id: string; to: string; subject: string; body: string },
  createTransport: SmtpTransportFactory = (options) =>
    nodemailer.createTransport(options),
) {
  const transport = createTransport(smtpTransportOptions(config));
  try {
    // Keep existing Message-IDs stable when the product display name changes.
    const digest = createHash("sha256")
      .update(`concrete-identity/${message.id}`)
      .digest("hex");
    const result = await transport.sendMail({
      from: { name: "Monettic", address: config.sender },
      to: message.to,
      subject: message.subject,
      text: message.body,
      messageId: `<${digest}@${config.sender.split("@")[1]}>`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (
      !Array.isArray(result.accepted) ||
      !result.accepted.some(
        (address) => String(address).toLowerCase() === message.to.toLowerCase(),
      ) ||
      result.rejected?.length
    )
      throw new Error("SMTP did not confirm acceptance");
    return { accepted: true, duplicate: false };
  } catch {
    // Provider error text can contain credentials, addresses or message data.
    throw new Error(
      "SMTP delivery was not confirmed. Request a fresh account email; automatic replay is blocked.",
    );
  } finally {
    transport.close();
  }
}
