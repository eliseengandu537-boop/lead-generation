import { handle, json } from "@/lib/http";
import { sameOrigin } from "@/lib/auth";
import { callCentreRead, callCentreWrite } from "@/platform/calling/admin";
export async function GET(request: Request) {
  const response = await handle(() =>
    callCentreRead(new URL(request.url).searchParams),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: Request) {
  const response = await handle(async () => {
    await sameOrigin();
    return callCentreWrite(await json(request));
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
