import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { callerAction, readCallerWorkspace } from "@/platform/calling/service";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  const response = await handle(async () =>
    readCallerWorkspace((await params).workspaceId),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: Request, { params }: Context) {
  const response = await handle(async () => {
    await sameOrigin();
    return callerAction((await params).workspaceId, await json(request));
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
