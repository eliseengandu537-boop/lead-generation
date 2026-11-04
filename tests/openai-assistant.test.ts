import assert from "node:assert/strict";
import test from "node:test";
import {
  requestOpenAI,
  responsesInput,
} from "../src/platform/assistant/openai";
import { assistantTools } from "../src/platform/assistant/tools";
import {
  assertAssistantClientScope,
  decodeAssistantInput,
  encodeAssistantInput,
} from "../src/platform/assistant/context";

test("OpenAI tool calls and results round-trip with private storage disabled and no key in content", async () => {
  const config = {
    key: "sk-private-openai-unit-test-key",
    model: "gpt-4.1-mini",
  };
  const first = await requestOpenAI(
    config,
    {
      system: "Use actual client records",
      messages: [{ role: "user", content: "Show my clients" }],
      tools: assistantTools,
    },
    async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${config.key}`,
      );
      assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(
        body.tools.find(
          (tool: { name: string }) => tool.name === "list_clients",
        ).type,
        "function",
      );
      assert.ok(!String(init?.body).includes(config.key));
      return Response.json({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call_clients",
            name: "list_clients",
            arguments: "{}",
          },
        ],
      });
    },
  );
  assert.equal(first.stop_reason, "tool_use");
  const second = await requestOpenAI(
    config,
    {
      system: "Use actual client records",
      messages: [
        { role: "user", content: "Show my clients" },
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_clients",
              content: '{"clients":[]}',
            },
          ],
        },
      ],
    },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.input[1], {
        type: "function_call",
        call_id: "call_clients",
        name: "list_clients",
        arguments: "{}",
      });
      assert.deepEqual(body.input[2], {
        type: "function_call_output",
        call_id: "call_clients",
        output: '{"clients":[]}',
      });
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "There are no clients yet." },
            ],
          },
        ],
      });
    },
  );
  assert.equal(second.stop_reason, "end_turn");
  assert.deepEqual(second.content, [
    { type: "text", text: "There are no clients yet." },
  ]);
});

test("OpenAI credit and authentication errors stay actionable, hide credentials, and never retry", async () => {
  for (const [status, code, expected] of [
    [429, "credit_balance_exhausted", /API credit/],
    [401, "invalid_api_key", /rejected/],
    [429, "rate_limit_exceeded", /request limit/],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      () =>
        requestOpenAI(
          { key: "sk-secret-test-value", model: "gpt-4.1-mini" },
          { system: "test", messages: [{ role: "user", content: "hello" }] },
          async () => {
            calls++;
            return Response.json(
              { error: { code, message: "Rejected sk-secret-test-value" } },
              { status },
            );
          },
        ),
      expected,
    );
    assert.equal(calls, 1);
  }
});

test("partial or malformed provider tool calls cannot execute actions", async () => {
  for (const body of [
    {
      status: "incomplete",
      output: [
        {
          type: "function_call",
          call_id: "a",
          name: "create_client",
          arguments: "{}",
        },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "a",
          name: "create_client",
          arguments: "not-json",
        },
      ],
    },
  ])
    await assert.rejects(
      () =>
        requestOpenAI(
          { key: "private-test-value", model: "gpt-4.1-mini" },
          { system: "test", messages: [] },
          async () => Response.json(body),
        ),
      /No tools/,
    );
  assert.throws(
    () =>
      responsesInput([{ role: "user", content: [{ type: "unsupported" }] }]),
    /unsupported/,
  );
});

test("client selection persists privately, prevents cross-client tools and preserves older chats", () => {
  const selected = encodeAssistantInput("Check this client", "business-a");
  assert.deepEqual(decodeAssistantInput(selected), {
    version: 1,
    message: "Check this client",
    workspaceId: "business-a",
  });
  assert.doesNotThrow(() =>
    assertAssistantClientScope(selected, { workspaceId: "business-a" }),
  );
  assert.throws(
    () => assertAssistantClientScope(selected, { workspaceId: "business-b" }),
    /another client/,
  );
  assert.doesNotThrow(() =>
    assertAssistantClientScope(encodeAssistantInput("Show all clients"), {
      workspaceId: "business-b",
    }),
  );
  assert.deepEqual(decodeAssistantInput("An older saved message"), {
    message: "An older saved message",
  });
});
