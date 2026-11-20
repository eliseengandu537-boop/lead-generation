import { sameOrigin, rateLimit } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { outreachRead, outreachWrite } from "@/platform/outreach";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  const response = await handle(async () => outreachRead((await params).workspaceId));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: Request, { params }: Context) {
  const response = await handle(async () => {
    await sameOrigin();
    const { workspaceId } = await params;
    await rateLimit(`outreach:${workspaceId}`, 30);
    return outreachWrite(workspaceId, await json(request));
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
