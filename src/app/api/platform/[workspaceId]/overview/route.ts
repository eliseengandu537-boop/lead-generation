import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { reportData } from "@/platform/analytics";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    const [report, recentLeads, activity] = await Promise.all([
      reportData(workspaceId),
      db.platformLead.findMany({
        where: { workspaceId, status: { not: "ARCHIVED" } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      db.platformActivity.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    return { ...report, recentLeads, activity };
  });
}
