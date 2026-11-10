import test from "node:test";
import assert from "node:assert/strict";
import { researchJson } from "../src/platform/research/ai";
import { structuredAnalysis, qualificationSchema } from "../src/platform/research/analysis";
import { analyseBusiness } from "../src/platform/research/providers";

const key = "sk-ant-private-test-credential";
const config = { key, model: "claude-sonnet-5-5" };
const evidence = [{
  url: "https://example.com",
  excerpt: "Our workshop supplies replacement vehicle parts.",
  title: "Business", fetchedAt: "2026-11-10T10:00:00.000Z",
}];
const draft = {
  summary: "Vehicle parts supplier.", fitReason: "Potential fit, subject to review.",
  facts: [{ claim: "Supplies vehicle parts", sourceUrl: evidence[0].url, quote: "supplies replacement vehicle parts" }],
  cautions: ["Review eligibility and approve before sending."],
  subject: "A possible fit", body: "Hello team. Would our service be useful? Let us know if you prefer no further contact.",
};
const response = (data: unknown, stop_reason = "end_turn") => Response.json({
  stop_reason, content: [{ type: "text", text: JSON.stringify(data) }],
});

test("Claude writes outreach from supplied evidence using private headers and structured output", async () => {
  const result = await analyseBusiness(config, {
    company: "Prospect", websiteUrl: evidence[0].url, offer: "Website services", sender: "Agency", evidence,
  }, async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("anthropic-version"), "2026-10-21");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, config.model);
    assert.equal(body.output_config.format.type, "json_schema");
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.match(body.system, /untrusted data/);
    assert.equal(body.tools, undefined);
    assert.equal(body.store, undefined);
    assert.ok(!String(init?.body).includes(key));
    assert.deepEqual(JSON.parse(body.messages[0].content).evidence, evidence);
    return response(draft);
  });
  assert.deepEqual(result, draft);
});

test("OpenAI research retains the Responses API, schema enforcement and disabled storage", async () => {
  assert.deepEqual(await analyseBusiness({ key: "sk-proj-fixture", model: "gpt-4.1-mini" }, {
    company: "Prospect", websiteUrl: evidence[0].url, offer: "Websites", sender: "Agency", evidence,
  }, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(new Headers(init?.headers).get("anthropic-version"), null);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }] });
  }), draft);
});

test("Claude receives supported schema constraints while original validation still rejects invalid scores", async () => {
  await assert.rejects(() => structuredAnalysis(config, qualificationSchema, "Assess fit", {}, async (_url, init) => {
    const schema = JSON.parse(String(init?.body)).output_config.format.schema;
    assert.equal(schema.$schema, undefined);
    assert.equal(schema.properties.score.maximum, undefined);
    assert.match(schema.properties.score.description, /maximum: 100/);
    assert.equal(schema.properties.facts.maxItems, undefined);
    assert.equal(schema.properties.facts.items.properties.quote.maxLength, undefined);
    return response({ score: 101, explanation: "Fit", facts: [], uncertainties: [] });
  }), /100/);
});

test("Claude output must finish and cite a real supplied quote before an outreach draft is accepted", async () => {
  const input = { company: "Prospect", websiteUrl: evidence[0].url, offer: "Websites", sender: "Agency", evidence };
  for (const reason of ["max_tokens", "refusal", "tool_use"])
    await assert.rejects(() => analyseBusiness(config, input, async () => response(draft, reason)), /incomplete|refused/);
  await assert.rejects(() => analyseBusiness(config, input, async () => response({
    ...draft, facts: [{ ...draft.facts[0], quote: "Invented source statement" }],
  })), /unsupported/);
});

test("research failures never echo secrets or retry and mismatched credentials never leave the app", async () => {
  const input = { instructions: "test", data: {}, schema: { type: "object", properties: {}, additionalProperties: false }, name: "test", maxTokens: 20 };
  let calls = 0;
  for (const [status, message] of [[401, key], [400, `Your credit balance is too low ${key}`], [429, key]] as const) {
    await assert.rejects(() => researchJson(config, input, async () => {
      calls++;
      return Response.json({ error: { message } }, { status });
    }), error => error instanceof Error && !error.message.includes(key) && /Claude/.test(error.message));
  }
  assert.equal(calls, 3);
  for (const wrong of [{ key, model: "gpt-4.1-mini" }, { key: "sk-proj-secret", model: config.model }])
    await assert.rejects(() => researchJson(wrong, input, async () => {
      assert.fail("A provider mismatch must not send the credential anywhere.");
    }), /different providers/);
  await assert.rejects(() => researchJson(config, input, async () => { throw new Error(key); }),
    error => error instanceof Error && !error.message.includes(key));
});
