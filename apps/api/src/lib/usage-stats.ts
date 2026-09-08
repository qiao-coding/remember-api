/** /usage 聚合纯函数 —— 从路由内嵌 reduce 抽出，便于 fixture 单测。 */
import { memoryOverhead } from "./cost.js";

/** requestUsage 行中参与聚合的字段（其余列不影响）。 */
export interface UsageRowLike {
  profileId: string;
  projectId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  memoryTokens: number;
  skillTokens: number;
  estimatedCost: number;
  latencyMs: number;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  memoryTokens: number;
  skillTokens: number;
  cost: number;
  latencyMs: number;
  cacheHit: number;
  memoryOverhead: number;
  avgLatencyMs: number;
}

/** 汇总行集合：累加 + 派生 cacheHit / memoryOverhead / avgLatencyMs。 */
export function summarizeUsage(rows: readonly UsageRowLike[]): UsageSummary {
  const totals = rows.reduce(
    (acc, r) => {
      acc.inputTokens += r.inputTokens;
      acc.outputTokens += r.outputTokens;
      acc.cachedTokens += r.cachedTokens;
      acc.memoryTokens += r.memoryTokens;
      acc.skillTokens += r.skillTokens;
      acc.cost += r.estimatedCost;
      acc.latencyMs += r.latencyMs;
      return acc;
    },
    {
      requests: rows.length,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      memoryTokens: 0,
      skillTokens: 0,
      cost: 0,
      latencyMs: 0,
    },
  );

  return {
    ...totals,
    cacheHit:
      totals.inputTokens > 0
        ? Math.round((totals.cachedTokens / totals.inputTokens) * 1000) / 10
        : 0,
    memoryOverhead: memoryOverhead(totals.memoryTokens, totals.inputTokens),
    avgLatencyMs:
      totals.requests > 0 ? Math.round(totals.latencyMs / totals.requests) : 0,
  };
}

export type UsageBreakdownGroup = "profileId" | "projectId";

/** 按 profile/project 分组合并 token/cost/requests。 */
export function breakdownBy(
  rows: readonly UsageRowLike[],
  groupBy: UsageBreakdownGroup,
): { key: string; tokens: number; cost: number; requests: number }[] {
  const map = new Map<string, { tokens: number; cost: number; requests: number }>();
  for (const r of rows) {
    const key = r[groupBy] ?? "unknown";
    const cur = map.get(key) ?? { tokens: 0, cost: 0, requests: 0 };
    cur.tokens += r.inputTokens + r.outputTokens;
    cur.cost += r.estimatedCost;
    cur.requests += 1;
    map.set(key, cur);
  }
  return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
}
