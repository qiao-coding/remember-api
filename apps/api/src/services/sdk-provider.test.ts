/**
 * 多模型 Provider 层（AI SDK 桥）离线单测。
 *
 * 通过 fetch 注入喂标准 OpenAI 兼容响应，不真打网络：
 * - 替换手写 SSE 后，非流式/流式的文本、finishReason、usage（含 cached_tokens→cachedTokens）
 *   端到端仍正确透出（cost 面板依赖此映射，防回归）；
 * - provider 不再锁 deepseek：custom 缺 baseUrl 拒绝、无 key 回退 MockProvider 且 id 跟随。
 */
import { describe, expect, it } from "vitest";
import { createProvider } from "@remember/providers";

function jsonRes(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseRes(lines: (string | object)[]) {
  const body = lines
    .map((l) => (typeof l === "string" ? l : `data: ${JSON.stringify(l)}\n\n`))
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const MODEL = "deepseek-chat";
const USAGE = {
  prompt_tokens: 120,
  completion_tokens: 30,
  total_tokens: 150,
  prompt_tokens_details: { cached_tokens: 80 },
};

/** 记录所有出站请求，按 stream 与否分别回包 */
function fakeFetch(requests: { url: string; body: any }[]) {
  return async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    if (body.stream) {
      return sseRes([
        { id: "c1", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta: { content: "你" }, finish_reason: null }] },
        { id: "c1", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta: { content: "好" }, finish_reason: null }] },
        { id: "c1", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: USAGE },
        "data: [DONE]\n\n",
      ]);
    }
    return jsonRes({
      id: "c1",
      object: "chat.completion",
      created: 1,
      model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: "你好" }, finish_reason: "stop" }],
      usage: USAGE,
    });
  };
}

describe("createProvider 多模型路由", () => {
  it("有 key → SdkModelProvider；无 key → MockProvider 且 id 跟随 provider", () => {
    const real = createProvider({ provider: "anthropic", apiKey: "sk-x" });
    expect(real.constructor.name).toBe("SdkModelProvider");
    expect(real.id).toBe("anthropic");

    const mock = createProvider({ provider: "anthropic" });
    expect(mock.constructor.name).toBe("MockProvider");
    expect(mock.id).toBe("anthropic");
    expect(mock.id).not.toBe("deepseek");
  });

  it("custom 有 key 但没 baseUrl → 拒绝（必须用户填）", () => {
    expect(() => createProvider({ provider: "custom", apiKey: "sk-x" })).toThrow(
      /baseUrl/,
    );
  });
});

describe("SdkModelProvider.chat（非流式）", () => {
  it("文本/finishReason/usage 映射正确，cached_tokens→cachedTokens", async () => {
    const requests: { url: string; body: any }[] = [];
    const provider = createProvider({
      provider: "deepseek",
      apiKey: "sk-x",
      baseUrl: "https://example.test",
      fetch: fakeFetch(requests) as unknown as typeof fetch,
    });

    const res = await provider.chat({
      model: MODEL,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "tool", content: "tool-result" },
      ],
      temperature: 0.7,
      max_tokens: 200,
      top_p: 0.9,
    });

    expect(res.content).toBe("你好");
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      cachedTokens: 80,
    });

    expect(requests[0]!.url).toMatch(/example\.test/);
    const sent = requests[0]!.body;
    // snake_case 请求字段 + tool 结果归并进 user 文本
    expect(sent.temperature).toBe(0.7);
    expect(sent.max_tokens).toBe(200);
    expect(sent.top_p).toBe(0.9);
    expect(sent.messages.map((m: any) => m.role)).toEqual([
      "system",
      "user",
      "user",
    ]);
  });
});

