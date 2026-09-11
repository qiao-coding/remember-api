/**
 * `up` / `model` / `key` / `connect` / `status` / `doctor`。
 *
 * 共同约束：`@remember/api/*` 全部动态 import —— env.ts 在模块加载时 parse
 * `process.env`，静态 import 会让 `--help` 也崩；动态 import 之前必须先 `applyEnv()`。
 */
import { createServer } from "node:net";
import { log, note, spinner } from "@clack/prompts";
import { generateApiKey } from "@remember/shared";
import { type CatalogProvider, getProvider } from "./catalog.js";
import { printConnect, trioOf } from "./connect.js";
import { type CliConfig, configPath, readConfig, writeConfig } from "./config.js";
import { containerState, dockerVersion, probe } from "./db.js";
import { NeedsInteractiveError, isInteractive } from "./prompt.js";
import { chooseKey, chooseTarget } from "./selection.js";
import { applyEnv, reportSmoke, runSmoke } from "./smoke.js";

export async function requireConfig(): Promise<CliConfig | null> {
  const config = await readConfig();
  if (!config) {
    log.error("还没有配置。先运行：remember-api init");
    process.exitCode = 1;
    return null;
  }
  return config;
}

/** 目录里查不到的 provider（用户手填过）也要有个壳，Key 追问文案靠它 */
function providerFor(id: string, baseUrl: string | null): CatalogProvider {
  return (
    getProvider(id) ?? { id, name: id, api: baseUrl, envVar: null, tier: "needs-base-url" }
  );
}

/** 端口是否已被占用（占用通常是「已经有一个实例在跑」） */
export function portInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, host);
  });
}

export async function runUp(
  config: CliConfig,
  opts: { port?: number; host?: string } = {},
): Promise<void> {
  const port = opts.port ?? config.server.port;
  const host = opts.host ?? config.server.host;

  const db = await probe(config.database.url);
  if (!db.ok) {
    log.error(`数据库连不上：${db.error}`);
    log.info("检查容器是否在跑，或重跑 remember-api init");
    process.exitCode = 1;
    return;
  }
  if (await portInUse(host, port)) {
    log.error(`端口 ${port} 已被占用 —— 多半已经有一个 remember-api 在跑（remember-api status）`);
    process.exitCode = 1;
    return;
  }

  applyEnv(config, { PORT: String(port), HOST: host });
  const { startServer } = await import("@remember/api/server");
  const { url } = await startServer();

  const trio = trioOf({ ...config, server: { host, port } }, port);
  note(
    [
      `Base URL  ${trio.baseUrl}`,
      `API Key   ${trio.apiKey ?? "（未生成）"}`,
      `Model     ${trio.model}`,
    ].join("\n"),
    "接进客户端（OpenAI 兼容）",
  );
  log.info(`网关已就绪：${url}（Ctrl-C 停止）`);
}

/** `model` 无参 / `model list`：已配 Key 的厂商 + 当前指向 */
export async function runModelList(config: CliConfig): Promise<void> {
  const { listProviderConfigs, listProfiles } = await import("@remember/db");
  applyEnv(config);

  const rows = await listProviderConfigs(config.user.id);
  if (rows.length === 0) {
    log.warn("还没有任何 provider 凭据。运行 remember-api init 或 remember-api model add");
  } else {
    const active = config.selection;
    note(
      rows
        .map((r) => {
          const mark = active && r.provider === active.provider ? "●" : " ";
          const key = r.apiKeyEncrypted ? "已录入 Key" : "⚠ 无 Key";
          return `${mark} ${r.provider}  ${r.defaultModel ?? "—"}  ${key}  ${r.baseUrl ?? "（默认端点）"}`;
        })
        .join("\n"),
      "已配置的厂商（● = 当前）",
    );
  }

  const profileRows = await listProfiles(config.user.id);
  if (profileRows.length) {
    note(
      profileRows.map((p) => `${p.name} → ${p.provider}/${p.model}`).join("\n"),
      "Profile",
    );
  }
}

