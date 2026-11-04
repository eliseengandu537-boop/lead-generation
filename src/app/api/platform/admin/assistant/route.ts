import { z } from "zod";
import { sameOrigin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { assistantAdmin } from "@/platform/assistant/actions";
import {
  assistantState,
  configureAssistant,
  createAssistantConversation,
  runAssistant,
} from "@/platform/assistant/service";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const response = await handle(() =>
    assistantState(
      new URL(request.url).searchParams.get("conversationId") || undefined,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(request: Request) {
  const response = await handle(async () => {
    await sameOrigin();
    await assistantAdmin();
    const input = await json(request);
    const { action } = z
      .object({ action: z.enum(["configure", "new_conversation", "message"]) })
      .parse(input);
    if (action === "configure") return configureAssistant(input);
    if (action === "new_conversation") return createAssistantConversation();
    return runAssistant(input);
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
