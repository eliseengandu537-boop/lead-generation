import { z } from "zod";
import { HttpError } from "@/lib/auth";

export const defaultClaudeModel = "claude-sonnet-5-5";
export type ClaudeBlock = Record<string, unknown> & { type: string };
export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeBlock[];
};
export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};
export const claudeResponseSchema = z.object({
  stop_reason: z.string(),
  content: z.array(z.object({ type: z.string() }).passthrough()).max(30),
});

export function safeAssistantText(value: string) {
  return value
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[private key]")
    .replace(
      /(?:postgres(?:ql)?:\/\/)[^\s]+/gi,
      "[private database connection]",
    );
}
export function validateUserMessage(value: string) {
  const message = z.string().trim().min(1).max(6000).parse(value);
  if (
    /sk-[a-zA-Z0-9_-]{12,}|(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*\S+/i.test(
      message,
    )
  )
    throw new HttpError(
      400,
      "Keep passwords and API keys out of chat. Use the Claude connection settings for your API key.",
    );
  return message;
}
export async function requestClaude(
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
    response = await request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "anthropic-version": "2026-10-21",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: input.maxTokens ?? 4096,
        system: input.system,
        messages: input.messages,
        ...(input.tools?.length ? { tools: input.tools } : {}),
      }),
    });
  } catch {
    throw new HttpError(
      502,
      "Claude did not finish the request. Check completed actions before trying the command again.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const credit = /credit|billing|balance/i.test(
      String(body.error?.message || ""),
    );
    throw new HttpError(
      response.status === 401 || response.status === 403 ? 400 : 502,
      credit
        ? "Claude API credit is unavailable. Check Anthropic API billing for this key."
        : response.status === 401 || response.status === 403
          ? "Claude rejected this API key or model access. Check the connection settings."
          : response.status === 429
            ? "Claude's request limit was reached. Wait before trying again."
            : `Claude is unavailable (HTTP ${response.status}). Completed actions remain recorded.`,
    );
  }
  try {
    return claudeResponseSchema.parse(await response.json());
  } catch {
    throw new HttpError(
      502,
      "Claude returned a response that could not be validated. No tools from that response were executed.",
    );
  }
}
