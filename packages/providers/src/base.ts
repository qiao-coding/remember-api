import type { ChatMessage } from "@remember/shared";
import type { ProviderId } from "@remember/shared";

/**
 * 出站工具（function calling）——结构兼容 AI SDK V4 的 tool 定义，
 * 但不 import @ai-sdk 类型（避免 MockProvider 侧被迫依赖 AI SDK）。
 */
export interface FunctionTool {
  type: "function";
  name: string;
  description?: string;
  /** JSON Schema（AI SDK 侧为 inputSchema） */
  inputSchema: Record<string, unknown>;
}

/** 一轮里模型要求的工具调用；input = stringified JSON args（回填时字符串透传，不二次 parse） */
export interface ToolCall {
  id: string;
  name: string;
  input: string;
}

/** 统一模型请求（与 OpenAI 兼容但使用 snake_case 字段） */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** 出站附加工具（网关内用：recall_memories 记忆检索）；缺省 auto 决定是否调用 */
  tools?: FunctionTool[];
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface ChatResult {
  id: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage: ChatUsage;
  /** finishReason==='tool-calls' 时携带本轮工具调用（input=stringified JSON args） */
  toolCalls?: ToolCall[];
}

export interface ChatChunk {
  id: string;
  model: string;
  /** 增量内容 */
  delta: { content?: string | null };
  finishReason: string | null;
  /** 流结束 chunk 附带总用量 */
  usage?: ChatUsage;
  /** 本轮模型要求的工具调用（挂在 finish chunk 上；input=stringified JSON args） */
  toolCalls?: ToolCall[];
}

export interface ModelProvider {
  readonly id: ProviderId;
  chat(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
}

/** Provider 工厂配置 */
export interface ProviderFactoryConfig {
  provider: ProviderId;
  /** 明文 Provider API Key */
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** 测试注入用；缺省走全局 fetch */
  fetch?: typeof fetch;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** 多轮工具循环的各轮 usage 聚合 */
export function sumUsage(a: ChatUsage | null, b: ChatUsage): ChatUsage {
  const base = a ?? { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
  return {
    promptTokens: base.promptTokens + b.promptTokens,
    completionTokens: base.completionTokens + b.completionTokens,
    cachedTokens: base.cachedTokens + b.cachedTokens,
  };
}
