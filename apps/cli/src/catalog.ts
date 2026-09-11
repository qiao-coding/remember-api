/**
 * 模型目录 —— 直接读 `@opencode-ai/models/snapshot`（models.dev 官方快照，完全离线）。
 *
 * 不自己维护厂商/模型清单：快照 213 家 / 7500+ 模型，随依赖版本更新，运行时零网络。
 * 网关侧本来就在用它算成本（apps/api/src/lib/cost.ts），这里只是把同一份数据用给用户看。
 */
import { providers } from "@opencode-ai/models/snapshot";
import { resolveBaseUrl } from "@remember/providers";

/** 快照里的 provider 块（只写我们真正会读的字段） */
interface RawProvider {
  id?: string;
  name?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, RawModel>;
}

interface RawModel {
  id?: string;
  name?: string;
  status?: string;
  tool_call?: boolean;
  limit?: { context?: number };
  cost?: { input?: number; output?: number };
}

export interface CatalogModel {
  id: string;
  name: string;
  /** 上下文窗口（token）；快照缺失时为 null */
  contextLimit: number | null;
  /** USD / 1M tokens；null = 快照未标价（多为订阅制） */
  cost: { input: number; output: number } | null;
  /** 打标用：alpha/beta 提示、deprecated 已由 listModels 过滤掉 */
  status: string | null;
  toolCall: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  /** 目录给的默认端点；null = 快照没有 api 字段，必须让用户手填 */
  api: string | null;
  /** 厂商规范的环境变量名（「去哪个控制台拿 Key」的提示文案用） */
  envVar: string | null;
  /**
   * 网关能不能直接对话：
   * - `compatible`：走现有 OpenAI 兼容桥（快照标了 openai-compatible，或有内置默认端点）
   * - `needs-base-url`：其余。端点未知或协议不明，必须用户显式确认 baseUrl
   */
  tier: "compatible" | "needs-base-url";
}

/**
 * 内置默认端点表只存在于 `packages/providers/src/sdk.ts`。这里用「问它一次」来判定，
 * 而不是复制一份 id 列表 —— 复制迟早漂移。
 */
function hasBuiltinEndpoint(id: string): boolean {
  try {
    resolveBaseUrl(id, undefined);
    return true;
  } catch {
    return false;
  }
}

function toModel(id: string, raw: RawModel): CatalogModel {
  const cost =
    typeof raw.cost?.input === "number" || typeof raw.cost?.output === "number"
      ? { input: raw.cost?.input ?? 0, output: raw.cost?.output ?? 0 }
      : null;
  return {
    id,
    name: raw.name ?? id,
    contextLimit: raw.limit?.context ?? null,
    cost,
    status: raw.status ?? null,
    toolCall: raw.tool_call === true,
  };
}

function toProvider(id: string, raw: RawProvider): CatalogProvider {
  const api = typeof raw.api === "string" && raw.api.trim() ? raw.api.trim() : null;
  const compatible =
    (raw.npm === "@ai-sdk/openai-compatible" && Boolean(api)) || hasBuiltinEndpoint(id);
  return {
    id,
    name: raw.name ?? id,
    api,
    envVar: raw.env?.[0] ?? null,
    tier: compatible ? "compatible" : "needs-base-url",
  };
}

/** 目录里所有「有模型可选」的 provider，按名字排序 */
export function listProviders(): CatalogProvider[] {
  const entries = Object.entries(providers as Record<string, RawProvider>);
  return entries
    .filter(([, raw]) => Object.keys(raw.models ?? {}).length > 0)
    .map(([id, raw]) => toProvider(raw.id ?? id, raw))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getProvider(id: string): CatalogProvider | null {
  const raw = (providers as Record<string, RawProvider>)[id];
  if (!raw) return null;
  return toProvider(raw.id ?? id, raw);
}

/** 某 provider 的可用模型（排除 deprecated；alpha/beta 保留但由调用方打标） */
export function listModels(providerId: string): CatalogModel[] {
  const models = (providers as Record<string, RawProvider>)[providerId]?.models ?? {};
  return Object.entries(models)
    .filter(([, raw]) => raw.status !== "deprecated")
    .map(([id, raw]) => toModel(raw.id ?? id, raw))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 上下文长度的可读展示（128000 → 128K；1048576 → 1M 而不是 1.0M） */
export function formatContext(tokens: number | null): string {
  if (!tokens) return "—";
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${millions}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

/** 价格的可读展示（USD / 1M tokens，如 `$0.27/$1.10`） */
export function formatCost(cost: CatalogModel["cost"]): string {
  if (!cost) return "订阅/未标价";
  const fmt = (n: number) => (n === 0 ? "0" : n < 0.01 ? n.toFixed(3) : n.toFixed(2));
  return `$${fmt(cost.input)}/$${fmt(cost.output)}`;
}
