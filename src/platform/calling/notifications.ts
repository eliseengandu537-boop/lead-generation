import { controlDb } from "@/lib/db";
import { currentUser, HttpError } from "@/lib/auth";
import { z } from "zod";
export async function bookingNotifications() {
  const user = await currentUser();
  if (!user.agencyAdmin) throw new HttpError(403, "Administrator required.");
  const where = {
    kind: { startsWith: "BOOKING_" },
    organization: { onboardingStatus: { not: "DEMO" } },
  };
  const [items, unread] = await Promise.all([
    controlDb.platformNotice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        workspaceId: true,
        title: true,
        message: true,
        createdAt: true,
        readBy: true,
      },
    }),
    controlDb.platformNotice.count({
      where: { ...where, NOT: { readBy: { has: user.id } } },
    }),
  ]);
  return {
    unread,
    items: items.map(({ readBy, ...item }) => ({
      ...item,
      read: readBy.includes(user.id),
    })),
  };
}
export async function markBookingNotification(raw: unknown) {
  const user = await currentUser();
  if (!user.agencyAdmin) throw new HttpError(403, "Administrator required.");
  const { id } = z
    .object({ id: z.string().min(1).max(100) })
    .strict()
    .parse(raw);
  await controlDb.platformNotice.updateMany({
    where: {
      id,
      kind: { startsWith: "BOOKING_" },
      NOT: { readBy: { has: user.id } },
    },
    data: { readBy: { push: user.id } },
  });
  return { message: "Notification read." };
}
