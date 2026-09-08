/** profiles 页表单解析/夹取（预算边界回归点）。 */
import { describe, expect, it } from "vitest";
import {
  MEMORY_BUDGET_DEFAULT,
  MEMORY_BUDGET_MAX,
  MEMORY_BUDGET_MIN,
  profileBudget,
  toNullableNumber,
} from "./profiles";

describe("toNullableNumber", () => {
  it("空 / 纯空白 → null", () => {
    expect(toNullableNumber("")).toBeNull();
    expect(toNullableNumber("   ")).toBeNull();
  });

  it("非数字 → null", () => {
    expect(toNullableNumber("abc")).toBeNull();
    expect(toNullableNumber("12px")).toBeNull();
  });

  it("合法数字 → number", () => {
    expect(toNullableNumber("12")).toBe(12);
    expect(toNullableNumber("-0.5")).toBe(-0.5);
    expect(toNullableNumber(" 42 ")).toBe(42);
  });
});

describe("profileBudget", () => {
  it("空 / NaN / 0 / 负数 → 默认 1500", () => {
    expect(profileBudget("")).toBe(MEMORY_BUDGET_DEFAULT);
    expect(profileBudget("   ")).toBe(MEMORY_BUDGET_DEFAULT);
    expect(profileBudget("abc")).toBe(MEMORY_BUDGET_DEFAULT);
    expect(profileBudget("0")).toBe(MEMORY_BUDGET_DEFAULT);
    expect(profileBudget("-5")).toBe(MEMORY_BUDGET_DEFAULT);
  });

  it("常规值原样返回", () => {
    expect(profileBudget("1200")).toBe(1200);
    expect(profileBudget("1500")).toBe(MEMORY_BUDGET_DEFAULT);
  });

  it("夹到 [100, 100_000]", () => {
    expect(profileBudget("50")).toBe(MEMORY_BUDGET_MIN);
    expect(profileBudget("200000")).toBe(MEMORY_BUDGET_MAX);
    expect(profileBudget("999")).toBe(999);
  });
});
