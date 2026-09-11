import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatMessage, ProviderId } from "@remember/shared";
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ChatResult,
  type ChatUsage,
  type ModelProvider,
  type ToolCall,
} from "./base.js";

/**
 * AI SDK（openai-compatible）桥接层 —— 替换手写的 fetch + SSE 解析。
 *
 * 原则：不自己处理各家 API 的格式兼容，交给现成桥接器。所有 Provider
 * 统一走 OpenAI 兼容协议，由 @ai-sdk/openai-compatible 负责请求序列化、
 * SSE 解析、用量归一化（含 cached_tokens → cacheRead 透出）：
 * - deepseek / openai / openrouter / custom 原生就是 OpenAI 兼容协议；
 * - anthropic 官方也提供 `POST /v1/chat/completions` 兼容端点。
 * 各家底座唯一的差别就是 baseURL，由 createProvider 按 provider 注册。
 */

export interface SdkProviderSettings {
  provider: ProviderId;
  /** 明文 Provider API Key（工厂已保证非空才会走到这里） */
  apiKey: string;
  baseUrl?: string;
  /** 测试注入用；缺省走 SDK 内部全局 fetch */
  fetch?: typeof fetch;
}

type CompatProvider = ReturnType<typeof createOpenAICompatible>;
/** openai-compatible 暴露的底层模型（LanguageModelV4） */
export type SdkLanguageModel = ReturnType<CompatProvider["chatModel"]>;
type DoOptions = Parameters<SdkLanguageModel["doGenerate"]>[0];
type Prompt = DoOptions["prompt"];
type PromptMessage = Prompt[number];
type GenerateResult = Awaited<ReturnType<SdkLanguageModel["doGenerate"]>>;

/**
 * 精选厂商的默认 baseURL —— **不是全集**。
 *
 * models.dev 目录里 173 家能走这层 OpenAI 兼容桥，但只有这 4 家有内置默认端点；
 * 其余（含目录里 26 家没有 `api` 字段的）必须由配置显式提供 baseUrl，否则每次请求都 400。
 * CLI 从目录的 `provider.api` 写入 provider_configs.baseUrl，正是为了让这张表不必再长大。
 */
const DEFAULT_BASE_URL: Partial<Record<ProviderId, string>> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export function resolveBaseUrl(provider: ProviderId, baseUrl?: string): string {
  if (baseUrl?.trim()) return baseUrl.trim().replace(/\/+$/, "");
  const fallback = DEFAULT_BASE_URL[provider];
  if (!fallback) {
    throw new ProviderError(
      provider === "custom"
        ? "custom Provider 需要在配置里填写 baseUrl"
        : `Provider「${provider}」没有内置默认端点，需要在 provider 配置里填写 baseUrl。`,
    );
  }
  return fallback;
}

/** 构造一个绑定到指定模型 id 的 AI SDK 模型对象 */
export function createLanguageModel(
  provider: ProviderId,
  model: string,
  settings: SdkProviderSettings,
): SdkLanguageModel {
  const options: {
    name: string;
    baseURL: string;
    apiKey: string;
    includeUsage: boolean;
    fetch?: unknown;
  } = {
    name: provider,
    baseURL: resolveBaseUrl(provider, settings.baseUrl),
    apiKey: settings.apiKey,
    includeUsage: true, // 流式也带上 usage（cost 面板依赖 cacheRead）
  };
  if (settings.fetch) options.fetch = settings.fetch;
  return createOpenAICompatible(
    options as Parameters<typeof createOpenAICompatible>[0],
  ).chatModel(model);
}

/** wire 层 assistant 携带的 tool_calls 形状（OpenAI 兼容） */
interface WireToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

/** 上游返回的 arguments（stringified JSON）→ object（反向序列化要 object，否则二次包引号 → 400） */
function parseArguments(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (args && typeof args === "object") return args as Record<string, unknown>;
  return {};
}

/** 模型侧 tool-call 的 input → 我们 ToolCall.input（stringified JSON 字符串） */
function stringifyToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

