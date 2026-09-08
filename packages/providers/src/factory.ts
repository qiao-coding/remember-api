import type { ProviderId } from "@remember/shared";
import { MockProvider } from "./mock.js";
import { SdkModelProvider } from "./sdk.js";
import { ProviderError, type ModelProvider, type ProviderFactoryConfig } from "./base.js";

/**
 * Provider 工厂 —— 多模型注册中心（不再锁 deepseek）。
 *
 * 有 apiKey → AI SDK 桥（@ai-sdk/openai-compatible，统一 OpenAI 兼容协议，
 * 各家只是 baseURL 不同，见 sdk.ts DEFAULT_BASE_URL）；
 * 无 apiKey → MockProvider 离线验证链路（id 跟随 profile.provider）。
 */
export function createProvider(config: ProviderFactoryConfig): ModelProvider {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return new MockProvider(config.provider);

  if (config.provider === "custom" && !config.baseUrl?.trim()) {
    throw new ProviderError("custom Provider 需在配置中填写 baseUrl");
  }

  return new SdkModelProvider({
    provider: config.provider,
    apiKey,
    ...(config.baseUrl?.trim() && { baseUrl: config.baseUrl.trim() }),
    ...(config.fetch && { fetch: config.fetch }),
  });
}

export type { ModelProvider, ProviderId };
export * from "./base.js";
