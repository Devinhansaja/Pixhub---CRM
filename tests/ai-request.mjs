// Offline check of the request shape sent to the Claude API (mock fetch, no network, no cost).
import Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";

let captured;
const client = new Anthropic({
  apiKey: "test-key-not-real",
  fetch: async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: '{"message":"Hello","tips":"x"}' }], stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const res = await client.beta.messages.create({
  model: "claude-opus-5-5", max_tokens: 8000, system: "sys", cache_control: { type: "ephemeral" },
  messages: [{ role: "user", content: "hi" }],
  output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } } },
  betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
});

assert.match(captured.url, /\/v1\/messages(\?|$)/);
assert.equal(captured.headers.get("anthropic-beta"), "server-side-fallback-2026-07-01");
assert.equal(captured.body.model, "claude-opus-5-5");
assert.equal(captured.body.fallbacks, "default");
assert.equal(captured.body.output_config.effort, "low");
assert.equal(captured.body.output_config.format.type, "json_schema");
assert.deepEqual(captured.body.cache_control, { type: "ephemeral" });
assert.equal("betas" in captured.body, false, "betas must travel as a header, not in the body");
assert.equal("thinking" in captured.body, false);
assert.equal(res.stop_reason, "end_turn");
console.log("AI request shape OK:", Object.keys(captured.body).join(", "));
