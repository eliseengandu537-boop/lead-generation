import { handle } from "@/lib/http";
import { meetingAvailability } from "@/platform/calling/bookings";
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const response = await handle(() => params.then(({ workspaceId }) => meetingAvailability(workspaceId, new URL(request.url).searchParams.get("date") || undefined)));
  response.headers.set("Cache-Control", "no-store"); return response;
}
