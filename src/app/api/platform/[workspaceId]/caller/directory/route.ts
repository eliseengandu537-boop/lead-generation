import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { searchDirectory } from "@/platform/calling/directory";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const response = await handle(async () => {
    await sameOrigin();
    return searchDirectory((await params).workspaceId, await json(request));
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
