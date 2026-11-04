import { z } from "zod";
import { sameOrigin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { assistantAction, assistantAdmin } from "@/platform/assistant/actions";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  const response = await handle(async () => {
    await sameOrigin();
    await assistantAdmin();
    const input = z
      .object({ action: z.enum(["credentials", "review", "launch"]) })
      .strict()
      .parse(await json(request));
    return assistantAction((await params).id, input.action);
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
