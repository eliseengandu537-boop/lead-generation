import { z } from "zod";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { reportData } from "@/platform/analytics";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    const query = new URL(request.url).searchParams;
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(366)
      .parse(query.get("days") || 30);
    return reportData(workspaceId, {
      days,
      start: query.has("start")
        ? new Date(z.iso.datetime().parse(query.get("start")))
        : undefined,
      end: query.has("end")
        ? new Date(z.iso.datetime().parse(query.get("end")))
        : undefined,
      period: query.get("period") || undefined,
    });
  });
}