/**
 * `model use [<provider>/<model>]` —— 切模型。
 *
 * 给参数 = 无交互（脚本/脚本化配置用）；不给 = 交互选择（可顺手补一把新厂商的 Key）。
 * 两种路径的落点相同：provider_configs 的 baseUrl/defaultModel + Profile 的 provider/model。
 */
export async function runModelUse(config: CliConfig, arg?: string): Promise<void> {
  const { findProviderConfig, upsertProviderConfig } = await import("@remember/db");
  applyEnv(config);

  let target: { provider: string; model: string; baseUrl: string | null };
  let newKey: string | null = null;

  if (arg) {
    const [provider, ...rest] = arg.split("/");
    const model = rest.join("/");
    if (!provider || !model) {
      log.error("用法：remember-api model use <provider>/<model>（例：deepseek/deepseek-v4-flash）");
      process.exitCode = 1;
      return;
    }
    const row = await findProviderConfig(config.user.id, provider);
    if (!row?.apiKeyEncrypted) {
      log.error(`「${provider}」还没有 Key。先运行：remember-api model add`);
      process.exitCode = 1;
      return;
    }
    const baseUrl = row.baseUrl ?? getProvider(provider)?.api ?? null;
    if (!baseUrl) {
      log.error(
        `「${provider}」没有已知端点（目录里也没有）。请用 remember-api model add 选它并填端点。`,
      );
      process.exitCode = 1;
      return;
    }
    target = { provider, model, baseUrl };
  } else {
    if (!isInteractive()) {
      throw new NeedsInteractiveError(
        "remember-api model use（不带参数）",
        "remember-api model use <provider>/<model>，例：remember-api model use deepseek/deepseek-v4-flash",
      );
    }
    target = await chooseTarget(undefined, config.selection ?? undefined);
    const existing = await findProviderConfig(config.user.id, target.provider);
    newKey = await chooseKey(
      providerFor(target.provider, target.baseUrl),
      Boolean(existing?.apiKeyEncrypted),
    );
  }

  await upsertProviderConfig({
    userId: config.user.id,
    provider: target.provider,
    encryptionKey: config.secrets.encryptionKey,
    baseUrl: target.baseUrl,
    defaultModel: target.model,
    ...(newKey ? { apiKey: newKey } : {}),
  });

  const { setProfilesTarget, listProfiles } = await import("@remember/db");
  const changed = await setProfilesTarget(config.user.id, target);
  config.selection = target;
  await writeConfig(config);

  log.success(`已切到 ${target.provider}/${target.model}（Profile 更新 ${changed} 个）`);
  const rows = await listProfiles(config.user.id);
  if (rows.length) {
    note(
      rows.map((p) => `${p.name} → ${p.provider}/${p.model}`).join("\n"),
      "现在的 Profile",
    );
  }
  log.info("下一轮请求即刻生效，不用重启网关");
}

/** `model add` —— 只录凭据，不切换（切用 model use） */
export async function runModelAdd(config: CliConfig): Promise<void> {
  const { findProviderConfig, upsertProviderConfig } = await import("@remember/db");
  if (!isInteractive()) {
    throw new NeedsInteractiveError(
      "remember-api model add",
      "remember-api model use <provider>/<model>（该厂商的 Key 用 --key 交给 init）；" +
        "或先 remember-api init --yes --provider … --model … --key …",
    );
  }
  applyEnv(config);

  const target = await chooseTarget();
  const existing = await findProviderConfig(config.user.id, target.provider);
  const key = await chooseKey(
    providerFor(target.provider, target.baseUrl),
    Boolean(existing?.apiKeyEncrypted),
  );

  await upsertProviderConfig({
    userId: config.user.id,
    provider: target.provider,
    encryptionKey: config.secrets.encryptionKey,
    baseUrl: target.baseUrl,
    defaultModel: target.model,
    ...(key ? { apiKey: key } : {}),
  });
  log.success(`已保存 ${target.provider} 的凭据`);
  log.info(`切过去：remember-api model use ${target.provider}/${target.model}`);
}

