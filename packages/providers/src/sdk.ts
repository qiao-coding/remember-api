import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatMessage, ProviderId } from "@remember/shared";
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ChatResult,
  type ChatUsage,
  type ModelProvider,
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

/** 各家 OpenAI 兼容端点的默认 baseURL（custom 无默认，必须用户填） */
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
        : `暂不支持的 Provider: ${provider}`,
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

/** 我们的 ChatMessage[] → AI SDK V4 prompt（只保留文本语义） */
function toPrompt(messages: ChatMessage[]): Prompt {
  const out: Prompt = [];
  for (const m of messages) {
    const text = m.content ?? "";
    switch (m.role) {
      case "system":
        out.push({ role: "system", content: text });
        break;
      case "assistant":
        out.push({ role: "assistant", content: [{ type: "text", text }] });
        break;
      // tool 结果没有顶层角色：并入 user 文本，网关内模型不做工具调用
      case "tool":
      case "user":
        out.push({ role: "user", content: [{ type: "text", text }] });
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
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const gen = await this.modelFor(req.model).doGenerate(this.callOptions(req));
    return {
      id: "chatcmpl-" + crypto.randomUUID(),
      model: req.model,
      content: textFrom(gen.content),
      finishReason: gen.finishReason?.unified ?? null,
      usage: toUsage(gen.usage),
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const id = "chatcmpl-" + crypto.randomUUID();
    const { stream } = await this.modelFor(req.model).doStream(
      this.callOptions(req),
    );
    const reader = stream.getReader();
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
        } else if (value.type === "finish") {
          yield {
            id,
            model: req.model,
            delta: {},
            finishReason: value.finishReason?.unified ?? null,
            ...(value.usage ? { usage: toUsage(value.usage) } : {}),
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
