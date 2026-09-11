import { findProviderConfig, listProviderConfigs, readProviderKey } from "@remember/db";
import { createProvider, ProviderError, type ModelProvider } from "@remember/providers";
import type { ProviderId } from "@remember/shared";
import { env } from "../env.js";

/**
 * 上游 provider 唯一装配点 —— 凭据按 (userId, provider) 解析。
 *
 * 优先级（顺序即语义，改这里要同步改 docs/03-接口契约.md §6）：
 *   1) provider_configs(userId, provider) 有行且解得开 Key → 用那一行
 *   2) 否则回退 env.UPSTREAM_API_KEY / UPSTREAM_BASE_URL → 既有部署与测试行为不变
 *   3) 用户在别家配过 Key、唯独这家没有 → 抛 ProviderError（必错配置，不能伪装成能跑）
 *   4) 一把凭据都没有 → MockProvider（开发态约定：离线也能把链路跑通）
 *
 * baseUrl 与凭据来源**绑定**：Key 来自某行，baseUrl 就只能来自那一行或 provider 层默认端点，
 * 绝不能用 env.UPSTREAM_BASE_URL —— 那是「全局限定」，会把某个用户的 Key 发到别人的端点上。
 */
export type CredentialSource = "provider_config" | "env" | "none";

export interface ResolvedUpstream {
  provider: ModelProvider;
  source: CredentialSource;
}

/** 透传给 provider 层的注入点（与 createProvider 的 fetch 同义：测试/诊断用） */
export interface ResolveUpstreamOptions {
  fetch?: typeof fetch;
}

/** Mock 警告每 (user, provider) 只发一次，避免每轮刷屏 */
const warnedMock = new Set<string>();

export async function resolveUpstream(
  userId: string,
  provider: ProviderId,
  opts?: ResolveUpstreamOptions,
): Promise<ResolvedUpstream> {
  const withFetch = opts?.fetch ? { fetch: opts.fetch } : {};

  // 1) 用户自己录入的 Key（CLI 写入 provider_configs，AES-256-GCM 加密）
  const row = await findProviderConfig(userId, provider);
  let storedKey: string | null = null;
  if (row?.apiKeyEncrypted) {
    try {
      storedKey = readProviderKey(row, env.ENCRYPTION_KEY);
    } catch (err) {
      // ENCRYPTION_KEY 被换过 → 密文已废。**绝不回退 env**：那会让用户以为在用新 Key，
      // 实际发出去的是旧的，是最难排查的一类问题。让请求以 400 明确失败。
      throw new ProviderError((err as Error).message);
    }
  }
  if (storedKey) {
    return {
      source: "provider_config",
      provider: createProvider({
        provider,
        apiKey: storedKey,
        // baseUrl 只能来自这一行（或 provider 层默认端点），见下方注释
        ...(row?.baseUrl ? { baseUrl: row.baseUrl } : {}),
        ...withFetch,
      }),
    };
  }

  // 2) 网关级 env 兜底（向后兼容：既有部署没写 provider_configs 也照跑）
  if (env.UPSTREAM_API_KEY.trim()) {
    return {
      source: "env",
      provider: createProvider({
        provider,
        apiKey: env.UPSTREAM_API_KEY,
        baseUrl: env.UPSTREAM_BASE_URL,
        ...withFetch,
      }),
    };
  }

  // 3) 别处有 Key、偏偏这家没有 —— 用户多半是切换 provider 后忘了补 Key。
  //    这里静默回退 Mock 会得到一个「看起来成功」的假回复，比报错危险得多。
  const others = (await listProviderConfigs(userId)).filter(
    (r) => r.provider !== provider && r.apiKeyEncrypted,
  );
  if (others.length) {
    throw new ProviderError(
      `provider「${provider}」还没有配置 API Key（已配置的有 ${others
        .map((r) => `「${r.provider}」`)
        .join("、")}）。补一把 Key，或把这个 Profile 的 provider 改成已配置的那家。`,
    );
  }

  // 4) 全空 → MockProvider
  const warnKey = `${userId}:${provider}`;
  if (!warnedMock.has(warnKey)) {
    warnedMock.add(warnKey);
    console.warn(
      `[upstream] 「${provider}」没有任何凭据（provider_configs 与 UPSTREAM_API_KEY 均空），本轮走 MockProvider（本地假数据）。`,
    );
  }
  return { source: "none", provider: createProvider({ provider, ...withFetch }) };
}

/** 调用点便捷包装：只要 provider 本体 */
export async function upstreamProvider(
  userId: string,
  provider: ProviderId,
  opts?: ResolveUpstreamOptions,
): Promise<ModelProvider> {
  return (await resolveUpstream(userId, provider, opts)).provider;
}