/** `key list` / `key new [名字]` */
export async function runKey(config: CliConfig, args: string[]): Promise<void> {
  const { listApiKeys, createApiKey, listProfiles } = await import("@remember/db");
  applyEnv(config);
  const sub = args[0] ?? "list";

  if (sub === "list") {
    const rows = await listApiKeys(config.user.id);
    if (rows.length === 0) {
      log.warn("还没有 API Key。运行 remember-api key new");
      return;
    }
    note(
      rows
        .map(
          (r) =>
            `${r.disabled ? "✗" : "●"} ${r.name}  ${r.prefix}…${r.last4}  建于 ${r.createdAt
              .toISOString()
              .slice(0, 10)}`,
        )
        .join("\n"),
      "API Key",
    );
    return;
  }

  if (sub !== "new") {
    log.error(`未知子命令：key ${sub}（可用：list | new [名字]）`);
    process.exitCode = 1;
    return;
  }

  const profiles = await listProfiles(config.user.id);
  const profile = profiles[0];
  if (!profile) {
    log.error("库里没有 Profile，而 Key 必须绑定一个 Profile。先重跑 remember-api init");
    process.exitCode = 1;
    return;
  }

  const name = args[1] ?? "cli";
  const plaintext = generateApiKey();
  await createApiKey({
    userId: config.user.id,
    profileId: profile.id,
    name,
    plaintext,
    pepper: config.secrets.apiKeyPepper,
  });

  // 存下来是为了 connect / up 打出的三件套始终是「手上的这一把」
  config.apiKey = { value: plaintext, profileName: profile.name };
  await writeConfig(config);

  note(
    [plaintext, "", `只显示这一次。已绑定 model：${profile.name}`].join("\n"),
    `新 Key「${name}」`,
  );
}

export async function runConnect(config: CliConfig): Promise<void> {
  printConnect(config);
}

export async function runStatus(config: CliConfig): Promise<void> {
  const { listProviderConfigs, listProfiles, getDb } = await import("@remember/db");
  applyEnv(config);

  const lines: string[] = [
    `配置文件   ${configPath()}`,
    `Node       ${process.versions.node}`,
  ];

  const db = await probe(config.database.url);
  lines.push(`数据库     ${db.ok ? "可达" : `不可达 —— ${db.error}`}`);

  if (db.ok) {
    const result = await getDb().execute(
      "SELECT to_regclass('public.profiles') IS NOT NULL AS migrated",
    );
    const migrated = Boolean((result as unknown as { migrated?: boolean }[])[0]?.migrated);
    lines.push(`已迁移     ${migrated ? "是" : "否（运行 remember-api init）"}`);

    if (migrated) {
      const rows = await listProviderConfigs(config.user.id);
      const withKey = rows.filter((r) => r.apiKeyEncrypted);
      lines.push(
        `已配厂商   ${withKey.length ? withKey.map((r) => r.provider).join("、") : "无"}`,
      );
      const profiles = await listProfiles(config.user.id);
      lines.push(
        `Profile    ${
          profiles.length
            ? profiles.map((p) => `${p.name}→${p.provider}/${p.model}`).join("、")
            : "无"
        }`,
      );
    }
  }

  if (config.database.docker) {
    const docker = await dockerVersion();
    const state = docker
      ? ((await containerState(config.database.docker.container)) ?? "不存在")
      : "docker 不可用";
    lines.push(`容器       ${config.database.docker.container}: ${state}`);
  }

  const busy = await portInUse(config.server.host, config.server.port);
  lines.push(
    `端口 ${config.server.port}  ${busy ? "已被占用（多半是 remember-api 正在跑）" : "空闲"}`,
  );
  lines.push(
    `当前模型   ${
      config.selection
        ? `${config.selection.provider}/${config.selection.model}`
        : "未选择（运行 remember-api init）"
    }`,
  );

  note(lines.join("\n"), "remember-api 状态");
}

/** `doctor` —— 起一次临时网关，验证 Key 与 Profile 真能对上 */
export async function runDoctor(config: CliConfig): Promise<void> {
  const spin = spinner();
  spin.start("自检中…");
  try {
    const checks = await runSmoke(config);
    const green = reportSmoke(checks, (line) => log.message(line));
    if (green) spin.stop("自检通过");
    else spin.error("自检未全绿（见上）");
  } catch (err) {
    spin.error(`自检失败：${(err as Error).message}`);
  }
}
