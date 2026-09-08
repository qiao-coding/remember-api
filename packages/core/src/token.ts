/**
 * Token 估算 —— MVP 采用字符估算（CJK ≈ 1 token/字，拉丁 ≈ 4 字符/token）。
 * 最终统计必须以 Provider 返回的 usage 为准，这里只用于 Memory Budget 与成本观测。
 */

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿‘’“”〈-】]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.0 + rest / 4);
}

/** 按 token 预算截断文本（近似字符级） */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  // 保守：预算 token × 2.5 字符
  const maxChars = Math.floor(maxTokens * 2.5);
  return text.slice(0, maxChars);
}
