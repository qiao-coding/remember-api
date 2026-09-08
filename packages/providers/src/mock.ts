import {
  type ChatChunk,
  type ChatRequest,
  type ChatResult,
  type ModelProvider,
} from "./base.js";
import { estimateTokens } from "@remember/core";
import type { ProviderId } from "@remember/shared";

/**
 * MockProvider —— 未配置真实 Key 时用于离线验证整条链路。
 * 生成与输入 token 数量相关的固定风格回复。
 */
export class MockProvider implements ModelProvider {
  readonly id: ProviderId;

  /** id 跟随 profile.provider，避免把离线请求记错到 deepseek */
  constructor(provider: ProviderId = "deepseek") {
    this.id = provider;
  }

  private reply(req: ChatRequest): string {
    const last = req.messages.at(-1);
    const promptTokens = req.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? ""),
      0,
    );
    return [
      "[mock] 已收到你的请求（链路验证通过）。",
      "",
      `消息数: ${req.messages.length} | 估算输入 tokens: ${promptTokens}`,
      `最后一条: ${(last?.content ?? "").slice(0, 120)}`,
      "",
      `配置 ${this.id} 的 API Key 后将替换为真实响应。`,
    ].join("\n");
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const promptTokens = req.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? ""),
      0,
    );
    const content = this.reply(req);
    return {
      id: "mock-" + crypto.randomUUID(),
      model: req.model,
      content,
      finishReason: "stop",
      usage: {
        promptTokens,
        completionTokens: estimateTokens(content),
        cachedTokens: 0,
      },
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const id = "mock-" + crypto.randomUUID();
    const full = this.reply(req);
    const promptTokens = req.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? ""),
      0,
    );
    // 逐行产出，模拟增量
    for (const line of full.split("\n")) {
      await new Promise((r) => setTimeout(r, 5));
      yield {
        id,
        model: req.model,
        delta: { content: line + "\n" },
        finishReason: null,
      };
    }
    yield {
      id,
      model: req.model,
      delta: {},
      finishReason: "stop",
      usage: {
        promptTokens,
        completionTokens: estimateTokens(full),
        cachedTokens: 0,
      },
    };
  }
}
