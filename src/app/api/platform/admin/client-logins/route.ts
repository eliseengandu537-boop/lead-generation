import { sameOrigin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { createClientLogin } from "@/platform/client-access";

export async function POST(request: Request) {
  const response = await handle(async () => {
    await sameOrigin();
    return createClientLogin(await json(request));
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
