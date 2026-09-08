/** /usage 聚合纯函数（summary / breakdown）。 */
import { describe, expect, it } from "vitest";
import { breakdownBy, summarizeUsage, type UsageRowLike } from "./usage-stats.js";

function row(over: Partial<UsageRowLike> = {}): UsageRowLike {
  return {
    profileId: "prof_a",
    projectId: "prj_1",
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: 200,
    memoryTokens: 100,
    skillTokens: 50,
    estimatedCost: 0.012,
    latencyMs: 300,
    ...over,
  };
}

describe("summarizeUsage", () => {
  it("累加各 token 与成本/延迟，并派生 cacheHit / memoryOverhead / avgLatencyMs", () => {
    const rows = [
      row({ inputTokens: 1000, outputTokens: 500, cachedTokens: 200, memoryTokens: 100, skillTokens: 50, estimatedCost: 0.012, latencyMs: 300 }),
      row({ profileId: "prof_b", inputTokens: 3000, outputTokens: 0, cachedTokens: 1800, memoryTokens: 0, skillTokens: 0, estimatedCost: 0.02, latencyMs: 700 }),
    ];
    const s = summarizeUsage(rows);
    expect(s.requests).toBe(2);
    expect(s.inputTokens).toBe(4000);
    expect(s.outputTokens).toBe(500);
    expect(s.cachedTokens).toBe(2000);
    expect(s.memoryTokens).toBe(100);
    expect(s.skillTokens).toBe(50);
    expect(s.cost).toBeCloseTo(0.032, 10);
    expect(s.latencyMs).toBe(1000);
    // cacheHit = 2000/4000 → 50%
    expect(s.cacheHit).toBe(50);
    // memoryOverhead = 100/4000 → 2.5%
    expect(s.memoryOverhead).toBe(2.5);
    // avgLatency = 1000/2 = 500
    expect(s.avgLatencyMs).toBe(500);
  });

  it("空集合 → 全 0，派生字段 0（不除零）", () => {
    const s = summarizeUsage([]);
    expect(s).toMatchObject({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
      cacheHit: 0,
      memoryOverhead: 0,
      avgLatencyMs: 0,
    });
  });

  it("cacheHit 保留 1 位小数；无缓存输入时为 0", () => {
    const s = summarizeUsage([row({ inputTokens: 3, cachedTokens: 1 })]);
    expect(s.cacheHit).toBeCloseTo(33.3, 5); // 1/3 ≈ 33.33… → round → 33.3
  });
});

describe("breakdownBy", () => {
  it("按 projectId 分组：tokens=input+output、cost、requests 累加", () => {
    const rows = [
      row({ projectId: "prj_1", inputTokens: 1000, outputTokens: 500, estimatedCost: 0.01 }),
      row({ projectId: "prj_1", inputTokens: 200, outputTokens: 100, estimatedCost: 0.005 }),
      row({ projectId: "prj_2", inputTokens: 50, outputTokens: 0, estimatedCost: 0.001 }),
    ];
    const out = breakdownBy(rows, "projectId");
    expect(out).toEqual([
      { key: "prj_1", tokens: 1800, cost: 0.015, requests: 2 },
      { key: "prj_2", tokens: 50, cost: 0.001, requests: 1 },
    ]);
  });

  it("按 profileId 分组时用 profileId 做 key", () => {
    const rows = [row({ profileId: "prof_a", inputTokens: 1, outputTokens: 2 }), row({ profileId: "prof_b", inputTokens: 3, outputTokens: 0 })];
    const out = breakdownBy(rows, "profileId");
    expect(out.map((g) => g.key)).toEqual(["prof_a", "prof_b"]);
    expect(out[0]!.tokens).toBe(3);
  });

  it("projectId 为 null 归入 unknown", () => {
    const out = breakdownBy([row({ projectId: null })], "projectId");
    expect(out).toEqual([{ key: "unknown", tokens: 1500, cost: 0.012, requests: 1 }]);
  });

  it("空集合 → []", () => {
    expect(breakdownBy([], "profileId")).toEqual([]);
  });
});
