/**
 * 自检 —— 真起一次网关、真发一次请求，证明「库 / 密钥 / Profile / API Key」这条链是通的。
 *
 * 为什么值得起整个进程：`init` 里每一步都成功、但 pepper 与 seed 用的不是同一个、
 * ENCRYPTION_KEY 写错了、Profile 没建出来 —— 这些都不会在写库时报错，只会让用户
 * 回到家在客户端里看到一个 401。自检把它们挡在向导里。
 *
 * ⚠️ 顺序约束：`@remember/api/*` 一律**动态 import**。env.ts 在模块加载时就
 * `EnvSchema.parse(process.env)`，静态 import 会让 CLI 在还没有配置时就因为缺
 * DATABASE_URL 而崩（`npx remember-api --help` 都会挂）。动态 import 必须发生在
 * `applyEnv()` 之后。
 */
import type { CliConfig } from "./config.js";
import { configToEnv } from "./config.js";

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** 把配置写进 process.env；必须在动态 import 网关模块之前调用 */
export function applyEnv(config: CliConfig, overrides: Record<string, string> = {}): void {
  Object.assign(process.env, configToEnv(config), overrides);
}

/**
 * 起一个临时网关（端口 0 = 系统分配，不会跟已在跑的实例抢 4000），
 * 打两枪后关掉。
 */
export async function runSmoke(config: CliConfig): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const apiKey = config.apiKey?.value;

  // error 而不是 warn：网关启动时那句「SUPABASE_URL 未配置」的 warn 是 pino 的 JSON 单行，
  // 会插进 clack 的 spinner 里，把自检输出搅成一团。自检的结论由 reportSmoke 负责。
  applyEnv(config, { LOG_LEVEL: "error" });
  const { buildApp } = await import("@remember/api/app");

  const app = buildApp();
  let url = "";
  try {
    url = await app.listen({ port: 0, host: config.server.host });
  } catch (err) {
    return [{ name: "网关启动", ok: false, detail: (err as Error).message }];
  }

  try {
    const health = await fetch(`${url}/health`);
    checks.push({
      name: "网关可启动",
      ok: health.ok,
      detail: health.ok ? url.replace(/:\d+$/, ":<随机端口>") : `HTTP ${health.status}`,
    });

    if (!apiKey) {
      checks.push({ name: "API Key", ok: false, detail: "尚未生成（remember-api key new）" });
      return checks;
    }

    const models = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!models.ok) {
      checks.push({
        name: "API Key 可用",
        ok: false,
        detail: `HTTP ${models.status} —— Key 与库里的哈希对不上（pepper 变了？）`,
      });
      return checks;
    }

    const body = (await models.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean);
    checks.push({
      name: "API Key 可用",
      ok: ids.length > 0,
      detail: ids.length ? `绑定 model：${ids.join("、")}` : "Key 有效但没绑到任何 model",
    });
    return checks;
  } finally {
    await app.close();
  }
}

/** 打印自检结果；返回是否全绿 */
export function reportSmoke(checks: SmokeCheck[], log: (line: string) => void): boolean {
  for (const c of checks) {
    log(`${c.ok ? "✅" : "❌"} ${c.name} —— ${c.detail}`);
  }
  return checks.every((c) => c.ok);
}
