import type { ChatMessage } from "@remember/shared";
import type {
  ChatRequest,
  ChatResult,
  ChatUsage,
  FunctionTool,
  ModelProvider,
  ToolCall,
} from "@remember/providers";
import { sumUsage } from "@remember/providers";

/**
 * 网关内 agentic loop —— 让"自己"按需执行上游声明的工具。
 *
 * 客户端零感知：它只发普通 chat（无 tools），网关把 recall_memories 声明给
 * 上游 LLM；模型要查 → 网关循环内自己跑 executor 回填 tool 结果 → 继续喂给
 * 模型，直到不再要工具。最终只把收尾轮的文本回给客户端。
 */

export const DEFAULT_MAX_TOOL_ROUNDS = 3;

/** 执行一个工具调用，返回给模型的纯文本结果。抛错由调用方吞成 tool 结果文本。 */
export type ToolExecutor = (name: string, input: unknown) => Promise<string>;

/** 上游对 tools 完全不支持的错（status 400 且提到 tool/function）→ 去 tools 重发 */
export function isToolUnsupportedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    response?: { status?: unknown };
    code?: unknown;
  };
  const status = Number(
    e.status ?? e.statusCode ?? e.response?.status ?? 0,
  );
  if (status !== 400) return false;
  const msg = String(e.message ?? "") + " " + String(e.code ?? "");
  return /tool|function/i.test(msg);
}

/** 工具调用的 stringified JSON args → object（解析失败空对象，executor 自兜底） */
function parseInput(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 把工具轮追加进对话：assistant(tool_calls) 消息 + 每条工具结果 role:'tool' 消息。
 * 返回新 messages（不原地改）。assistantText 为该轮模型已吐文本（无则 null）。
 */
export async function executeToolTurn(
  messages: ChatMessage[],
  assistantText: string,
  toolCalls: ToolCall[],
  exec: ToolExecutor,
): Promise<ChatMessage[]> {
  const assistant: ChatMessage = {
    role: "assistant",
    content: assistantText || null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.input },
    })),
  };
  const results: ChatMessage[] = [];
  for (const tc of toolCalls) {
    let text: string;
    try {
      text = await exec(tc.name, parseInput(tc.input));
    } catch (err) {
      // executor 本身已承诺不 throw；这里兜底，绝不让工具轮拖垮整轮
      console.warn(`[tool-loop] ${tc.name} 执行失败:`, err);
      text = `（工具 ${tc.name} 执行失败，请基于已知信息回答）`;
    }
    results.push({
      role: "tool",
      tool_call_id: tc.id,
      name: tc.name,
      content: text,
    });
  }
  return [...messages, assistant, ...results];
}

export interface RunWithToolsOptions {
  tools?: FunctionTool[];
  exec: ToolExecutor;
  maxRounds?: number;
}

export interface ToolLoopResult {
  content: string;
  finishReason: string | null;
  usage: ChatUsage;
  /** 实际跑了几轮工具（0 = 模型没要工具） */
  toolRounds: number;
}

/**
 * 串行多轮工具对话。每轮 chat 带 tools；模型要求工具 → 执行并续轮，直到
 * 不再要求（或超 maxRounds 兜底退出）。usage 按轮聚合（sumUsage）。
 */
export async function runChatWithTools(
  provider: ModelProvider,
  request: ChatRequest,
  opts: RunWithToolsOptions,
): Promise<ToolLoopResult> {
  const { tools, exec, maxRounds = DEFAULT_MAX_TOOL_ROUNDS } = opts;
  let messages = request.messages;
  let usage: ChatUsage | null = null;
  let toolRounds = 0;
  let lastContent = "";
  let finishReason: string | null = null;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await provider.chat({
      ...request,
      messages,
      ...(tools?.length ? { tools } : {}),
    });
    usage = sumUsage(usage, res.usage);
    finishReason = res.finishReason;
    if (res.content) lastContent = res.content;

    const calls = res.toolCalls ?? [];
    if (!calls.length) {
      return {
        content: lastContent,
        finishReason,
        usage: usage!,
        toolRounds,
      };
    }
    // 已达上限仍要工具 → 不再续轮，把上一轮模型已吐文本当结果（不无限打钱）
    if (toolRounds >= maxRounds) {
      console.warn(`[tool-loop] 超过 ${maxRounds} 轮工具调用，强制终止`);
      return { content: lastContent, finishReason, usage: usage!, toolRounds };
    }
    messages = await executeToolTurn(
      messages,
      res.content,
      calls,
      exec,
    );
    toolRounds++;
  }
  // 理论到不了这（循环内已 return）
  return { content: lastContent, finishReason, usage: usage!, toolRounds };
}
