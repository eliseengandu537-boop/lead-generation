import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { organizationAccess } from "@/platform/core";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; leadId: string }> },
) {
  return handle(async () => {
    const { workspaceId, leadId } = await params;
    await organizationAccess(workspaceId);
    const lead = await db.platformLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new HttpError(404, "Lead not found");
    return {
      recipients: await db.platformCampaignRecipient.findMany({
        where: { leadId },
        include: { campaign: { select: { name: true, status: true } } },
      }),
      messages: await db.platformMailMessage.findMany({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    };
  });
}
