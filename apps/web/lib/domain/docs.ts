/** docs 页 API Key 行样/掩码 —— 纯函数，便于单测。 */

export interface KeyLike {
  disabled: boolean;
  prefix: string;
  last4: string;
}

/** 取最近一个启用的 key；没有则 null（页面用 disabledKey 兜底展示）。 */
export function firstEnabledKey<T extends KeyLike>(keys: readonly T[]): T | null {
  return keys.find((k) => !k.disabled) ?? null;
}

/** 取最近一个禁用的 key；没有则 null。 */
export function firstDisabledKey<T extends KeyLike>(keys: readonly T[]): T | null {
  return keys.find((k) => k.disabled) ?? null;
}

/** 只显示掩码 `prefix…last4`（明文只在 keys 页一次性展示）。 */
export function maskKey(k: Pick<KeyLike, "prefix" | "last4">): string {
  return `${k.prefix}…${k.last4}`;
}
