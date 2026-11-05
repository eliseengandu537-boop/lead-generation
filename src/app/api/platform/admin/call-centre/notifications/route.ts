import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { bookingNotifications, markBookingNotification } from "@/platform/calling/notifications";
export async function GET() { const response = await handle(bookingNotifications); response.headers.set("Cache-Control", "no-store"); return response; }
export async function POST(request: Request) { const response = await handle(async () => { await sameOrigin(); return markBookingNotification(await json(request)); }); response.headers.set("Cache-Control", "no-store"); return response; }
