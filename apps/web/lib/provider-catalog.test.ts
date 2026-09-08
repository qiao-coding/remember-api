/**
 * provider-catalog 收敛 deepseek 默认值的单一数据源（B2）。
 * 若未来后端放开第二个 provider，先改 catalog 再放开后端，此测试约束 catalog 本身稳定。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  KNOWN_PROVIDERS,
  providerMeta,
} from "./provider-catalog";

describe("provider-catalog", () => {
  it("DEFAULT_PROVIDER 即第一个条目，指向 deepseek", () => {
    expect(DEFAULT_PROVIDER.key).toBe("deepseek");
    expect(DEFAULT_PROVIDER).toBe(KNOWN_PROVIDERS[0]);
  });

  it("deepseek 元数据完整（model/baseUrl 非空且形态正确）", () => {
    const p = providerMeta("deepseek");
    expect(p?.label).toBe("DeepSeek");
    expect(p?.defaultModel).toMatch(/^[a-z0-9-]+$/);
    expect(p?.defaultBaseUrl).toMatch(/^https:\/\/.+$/);
  });

  it("未知 / 空 key 返回 undefined（不崩溃）", () => {
    expect(providerMeta("anthropic")).toBeUndefined();
    expect(providerMeta(null)).toBeUndefined();
    expect(providerMeta(undefined)).toBeUndefined();
  });
});
