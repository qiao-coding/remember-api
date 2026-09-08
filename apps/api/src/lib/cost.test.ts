/**
 * cost：成本估算桥接 models.dev 快照后的纯逻辑单测。
 * 不断言快照具体价格（会随版本漂移），只验公式、别名映射、兜底与 memoryOverhead。
 */
import { describe, expect, it } from "vitest";
import { estimateCost, lookupCost, memoryOverhead } from "./cost";

const flash = () => lookupCost("deepseek", "deepseek-v4-flash");
const pro = () => lookupCost("deepseek", "deepseek-v4-pro");

describe("lookupCost / 别名映射", () => {
  it("deepseek-chat 别名落到 v4-flash", () => {
    expect(flash()).toBeDefined();
    expect(lookupCost("deepseek", "deepseek-chat")).toEqual(flash());
  });

  it("deepseek-reasoner 别名落到 v4-pro", () => {
    expect(lookupCost("deepseek", "deepseek-reasoner")).toEqual(pro());
  });

  it("未知模型走兜底 flash，未知 provider 返回 undefined", () => {
    expect(lookupCost("deepseek", "some-unknown-model")).toEqual(flash());
    expect(lookupCost("anthropic", "deepseek-chat")).toBeUndefined();
  });
});

describe("estimateCost", () => {
  it("全零 → 0", () => {
    expect(estimateCost("deepseek", "deepseek-chat", 0, 0, 0)).toBe(0);
  });

  it("1M 输入按 input 单价（别名与官方档一致）", () => {
    const cost = flash()!;
    expect(estimateCost("deepseek", "deepseek-chat", 1_000_000, 0, 0)).toBeCloseTo(
      cost.input,
      10,
    );
    expect(estimateCost("deepseek", "deepseek-v4-flash", 1_000_000, 0, 0)).toBeCloseTo(
      cost.input,
      10,
    );
  });

  it("命中缓存按 cache_read 单价（缺省退 input）", () => {
    const cost = flash()!;
    // 100 input 全缓存：billedInput=0 → 只付 100 × cache_read/1e6
    const expected = (100 / 1e6) * (cost.cache_read ?? cost.input);
    expect(estimateCost("deepseek", "deepseek-chat", 100, 100, 0)).toBeCloseTo(
      expected,
      10,
    );
  });

  it("输出按 output 单价；输入扣掉缓存部分", () => {
    const cost = flash()!;
    expect(estimateCost("deepseek", "deepseek-chat", 0, 0, 1_000_000)).toBeCloseTo(
      cost.output,
      10,
    );
    // 50 input / 20 cached → billed 30，缓存按 cache_read
    const billed = (30 / 1e6) * cost.input;
    const cached = (20 / 1e6) * (cost.cache_read ?? cost.input);
    expect(estimateCost("deepseek", "deepseek-chat", 50, 20, 0)).toBeCloseTo(
      billed + cached,
      10,
    );
  });

  it("未知 provider → 0（不猜价）", () => {
    expect(estimateCost("foo-provider", "model", 100, 0, 0)).toBe(0);
  });
});

describe("memoryOverhead", () => {
  it("记忆/输入占比（1 位小数）", () => {
    expect(memoryOverhead(100, 4000)).toBe(2.5);
    expect(memoryOverhead(0, 4000)).toBe(0);
    expect(memoryOverhead(100, 0)).toBe(0);
  });
});
