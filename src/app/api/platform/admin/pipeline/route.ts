import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { pipelineRead, pipelineWrite } from "@/platform/admin-workbench";
export async function GET(request: Request) {
  const response = await handle(() =>
    pipelineRead(new URL(request.url).searchParams),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: Request) {
  const response = await handle(async () => {
    await sameOrigin();
    return pipelineWrite(await json(request));
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
