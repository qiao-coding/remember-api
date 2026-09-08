/**
 * OpenAI-compatible 请求/响应 DTO —— 网关对外契约。
 * 字段命名遵循 OpenAI 惯例（snake_case）。
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface ChatCompletionRequest {
  /** 客户端视角 = Profile name */
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** remember-api 扩展字段（可选） */
  remember?: {
    project?: string;
    memory?: boolean;
    memoryBudget?: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: ChatRole; content?: string | null; tool_calls?: unknown[] };
    finish_reason: string | null;
  }[];
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: ChatRole; content: string | null };
    finish_reason: string | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export interface ModelListResponse {
  object: "list";
  data: { id: string; object: "model"; owned_by: string }[];
}

/** 生成 SSE 行 */
export function sseChunk(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";
