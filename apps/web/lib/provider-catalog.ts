/** 网关已知上游供应商 —— 数据/默认值单一来源。
 * 后端 zod 目前仅完整实现 deepseek；未来新增时在此追加一项，
 * providers 编辑默认值与 profiles 表单占位等会随之收敛。 */

export interface ProviderMeta {
  key: string;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
}

export const KNOWN_PROVIDERS: readonly ProviderMeta[] = [
  {
    key: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com",
  },
];

/** 默认（首个）供应商。单用户产品默认即唯一。 */
export const DEFAULT_PROVIDER = KNOWN_PROVIDERS[0]!;

export function providerMeta(
  key: string | null | undefined,
): ProviderMeta | undefined {
  if (!key) return undefined;
  return KNOWN_PROVIDERS.find((p) => p.key === key);
}