/** 我们的 ChatMessage[] → AI SDK V4 prompt（文本 + 工具语义） */
function toPrompt(messages: ChatMessage[]): Prompt {
  const out: Prompt = [];
  for (const m of messages) {
    const text = m.content ?? "";
    switch (m.role) {
      case "system":
        out.push({ role: "system", content: text });
        break;
      case "assistant": {
        // 工具轮：先 text part（有内容才推），再每 tool_calls → tool-call part
        const parts: unknown[] = [];
        if (text) parts.push({ type: "text", text });
        for (const raw of m.tool_calls ?? []) {
          const tc = raw as WireToolCall;
          if (!tc?.id || !tc.function?.name) continue;
          parts.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parseArguments(tc.function.arguments),
          });
        }
        // 兜底：纯空 assistant（无文本无工具）保持原出站形状
        if (!parts.length) parts.push({ type: "text", text: "" });
        out.push({ role: "assistant", content: parts } as Prompt[number]);
        break;
      }
      // tool 结果：有 tool_call_id + name 才是真 tool 消息 → tool-result part；
      // 无标识（inbound 残留，无前导 assistant tool_calls）→ 兜底并入 user 文本
      case "tool":
        if (m.tool_call_id && m.name) {
          out.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: m.tool_call_id,
                toolName: m.name,
                output: { type: "text", value: text },
              },
            ],
          } as Prompt[number]);
        } else {
          out.push({ role: "user", content: [{ type: "text", text }] } as Prompt[number]);
        }
        break;
      case "user":
        out.push({ role: "user", content: [{ type: "text", text }] } as Prompt[number]);
        break;
    }
  }
  return out;
}

/** AI SDK V4 usage → 我们的 ChatUsage（cachedTokens = cacheRead） */
function toUsage(u: GenerateResult["usage"] | undefined): ChatUsage {
  return {
    promptTokens: u?.inputTokens?.total ?? 0,
    completionTokens: u?.outputTokens?.total ?? 0,
    cachedTokens: u?.inputTokens?.cacheRead ?? 0,
  };
}

/** 从 content parts 里拼出纯文本（reasoning/tool 等非文本部分忽略） */
function textFrom(parts: GenerateResult["content"]): string {
  let out = "";
  for (const p of parts) if (p.type === "text") out += p.text;
  return out;
}

/** 从 content parts 里提取工具调用（doGenerate 结果侧） */
function extractToolCalls(content: GenerateResult["content"]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const p of content) {
    if (p.type === "tool-call") {
      out.push({ id: p.toolCallId, name: p.toolName, input: stringifyToolInput(p.input) });
    }
  }
  return out;
}

/** AI SDK 桥适配到统一的 ModelProvider 接口（chat.ts 消费面不变） */
export class SdkModelProvider implements ModelProvider {
  readonly id: ProviderId;

  constructor(private readonly settings: SdkProviderSettings) {
    this.id = settings.provider;
  }

  private modelFor(modelId: string): SdkLanguageModel {
    return createLanguageModel(this.settings.provider, modelId, this.settings);
  }

  private callOptions(req: ChatRequest): DoOptions {
    return {
      prompt: toPrompt(req.messages),
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.max_tokens !== undefined && { maxOutputTokens: req.max_tokens }),
      ...(req.top_p !== undefined && { topP: req.top_p }),
      // 工具定义仅在请求显式提供时附加；缺省不带，维持纯文本桥旧行为。
      // 不给 toolChoice：V4 缺省 auto（模型自行决定是否调），透传类型又各家不一。
      ...(req.tools?.length && { tools: req.tools as DoOptions["tools"] }),
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const gen = await this.modelFor(req.model).doGenerate(this.callOptions(req));
    const toolCalls = extractToolCalls(gen.content);
    return {
      id: "chatcmpl-" + crypto.randomUUID(),
      model: req.model,
      content: textFrom(gen.content),
      finishReason: gen.finishReason?.unified ?? null,
      usage: toUsage(gen.usage),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const id = "chatcmpl-" + crypto.randomUUID();
    const { stream } = await this.modelFor(req.model).doStream(
      this.callOptions(req),
    );
    const reader = stream.getReader();
    // 该轮累积的工具调用（挂在 finish chunk 上；忽略 tool-input-* 中间态）
    const roundToolCalls: ToolCall[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta") {
          yield {
            id,
            model: req.model,
            delta: { content: value.delta },
            finishReason: null,
          };
        } else if (value.type === "tool-call") {
          roundToolCalls.push({
            id: value.toolCallId,
            name: value.toolName,
            input: stringifyToolInput(value.input),
          });
        } else if (value.type === "finish") {
          yield {
            id,
            model: req.model,
            delta: {},
            finishReason: value.finishReason?.unified ?? null,
            ...(value.usage ? { usage: toUsage(value.usage) } : {}),
            ...(roundToolCalls.length ? { toolCalls: roundToolCalls } : {}),
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
