/**
 * 厂商 / 模型 / Key 的交互选择 —— `init` 与 `model add` / `model use` 共用。
 *
 * 数据全部来自 models.dev 快照（离线），不联网、不维护自己的清单。
 */
import { autocomplete, confirm, log, password, text } from "@clack/prompts";
import {
  type CatalogModel,
  type CatalogProvider,
  formatContext,
  formatCost,
  getProvider,
  listModels,
  listProviders,
} from "./catalog.js";
import { required, unwrap, validateUrl } from "./prompt.js";

export interface ChosenTarget {
  provider: string;
  model: string;
  /** 出站端点：目录给的 api；目录没有就来自用户手填 */
  baseUrl: string | null;
}

export interface TargetHint {
  provider?: string;
  model?: string;
  /** 目录里没有 api 的厂商（openai / anthropic …）由调用方显式给出 */
  baseUrl?: string;
}

function modelHint(m: CatalogModel): string {
  const parts = [formatContext(m.contextLimit), formatCost(m.cost)];
  if (m.toolCall) parts.push("tools");
  if (m.status) parts.push(m.status);
  return parts.join(" · ");
}

/**
 * 非交互定目标：provider/model 都给全了就直接用，一个 prompt 都不发。
 *
 * 目录里查不到也放行（快照落地总会比厂商发布慢一拍），但端点必须有 ——
 * 猜端点等于把请求发到不知道哪台机器上。
 */
export function resolveTarget(providerId: string, modelId: string, baseUrl?: string): ChosenTarget {
  const provider = getProvider(providerId);
  const url = baseUrl?.trim() || provider?.api || null;
  if (!url) {
    throw new Error(
      `「${providerId}」在模型目录里没有端点，请显式给一个：--base-url https://…/v1`,
    );
  }
  if (!provider) {
    log.warn(`模型目录里没有「${providerId}」，按你给的端点直连`);
  } else if (!listModels(providerId).some((m) => m.id === modelId)) {
    log.warn(`「${providerId}」的目录里没有模型「${modelId}」，仍然按你给的名字用`);
  }
  return { provider: providerId, model: modelId, baseUrl: url };
}

/**
 * 选厂商（一句话搜索 200+ 家），再选模型。
 *
 * `hint` 是**已经给定**的（provider + model 齐了就走非交互，一个 prompt 都不发）；
 * `prefill` 只是给选择器一个初始高亮，仍然要用户确认 —— 重跑向导时「沿用上次的选择」
 * 和「替用户把上次的选择定下来」是两件事。
 */
export async function chooseTarget(
  hint?: TargetHint,
  prefill?: { provider?: string; model?: string },
): Promise<ChosenTarget> {
  if (hint?.provider && hint?.model) return resolveTarget(hint.provider, hint.model, hint.baseUrl);

  const providers = listProviders();
  if (providers.length === 0) throw new Error("模型目录为空（@opencode-ai/models 快照异常）");

  const providerId = unwrap(
    await autocomplete({
      message: "选上游厂商（输入关键字搜索）",
      placeholder: "deepseek / openai / moonshotai …",
      maxItems: 12,
      options: providers.map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.api ?? "目录未给端点，稍后手填",
      })),
      ...(prefill?.provider && providers.some((p) => p.id === prefill.provider)
        ? { initialValue: prefill.provider }
        : {}),
    }),
  );

  const provider = getProvider(providerId);
  if (!provider) throw new Error(`目录里没有 provider「${providerId}」`);

  const models = listModels(providerId);
  if (models.length === 0) throw new Error(`provider「${providerId}」在目录里没有可用模型`);

  const modelId = unwrap(
    await autocomplete({
      message: `选「${provider.name}」的模型`,
      maxItems: 12,
      options: models.map((m) => ({ value: m.id, label: m.name, hint: modelHint(m) })),
      ...(prefill?.model && models.some((m) => m.id === prefill.model)
        ? { initialValue: prefill.model }
        : {}),
    }),
  );

  let baseUrl = provider.api;
  if (!baseUrl) {
    // 目录里 26 家（含 openai / anthropic）没有 api 字段。不猜 —— 猜错就是请求期 400。
    baseUrl = unwrap(
      await text({
        message: `${provider.name} 的 API 端点（目录里没有，需要你填）`,
        placeholder: "https://…/v1",
        validate: validateUrl,
      }),
    ).trim();
  }

  return { provider: providerId, model: modelId, baseUrl };
}

export interface KeyOptions {
  /** 直接给定的明文（`--key`） */
  provided?: string;
  /**
   * 无人值守：不发任何 prompt。
   * 取值顺序 = provided → 库里已有（保留）→ 该厂商约定的环境变量 → 交给调用方报错。
   */
  unattended?: boolean;
}

/**
 * 取一个明文 Key。
 * 返回 null = 保留库里已有的密文（「Key 填一次」那一步）。
 */
export async function chooseKey(
  provider: CatalogProvider,
  hasStored: boolean,
  opts: KeyOptions = {},
): Promise<string | null> {
  if (opts.provided?.trim()) return opts.provided.trim();

  if (opts.unattended) {
    if (hasStored) return null;
    const envVar = provider.envVar;
    const fromEnv = envVar ? process.env[envVar]?.trim() : undefined;
    if (fromEnv) {
      log.info(`用环境变量 ${envVar} 里的 Key（无人值守模式）`);
      return fromEnv;
    }
    return null; // 调用方根据 hasStored 给出「没有可用 Key」的报错
  }

  if (hasStored) {
    const keep = unwrap(
      await confirm({
        message: `「${provider.name}」已录入过 Key，保留现有的？`,
        initialValue: true,
      }),
    );
    if (keep) return null;
  }

  const envVar = provider.envVar;
  const fromEnv = envVar ? process.env[envVar]?.trim() : undefined;
  if (fromEnv) {
    const use = unwrap(
      await confirm({
        message: `检测到环境变量 ${envVar}，直接用它？`,
        initialValue: true,
      }),
    );
    if (use) return fromEnv;
  }

  const value = unwrap(
    await password({
      message: `${provider.name} 的 API Key${envVar ? `（控制台里的 ${envVar}）` : ""}`,
      validate: required("API Key"),
    }),
  );
  return value.trim();
}
