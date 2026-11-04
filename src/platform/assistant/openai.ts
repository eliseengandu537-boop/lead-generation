import { z } from "zod";
import { HttpError } from "@/lib/auth";
import type { ClaudeMessage, ClaudeTool } from "./claude";

export const defaultOpenAIModel = "gpt-4.1-mini";

export function responsesInput(messages: ClaudeMessage[]) {
  return messages.flatMap((message): Record<string, unknown>[] => {
    if (typeof message.content === "string")
      return [{ role: message.role, content: message.content }];
    return message.content.map((block) => {
      if (block.type === "text")
        return { role: message.role, content: String(block.text || "") };
      if (block.type === "tool_use")
        return {
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        };
      if (block.type === "tool_result")
        return {
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: String(block.content),
        };
      throw new HttpError(
        400,
        "This conversation contains an unsupported message. Start a new chat.",
      );
    });
  });
}

export async function requestOpenAI(
  config: { key: string; model: string },
  input: {
    system: string;
    messages: ClaudeMessage[];
    tools?: ClaudeTool[];
    maxTokens?: number;
  },
  request: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        instructions: input.system,
        input: responsesInput(input.messages),
        store: false,
        max_output_tokens: input.maxTokens ?? 4096,
        ...(input.tools?.length
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
                strict: false,
              })),
              parallel_tool_calls: false,
            }
          : {}),
      }),
    });
  } catch {
    throw new HttpError(
      502,
      "OpenAI did not finish the request. Check completed actions before trying again.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const billing = /credit|billing|balance|quota/i.test(
      String(body.error?.code || "") + " " + String(body.error?.message || ""),
    );
    throw new HttpError(
      billing
        ? 402
        : response.status === 401 || response.status === 403
          ? 400
          : 502,
      billing
        ? "Your OpenAI API credit is unavailable. Add API credit or update the key in AI settings."
        : response.status === 401 || response.status === 403
          ? "OpenAI rejected this API key or model access. Update the connection in AI settings."
          : response.status === 429
            ? "OpenAI's request limit was reached. Wait before trying again."
            : `OpenAI is unavailable (HTTP ${response.status}). Completed actions remain recorded.`,
    );
  }
  try {
    const body = z
      .object({
        status: z.string(),
        output: z.array(z.object({ type: z.string() }).passthrough()).max(40),
      })
      .parse(await response.json());
    if (body.status !== "completed") throw new Error("Incomplete response");
    const content: (
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    )[] = [];
    for (const item of body.output) {
      if (item.type === "function_call") {
        const call = z
          .object({
            call_id: z.string().min(1),
            name: z.string().min(1),
            arguments: z.string(),
          })
          .parse(item);
        content.push({
          type: "tool_use",
          id: call.call_id,
          name: call.name,
          input: JSON.parse(call.arguments),
        });
      } else if (item.type === "message") {
        const message = z
          .object({
            content: z.array(
              z.object({
                type: z.string(),
                text: z.string().optional(),
                refusal: z.string().optional(),
              }),
            ),
          })
          .parse(item);
        for (const part of message.content) {
          if (part.type === "output_text" && part.text)
            content.push({ type: "text", text: part.text });
          if (part.type === "refusal")
            content.push({
              type: "text",
              text: part.refusal || "I cannot carry out that request.",
            });
        }
      }
    }
    if (!content.length) throw new Error("Empty response");
    return {
      stop_reason: content.some((part) => part.type === "tool_use")
        ? "tool_use"
        : "end_turn",
      content,
    };
  } catch {
    throw new HttpError(
      502,
      "OpenAI returned an incomplete or invalid response. No tools from that response were executed.",
    );
  }
}
