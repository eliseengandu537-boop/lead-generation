import type { Prisma } from "@prisma/client";
import { controlDb } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { encrypt } from "@/lib/security";
import { accountEmailConfigured } from "@/lib/account-email";
import { callerAccess } from "./access";

export async function meetingHost(
  workspaceId: string,
  tx: Prisma.TransactionClient = controlDb,
) {
  const config = await tx.platformProspectingConfig.findUnique({
    where: { businessId: workspaceId },
    select: { meetingHostId: true },
  });
  const host = await tx.user.findFirst({
    where: {
      agencyAdmin: true,
      disabledAt: null,
      ...(config?.meetingHostId ? { id: config.meetingHostId } : {}),
    },
    orderBy: { email: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (!host)
    throw new HttpError(
      409,
      "The meeting team is not available. Your administrator needs to choose an active meeting host.",
    );
  return host;
}

export async function meetingAvailability(
  workspaceId: string,
  date?: string,
  now = new Date(),
) {
  await callerAccess(workspaceId);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date + "T00:00:00+02:00")))
  )
    throw new HttpError(400, "Choose a valid meeting date.");
  const host = await meetingHost(workspaceId);
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const first = new Date((date || localToday) + "T00:00:00+02:00");
  if (
    first.getTime() < new Date(localToday + "T00:00:00+02:00").getTime() ||
    first.getTime() > now.getTime() + 60 * 86400000
  )
    throw new HttpError(400, "Choose a date within the next 60 days.");
  const until = new Date(first.getTime() + (date ? 1 : 10) * 86400000);
  const busy = await controlDb.platformBooking.findMany({
    where: {
      hostId: host.id,
      status: "SCHEDULED",
      startAt: { lt: until },
      endAt: { gt: first },
    },
    select: { startAt: true, endAt: true },
  });
  const slots: { startAt: string; endAt: string }[] = [];
  for (
    let day = first.getTime();
    day < until.getTime() && slots.length < 12;
    day += 86400000
  ) {
    const weekday = new Date(day + 2 * 3600000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let hour = 9; hour < 17 && slots.length < 12; hour++) {
      const start = new Date(day + hour * 3600000),
        end = new Date(start.getTime() + 1800000);
      if (
        start.getTime() < now.getTime() + 30 * 60000 ||
        busy.some((item) => item.startAt < end && item.endAt > start)
      )
        continue;
      slots.push({ startAt: start.toISOString(), endAt: end.toISOString() });
    }
  }
  return { timezone: "Africa/Johannesburg", durationMinutes: 30, slots };
}

export async function notifyBooking(
  tx: Prisma.TransactionClient,
  booking: {
    id: string;
    workspaceId: string;
    title: string;
    startAt: Date;
    endAt: Date;
    version: number;
    status: string;
  },
  callerName: string,
  company: string,
  kind: "BOOKED" | "UPDATED",
) {
  const dedupeKey = `${booking.workspaceId}:booking:${booking.id}:${booking.version}`;
  if (
    await tx.platformNotice.findUnique({
      where: { dedupeKey },
      select: { id: true },
    })
  )
    return;
  const when = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(booking.startAt);
  const title =
    kind === "BOOKED"
      ? "New meeting booked"
      : booking.status === "CANCELED"
        ? "Meeting canceled"
        : "Meeting updated";
  const message = `${callerName} ${kind === "BOOKED" ? "booked" : "updated"} a meeting with ${company}. ${when} SAST · ${booking.status.replaceAll("_", " ")}.`;
  await tx.platformNotice.create({
    data: {
      workspaceId: booking.workspaceId,
      dedupeKey,
      kind: "BOOKING_" + kind,
      title,
      message,
    },
  });
  const config = await tx.platformProspectingConfig.findUnique({
    where: { businessId: booking.workspaceId },
    select: { notifyAdminEmail: true },
  });
  if (config?.notifyAdminEmail === false || !accountEmailConfigured()) return;
  const admins = await tx.user.findMany({
    where: { agencyAdmin: true, disabledAt: null },
    select: { email: true },
  });
  const body = `${title}\n\n${message}\n\nMeeting: ${booking.title}\nDuration: ${Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60000)} minutes\n\nView the booking in Concrete:\n${new URL(process.env.NEXTAUTH_URL || "http://localhost:3100").origin}/admin?section=call-centre\n\nThis is a Concrete booking notification.`;
  for (const admin of admins)
    await tx.identityEmail.create({
      data: {
        to: admin.email,
        subject: `Concrete: ${title} · ${company}`
          .replace(/[\r\n]/g, " ")
          .slice(0, 240),
        encryptedBody: encrypt(body),
      },
    });
}
