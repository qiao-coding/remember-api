/**
 * 成本估算（USD，按 token 计费）—— Dashboard 观测用。
 *
 * 价格来源桥接 models.dev 官方 typed client 的离线快照
 * （@opencode-ai/models/snapshot，数据最旧 ~24h，随依赖版本更新，运行时零网络），
 * 不再手写单价常量。DeepSeek 官方块只有 v4 命名，
 * 对老别名（deepseek-chat/deepseek-reasoner）做一层薄映射。
 */
import { providers } from "@opencode-ai/models/snapshot";

export const COST_CURRENCY = "USD";

/** DeepSeek 官方 models.dev 块只有 v4 命名；把运行期仍会出现的别名映射过去。 */
const DEEPSEEK_ALIAS: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};
/** 别名/未知模型兜底到最便宜的官方档，保证估算不中断。 */
const FALLBACK_MODEL = "deepseek-v4-flash";

/** 查某 provider/model 的单价（USD / 1M tokens）；查不到返回 undefined。 */
export function lookupCost(
  provider: string,
  model: string,
): { input: number; output: number; cache_read?: number } | undefined {
  const models = providers[provider]?.models;
  if (!models) return undefined;
  const direct = models[model]?.cost;
  if (direct) return direct;
  const aliased =
    provider === "deepseek" ? models[DEEPSEEK_ALIAS[model] ?? ""]?.cost : undefined;
  const fallback =
    provider === "deepseek" ? models[FALLBACK_MODEL]?.cost : undefined;
  return aliased ?? fallback;
}

export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number,
): number {
  const cost = lookupCost(provider, model);
  if (!cost) return 0;
  const billedInput = Math.max(0, inputTokens - cachedTokens);
  const cacheRead = cost.cache_read ?? cost.input;
  return (
    (billedInput / 1e6) * cost.input +
    (cachedTokens / 1e6) * cacheRead +
    (outputTokens / 1e6) * cost.output
  );
}

/** Memory Overhead 百分比（记忆 token / 总输入 token） */
export function memoryOverhead(memoryTokens: number, inputTokens: number): number {
  if (inputTokens <= 0) return 0;
  return Math.round((memoryTokens / inputTokens) * 1000) / 10;
}
