import { z } from "zod";
import { handle, json } from "@/lib/http";
import { sameOrigin, HttpError } from "@/lib/auth";
import { callerAccess } from "@/platform/calling/access";
import { mutateAuthorizedResource } from "@/platform/core";
type Context = { params: Promise<{ workspaceId: string }> };
export async function POST(request: Request, { params }: Context) {
  const response = await handle(async () => {
    await sameOrigin();
    const access = await callerAccess((await params).workspaceId);
    if (!access.canSend)
      throw new HttpError(
        403,
        "Your administrator has not enabled email campaign access for this business.",
      );
    const input = await json(request),
      requestId = z
        .object({ requestId: z.uuid().optional() })
        .parse(input).requestId;
    return mutateAuthorizedResource(
      access,
      "campaigns",
      input,
      requestId
        ? { idempotencyKey: `caller-campaign:${access.user.id}:${requestId}` }
        : undefined,
    );
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
