/**
 * 网关内 agentic loop 单测 —— 假 ModelProvider 脚本化返回轮次。
 * 验证：首轮 toolCalls 二轮 stop 的多轮追加与 usage 聚合、executor 抛错吞成 tool 文本、
 * 超 maxRounds 强制终止不无限打钱、isToolUnsupportedError 判定。不触 DB/网络。
 */
import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  type ChatRequest,
  type ChatResult,
  type ChatUsage,
  type FunctionTool,
  type ModelProvider,
  type ToolCall,
} from "@remember/providers";
import type { ChatMessage, ProviderId } from "@remember/shared";
import {
  executeToolTurn,
  isToolUnsupportedError,
  runChatWithTools,
} from "./tool-loop.js";

const U1: ChatUsage = { promptTokens: 100, completionTokens: 20, cachedTokens: 40 };
const U2: ChatUsage = { promptTokens: 80, completionTokens: 15, cachedTokens: 60 };

const RECALL_TOOL: FunctionTool = {
  type: "function",
  name: "recall_memories",
  description: "查记忆",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
};

const CALL: ToolCall = {
  id: "c1",
  name: "recall_memories",
  input: '{"query":"技术栈"}',
};

function res(content: string, finishReason: string | null, extra: Partial<ChatResult> = {}): ChatResult {
  return { id: "cmpl_x", model: "m", content, finishReason, usage: U1, ...extra };
}

/** 假 provider：每次 chat 调 responder，记录所有请求；stream 空实现（不走到） */
function makeProvider(responder: (req: ChatRequest) => ChatResult) {
  const calls: ChatRequest[] = [];
  const provider: ModelProvider = {
    id: "fake" as ProviderId,
    async chat(req) {
      calls.push(req);
      return responder(req);
    },
    async *stream() {
      /* 未用 */
    },
  };
  return { provider, calls };
}

const SEED: ChatMessage[] = [{ role: "user", content: "上次定的技术栈是什么" }];

describe("runChatWithTools（agentic loop）", () => {
  it("首轮要工具 → 回填执行结果续轮 → 二轮 stop 收尾；usage 按轮聚合", async () => {
    const exec = vi.fn(async (_name: string, input: unknown) => {
      expect(input).toEqual({ query: "技术栈" });
      return "1. (preference) 数据库统一用 PostgreSQL";
    });
    const { provider, calls } = makeProvider((req) =>
      calls.length === 1
        ? res("先查一下", "tool-calls", {
            toolCalls: [CALL],
            usage: U1,
          })
        : res("技术栈是 PostgreSQL", "stop", { usage: U2 }),
    );

    const result = await runChatWithTools(provider, { model: "m", messages: SEED }, {
      tools: [RECALL_TOOL],
      exec,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    // 首轮请求带 tools
    expect(calls[0]!.tools).toEqual([RECALL_TOOL]);
    // 二轮 messages 追加了 assistant(tool_calls) + tool 结果两条
    const msgs = calls[1]!.messages;
    expect(msgs).toHaveLength(SEED.length + 2);
    const asst = msgs.at(-2)!;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toBe("先查一下");
    expect((asst.tool_calls as { id: string }[])?.[0]?.id).toBe("c1");
    const tool = msgs.at(-1)!;
    expect(tool.role).toBe("tool");
    expect(tool.tool_call_id).toBe("c1");
    expect(tool.name).toBe("recall_memories");
    expect(String(tool.content)).toContain("PostgreSQL");

    expect(result.content).toBe("技术栈是 PostgreSQL");
    expect(result.finishReason).toBe("stop");
    expect(result.toolRounds).toBe(1);
    // U1 + U2 聚合
    expect(result.usage).toEqual({
      promptTokens: 180,
      completionTokens: 35,
      cachedTokens: 100,
    });
  });

  it("executor 抛错 → 吞成 tool 降级文本继续（不中断整轮）", async () => {
    const exec = vi.fn(async () => {
      throw new Error("记忆后端崩了");
    });
    const { provider, calls } = makeProvider((req) =>
      calls.length === 1
        ? res("", "tool-calls", { toolCalls: [CALL] })
        : res("抱歉，我换个说法", "stop", { usage: U2 }),
    );

    const result = await runChatWithTools(provider, { model: "m", messages: SEED }, {
      tools: [RECALL_TOOL],
      exec,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const tool = calls[1]!.messages.at(-1)!;
    expect(tool.role).toBe("tool");
    expect(String(tool.content)).toContain("执行失败");
    expect(result.content).toBe("抱歉，我换个说法");
    expect(result.finishReason).toBe("stop");
  });

  it("超 maxRounds 仍要工具 → 强制终止（chat 有限次、不无限打钱）", async () => {
    const exec = vi.fn(async () => "结果");
    const { provider, calls } = makeProvider(() =>
      res("仍在查", "tool-calls", { toolCalls: [CALL] }),
    );

    const result = await runChatWithTools(provider, { model: "m", messages: SEED }, {
      tools: [RECALL_TOOL],
      exec,
      maxRounds: 2,
    });

    // chat 跑 maxRounds+1=3 次，exec 只跑 maxRounds=2 次
    expect(calls).toHaveLength(3);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(result.toolRounds).toBe(2);
    expect(result.finishReason).toBe("tool-calls");
  });
});

describe("executeToolTurn（wire 形状）", () => {
  it("append assistant(tool_calls) + 每工具一条 role:tool（带 tool_call_id/name）", async () => {
    const out = await executeToolTurn(SEED, "先查一下", [CALL], async () => "命中");
    expect(out).toHaveLength(3);
    const asst = out[1]!;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toBe("先查一下");
    expect(asst.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "recall_memories", arguments: '{"query":"技术栈"}' },
      },
    ]);
    const tool = out[2]!;
    expect(tool).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
      name: "recall_memories",
      content: "命中",
    });
  });
});

describe("isToolUnsupportedError", () => {
  it("status 400 且消息/码提 tool|function → true", () => {
    expect(isToolUnsupportedError(new ProviderError("tools 不被支持", 400))).toBe(true);
    expect(
      isToolUnsupportedError(new ProviderError("unsupported", 400, "function_call_not_allowed")),
    ).toBe(true);
    expect(isToolUnsupportedError(new ProviderError("tools 不支持", 400, "x"))).toBe(true);
  });

  it("400 但无关 / 非 400 / 非对象 → false", () => {
    expect(isToolUnsupportedError(new ProviderError("context 超长", 400))).toBe(false);
    expect(isToolUnsupportedError(new ProviderError("tools 挂了", 500))).toBe(false);
    expect(isToolUnsupportedError(null)).toBe(false);
    expect(isToolUnsupportedError("400 tools")).toBe(false);
  });
});
