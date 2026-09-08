/** profiles 页表单解析/夹取 —— 纯函数，便于单测。 */

/** 空串或非法数字 → null（temperature/maxTokens 可空字段用）。 */
export function toNullableNumber(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export const MEMORY_BUDGET_DEFAULT = 1500;
export const MEMORY_BUDGET_MIN = 100;
export const MEMORY_BUDGET_MAX = 100_000;

/**
 * memoryBudget 提交值：空/NaN/0 → 默认 1500，其余夹到 [100, 100_000]。
 * 等价于原内联 `Math.max(100, Math.min(100_000, Number(v) || 1500))`。
 */
export function profileBudget(v: string): number {
  const n = Number(v);
  const base = Number.isFinite(n) && n > 0 ? n : MEMORY_BUDGET_DEFAULT;
  return Math.min(MEMORY_BUDGET_MAX, Math.max(MEMORY_BUDGET_MIN, base));
}
