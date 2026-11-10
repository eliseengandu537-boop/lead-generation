import { z } from "zod";

export type ResearchAiConfig = { key: string; model: string };

export function researchProvider(model: string) {
  return model.startsWith("claude-") ? "Claude" : "OpenAI";
}

// Claude accepts a subset of JSON Schema. Keep the full schema in the caller
// for final Zod validation, and describe constraints that its API cannot enforce.
function claudeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  const constraints: string[] = [];
  for (const key of [
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minLength", "maxLength", "maxItems",
  ]) {
    if (key in result) {
      constraints.push(`${key}: ${result[key]}`);
      delete result[key];
    }
  }
  if (typeof result.minItems === "number" && result.minItems > 1) {
    constraints.push(`minItems: ${result.minItems}`);
    delete result.minItems;
  }
  delete result.$schema;
  if (constraints.length)
    result.description = [result.description, ...constraints].filter(Boolean).join(". ");
  for (const key of ["properties", "$defs", "definitions"]) {
    const fields = result[key];
    if (fields && typeof fields === "object" && !Array.isArray(fields))
      result[key] = Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [
          name, claudeSchema(field as Record<string, unknown>),
        ]),
      );
  }
  if (result.items && typeof result.items === "object" && !Array.isArray(result.items))
    result.items = claudeSchema(result.items as Record<string, unknown>);
  for (const key of ["anyOf", "allOf", "oneOf"])
    if (Array.isArray(result[key]))
      result[key] = result[key].map((item) => claudeSchema(item as Record<string, unknown>));
  if (result.type === "object") result.additionalProperties = false;
  return result;
}

export async function researchJson(
  config: ResearchAiConfig,
  input: {
    instructions: string;
    data: unknown;
    schema: Record<string, unknown>;
    name: string;
    maxTokens: number;
  },
  request: typeof fetch = fetch,
): Promise<unknown> {
  const provider = researchProvider(config.model);
  const claude = provider === "Claude";
  // Never send a known provider credential to the other provider's endpoint.
  if ((config.key.startsWith("sk-ant-") && !claude) ||
      (config.key.startsWith("sk-proj-") && claude))
    throw new Error("The AI key and model use different providers. Check the workspace AI connection.");
  let response: Response;
  try {
    response = await request(
      claude ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          ...(claude ? { "anthropic-version": "2026-10-21" } : {}),
        },
        body: JSON.stringify(claude ? {
          model: config.model,
          max_tokens: input.maxTokens,
          system: input.instructions,
          messages: [{ role: "user", content: JSON.stringify(input.data) }],
          output_config: { format: { type: "json_schema", schema: claudeSchema(input.schema) } },
        } : {
          model: config.model,
          store: false,
          instructions: input.instructions,
          input: JSON.stringify(input.data),
          max_output_tokens: input.maxTokens,
          text: { format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      },
    );
  } catch {
    throw new Error(`${provider} research did not finish. No generated result was saved.`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const billing = /credit|billing|balance|quota/i.test(String(body.error?.message || body.error?.code || ""));
    throw new Error(
      billing ? `${provider} API credit or quota is unavailable. Check API billing for this workspace key.`
        : response.status === 401 || response.status === 403
          ? `${provider} rejected this API key or model access. Check the workspace AI connection.`
          : response.status === 429
            ? `${provider} usage limit reached. Wait before trying again.`
            : `${provider} research unavailable (HTTP ${response.status}). No generated result was saved.`,
    );
  }
  let raw: string;
  if (claude) {
    const data = z.object({
      stop_reason: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    }).parse(await response.json());
    if (data.stop_reason !== "end_turn" || data.content.some((block) => block.type !== "text"))
      throw new Error("AI response incomplete or refused; no partial result was saved.");
    raw = data.content.map((block) => block.text || "").join("");
  } else {
    const data = z.object({
      status: z.string(),
      output: z.array(z.object({
        type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      })),
    }).parse(await response.json());
    if (data.status !== "completed")
      throw new Error("AI response incomplete; no partial result was saved.");
    raw = data.output.filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text || "").join("");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("The AI response was refused or could not be validated. No generated result was saved.");
  }
}
