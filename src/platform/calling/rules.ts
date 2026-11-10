import { z } from "zod";
import { HttpError } from "@/lib/auth";

export function phoneNumber(value: string) {
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (/^0\d{9}$/.test(phone)) phone = "+27" + phone.slice(1);
  if (/^00\d+$/.test(phone)) phone = "+" + phone.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new HttpError(
      400,
      "Enter a complete phone number, such as +27821234567.",
    );
  return phone;
}
export const outcomes = [
  "CONNECTED",
  "NO_ANSWER",
  "VOICEMAIL",
  "WRONG_NUMBER",
  "CALLBACK",
  "QUALIFIED",
  "NOT_QUALIFIED",
  "DO_NOT_CALL",
] as const;
export const terminalCallStatuses = new Set([
  "COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "FAILED",
  "CANCELED",
  "EXPIRED",
]);
export function providerCallUpdate(
  current: { status: string; lastSequence: number },
  status: string,
  sequence: number,
) {
  const states: Record<string, string> = {
    initiated: "INITIATED",
    queued: "INITIATED",
    ringing: "RINGING",
    "in-progress": "IN_PROGRESS",
    answered: "IN_PROGRESS",
    completed: "COMPLETED",
    busy: "BUSY",
    "no-answer": "NO_ANSWER",
    failed: "FAILED",
    canceled: "CANCELED",
  };
  const next = states[status];
  if (
    !next ||
    sequence <= current.lastSequence ||
    terminalCallStatuses.has(current.status)
  )
    return null;
  const ranks: Record<string, number> = {
    PREPARED: 0,
    INITIATED: 1,
    RINGING: 2,
    IN_PROGRESS: 3,
  };
  if (
    !terminalCallStatuses.has(next) &&
    (ranks[next] ?? 0) < (ranks[current.status] ?? 0)
  )
    return null;
  return next;
}
export const bookingInput = z
  .object({
    action: z.literal("book"),
    leadId: z.string().min(1).max(100),
    callId: z.string().min(1).max(100).optional(),
    title: z
      .string()
      .trim()
      .min(2)
      .max(160)
      .refine((value) => !/[\r\n]/.test(value)),
    hostId: z.string().min(1).max(100).optional(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string().max(100).default("Africa/Johannesburg"),
    location: z.string().trim().max(500).default(""),
    meetingUrl: z
      .union([
        z
          .string()
          .max(2048)
          .refine((value) => !/[\r\n]/.test(value))
          .pipe(
            z
              .url()
              .refine(
                (value) =>
                  value.startsWith("https://") &&
                  !new URL(value).username &&
                  !new URL(value).password,
              ),
          ),
        z.literal(""),
      ])
      .default(""),
    notes: z.string().trim().max(5000).default(""),
    customerAgreed: z.literal(true),
    requestId: z.uuid(),
  })
  .strict();
export function validateBookingWindow(
  start: Date,
  end: Date,
  timezone: string,
  now = new Date(),
) {
  if (
    !(start > now) ||
    !(end > start) ||
    end.getTime() - start.getTime() > 8 * 3600000
  )
    throw new HttpError(
      400,
      "Choose a future appointment lasting between 1 minute and 8 hours.",
    );
  if (end.getTime() - start.getTime() < 60000)
    throw new HttpError(400, "Appointments must last at least one minute.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new HttpError(400, "Choose a valid booking timezone.");
  }
}
export function bookingCalendar(
  input: {
    id: string;
    title: string;
    startAt: Date;
    endAt: Date;
    createdAt: Date;
    updatedAt: Date;
    location: string;
    meetingUrl: string;
    version: number;
    status: string;
  },
  host: { name: string; email: string },
  attendee: { name: string; email: string | null },
) {
  const escape = (value: string) =>
    value
      .replaceAll("\\", "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,");
  const parameter = (value: string) =>
    '"' +
    value
      .replaceAll("^", "^^")
      .replace(/\r\n|\r|\n/g, "^n")
      .replaceAll('"', "^'") +
    '"';
  const stamp = (value: Date) =>
    value
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Monettic//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Existing calendar updates must retain the original event identity.
    `UID:${escape(input.id)}@concrete`,
    `DTSTAMP:${stamp(input.updatedAt)}`,
    `DTSTART:${stamp(input.startAt)}`,
    `DTEND:${stamp(input.endAt)}`,
    `SEQUENCE:${input.version}`,
    `SUMMARY:${escape(input.title)}`,
    `LOCATION:${escape(input.location)}`,
    "DESCRIPTION:Meeting arranged through Monettic.",
    `ORGANIZER;CN=${parameter(host.name)}:mailto:${host.email}`,
    ...(attendee.email
      ? [`ATTENDEE;CN=${parameter(attendee.name)}:mailto:${attendee.email}`]
      : []),
    ...(input.meetingUrl
      ? [`URL:${input.meetingUrl.replace(/[\r\n]/g, "")}`]
      : []),
    `STATUS:${input.status === "CANCELED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return (
    lines
      .map((line) => {
        const folded: string[] = [];
        let part = "";
        for (const char of line) {
          if (Buffer.byteLength(part + char, "utf8") > 73) {
            folded.push(part);
            part = " " + char;
          } else part += char;
        }
        folded.push(part);
        return folded.join("\r\n");
      })
      .join("\r\n") + "\r\n"
  );
}
