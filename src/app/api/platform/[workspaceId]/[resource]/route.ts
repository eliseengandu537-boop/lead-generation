import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { readResource, writeResource } from "@/platform/core";
import { z } from "zod";
type Context = { params: Promise<{ workspaceId: string; resource: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const { workspaceId, resource } = await context.params;
    return readResource(workspaceId, resource);
  });
}
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    await sameOrigin();
    const { workspaceId, resource } = await context.params;
    const input = await json(request);
    const requestId = z
      .object({ requestId: z.uuid().optional() })
      .parse(input).requestId;
    return writeResource(
      workspaceId,
      resource,
      input,
      requestId ? { idempotencyKey: `web:${requestId}` } : undefined,
    );
  });
}
