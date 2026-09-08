import type { ChatMessage } from "@remember/shared";
import type { ProviderId } from "@remember/shared";

/** 统一模型请求（与 OpenAI 兼容但使用 snake_case 字段） */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
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
}

export interface ChatChunk {
  id: string;
  model: string;
  /** 增量内容 */
  delta: { content?: string | null };
  finishReason: string | null;
  /** 流结束 chunk 附带总用量 */
  usage?: ChatUsage;
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
