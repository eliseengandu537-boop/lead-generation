import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { controlDb, db } from "@/lib/db";
import { callerAccess } from "@/platform/calling/access";
import { bookingCalendar } from "@/platform/calling/rules";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; bookingId: string }> },
) {
  let calendar = "";
  const check = await handle(async () => {
    const { workspaceId, bookingId } = await params,
      { user } = await callerAccess(workspaceId);
    const booking = await db.platformBooking.findFirst({
      where: {
        id: bookingId,
        workspaceId,
        ...(user.agencyAdmin
          ? {}
          : { OR: [{ bookedById: user.id }, { hostId: user.id }] }),
      },
      include: { lead: { select: { name: true, company: true, email: true } } },
    });
    if (!booking) throw new HttpError(404, "Booking not found.");
    const host = await controlDb.user.findUnique({
      where: { id: booking.hostId },
      select: { name: true, email: true },
    });
    if (!host) throw new HttpError(404, "Booking host not found.");
    calendar = bookingCalendar(booking, host, {
      name: booking.lead.name || booking.lead.company,
      email: booking.lead.email,
    });
    return { ready: true };
  });
  if (!check.ok) return check;
  return new NextResponse(calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Concrete-appointment.ics"',
      "Cache-Control": "no-store",
    },
  });
}