describe("SdkModelProvider 工具透传（function calling）", () => {
  const TOOL = {
    type: "function" as const,
    name: "recall_memories",
    description: "查记忆",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  };

  it("非流式：出站带 tools；上游回 tool_calls → res.toolCalls(input stringified)", async () => {
    const requests: { body: any }[] = [];
    const fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      requests.push({ body });
      return jsonRes({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "recall_memories",
                    arguments: '{"query":"上次定的技术栈"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: USAGE,
      });
    };
    const provider = createProvider({
      provider: "deepseek",
      apiKey: "sk-x",
      baseUrl: "https://example.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const res = await provider.chat({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      tools: [TOOL],
    });

    expect(res.finishReason).toBe("tool-calls");
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "recall_memories", input: '{"query":"上次定的技术栈"}' },
    ]);
    expect(requests[0]!.body.tools?.[0]?.function?.name).toBe("recall_memories");
  });

  it("入站 assistant(tool_calls)+tool 结果 → 出站真 tool 消息带 tool_call_id（arguments 是序列化对象非二次包裹）", async () => {
    const requests: { body: any }[] = [];
    const fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      requests.push({ body });
      return jsonRes({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: MODEL,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "好的" },
            finish_reason: "stop",
          },
        ],
        usage: USAGE,
      });
    };
    const provider = createProvider({
      provider: "deepseek",
      apiKey: "sk-x",
      baseUrl: "https://example.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await provider.chat({
      model: MODEL,
      messages: [
        { role: "user", content: "技术栈是什么" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_9",
              type: "function",
              function: { name: "recall_memories", arguments: '{"query":"技术栈"}' },
            },
          ],
        },
        {
          role: "tool",
          content: "1. (preference) PostgreSQL",
          tool_call_id: "call_9",
          name: "recall_memories",
        },
        { role: "user", content: "继续" },
      ],
      tools: [TOOL],
    });

    const msgs = requests[0]!.body.messages;
    const asst = msgs[1];
    expect(asst.role).toBe("assistant");
    expect(asst.tool_calls?.[0]?.id).toBe("call_9");
    // arguments 出站为 JSON.stringify 后的字符串，可 parse 回对象（非字面再包一层引号）
    expect(JSON.parse(asst.tool_calls?.[0]?.function?.arguments)).toEqual({
      query: "技术栈",
    });
    const tool = msgs[2];
    expect(tool.role).toBe("tool");
    expect(tool.tool_call_id).toBe("call_9");
    expect(tool.content).toContain("PostgreSQL");
  });

  it("流式：delta.tool_calls → finish chunk 带 toolCalls", async () => {
    const requests: { body: any }[] = [];
    const fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      requests.push({ body });
      return sseRes([
        {
          id: "c1", object: "chat.completion.chunk", model: MODEL,
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "recall_memories", arguments: "" } }] }, finish_reason: null }],
        },
        {
          id: "c1", object: "chat.completion.chunk", model: MODEL,
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"x"}' } }] }, finish_reason: null }],
        },
        {
          id: "c1", object: "chat.completion.chunk", model: MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: USAGE,
        },
        "data: [DONE]\n\n",
      ]);
    };
    const provider = createProvider({
      provider: "deepseek",
      apiKey: "sk-x",
      baseUrl: "https://example.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const chunks = [];
    for await (const c of provider.stream({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      tools: [TOOL],
    })) {
      chunks.push(c);
    }

    expect(requests[0]!.body.stream).toBe(true);
    expect(requests[0]!.body.tools?.[0]?.function?.name).toBe("recall_memories");
    const last = chunks.at(-1)!;
    expect(last.finishReason).toBe("tool-calls");
    expect(last.toolCalls).toEqual([
      { id: "call_2", name: "recall_memories", input: expect.stringContaining("query") },
    ]);
  });
});

describe("SdkModelProvider.stream（流式）", () => {
  it("增量文本 + 末尾 finish chunk 带 usage", async () => {
    const requests: { url: string; body: any }[] = [];
    const provider = createProvider({
      provider: "deepseek",
      apiKey: "sk-x",
      baseUrl: "https://example.test",
      fetch: fakeFetch(requests) as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const c of provider.stream({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(c);
    }

    const text = chunks
      .map((c) => c.delta.content ?? "")
      .join("");
    expect(text).toBe("你好");

    const last = chunks.at(-1)!;
    expect(last.finishReason).toBe("stop");
    expect(last.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      cachedTokens: 80,
    });

    // openai-compatible 自动带 stream_options.include_usage（cost 依赖）
    expect(requests[0]!.body.stream).toBe(true);
    expect(requests[0]!.body.stream_options).toEqual({ include_usage: true });
  });
});
