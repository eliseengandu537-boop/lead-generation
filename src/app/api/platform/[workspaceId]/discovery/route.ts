import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, rateLimit } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { organizationAccess } from "@/platform/core";
import { enqueueJob, orchestrationConfig } from "@/platform/jobs";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { workspaceId } = await params;
    await organizationAccess(workspaceId);
    return {
      items: await db.platformJob.findMany({
        where: {
          workspaceId,
          kind: {
            in: [
              "DISCOVER",
              "RESEARCH_LEAD",
              "QUALIFY",
              "VERIFY_EMAIL",
              "DRAFT_EMAIL",
            ],
          },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          error: true,
          result: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      configured: !!orchestrationConfig(),
    };
  });
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    await sameOrigin();
    const { workspaceId } = await params;
    const { user } = await organizationAccess(workspaceId, true);
    await rateLimit(`discovery:${workspaceId}`, 20);
    const input = z
      .object({
        action: z.literal("discover"),
        query: z.string().trim().max(300).optional(),
        industry: z.string().trim().max(100).default(""),
        category: z.string().trim().max(100).default(""),
        location: z.string().trim().max(200).default(""),
        maxResults: z.number().int().min(1).max(10).default(5),
        permissionConfirmed: z.literal(true),
      })
      .strict()
      .parse(await json(request));
    const { action: _, ...payload } = input;
    void _;
    return enqueueJob(workspaceId, user.id, "DISCOVER", payload);
  });
}
