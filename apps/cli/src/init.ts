/**
 * `remember-api init` —— 一键向导：建库 → 迁移 → 选厂商/模型录 Key → 种子 → 自检。
 *
 * 幂等：容器/库/桩/迁移/种子都可重跑，重来不会丢已有的库，也不会重复插样例数据。
 * 每一步做完立刻写 config.json：中途 Ctrl-C 之后重跑能接着走，不用从头再填。
 *
 * 两种模式：交互（TTY，逐项问答）与无人值守（`--yes` + 参数给全，一个 prompt 都不发）。
 * 后者的存在理由不只是 CI：本仓的调用方多半是脚本与 agent，装网关这件事不该只能手敲。
 *
 * ⚠️ `@remember/api/*` 与本包依赖的 db 模块一律**动态 import**：`env.ts` 在模块加载时
 * parse `process.env`，静态 import 会让 `npx remember-api --help` 因为还没有 DATABASE_URL 就崩。
 */
import { confirm, intro, log, outro, select, spinner, text } from "@clack/prompts";
import { resolveBaseUrl } from "@remember/providers";
import { generateApiKey } from "@remember/shared";
import { getProvider } from "./catalog.js";
import {
  DEFAULT_DB_PLAN,
  dbNameOf,
  dockerCliInstalled,
  dockerVersion,
  ensureContainer,
  planToUrl,
  prepareDatabase,
  resolveMigrateUrl,
} from "./db.js";
import {
  DEFAULT_PROFILE_NAME,
  type CliConfig,
  configPath,
  emptyConfig,
  readConfig,
  writeConfig,
} from "./config.js";
import { NeedsInteractiveError, isInteractive, required, unwrap } from "./prompt.js";
import { checkSupabaseConnectionString, listSupabaseProjects } from "./supabase.js";
import { type ChosenTarget, type TargetHint, chooseKey, chooseTarget } from "./selection.js";
import { applyEnv, reportSmoke, runSmoke } from "./smoke.js";
import { printConnect } from "./connect.js";

const MIN_NODE_MAJOR = 22;

export interface InitOptions extends TargetHint {
  /** Postgres 连接串；给了就不再问数据库 */
  url?: string;
  /** 迁移/建表用的连接串；不给则按主机名推导（Supabase 池化串会自动换成 5432） */
  migrateUrl?: string;
  /** 用 docker 起库时的端口（不给则问，或无人值守时取默认 5432） */
  port?: number;
  host?: string;
  /** 明文 Key；不给则沿用库里已有的，再看该厂商约定的环境变量 */
  key?: string;
  /** 无人值守：不发任何 prompt（非 TTY 下必须给，且参数要给全） */
  yes?: boolean;
}

const UNATTENDED_HINT =
  "remember-api init --yes --url <Postgres 连接串> --provider <厂商> --model <模型> --key <API Key>";

export async function runInit(opts: InitOptions = {}): Promise<void> {
  const unattended = Boolean(opts.yes);
  if (!unattended && !isInteractive()) {
    throw new NeedsInteractiveError("remember-api init", UNATTENDED_HINT);
  }
  if (unattended) assertUnattendedReady(opts);

  intro("remember-api 本地部署向导");

  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    log.error(`需要 Node >= ${MIN_NODE_MAJOR}，当前是 ${process.versions.node}`);
    process.exitCode = 1;
    return;
  }

  const config = await initialConfig(unattended);

  await setupDatabase(config, opts);
  await writeConfig(config); // 建库成功先落盘：后面的选择是「可以重来的」，库不是

  const target = await chooseTarget(
    {
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    },
    config.selection ?? undefined,
  );

  // 顺序是承重的：`provider_configs.user_id` 有外键指向 `users`，用户必须先存在。
  // 先写凭据再 seed 用户，在全新的库上（也就是每一次真正的新装）必然外键失败。
  config.apiKey ??= { value: generateApiKey(), profileName: DEFAULT_PROFILE_NAME };
  await seedUser(config, target);
  await saveCredential(config, target, opts);
  await pointProfiles(config, target);

  config.selection = target;
  await writeConfig(config);

  await selfCheck(config, unattended);

  outro(`配置已写入 ${configPath()}`);
  printConnect(config);
  log.info("下一步：remember-api up");
}

/** 无人值守缺什么就报什么 —— 别走到一半才发现问不了人 */
function assertUnattendedReady(opts: InitOptions): void {
  const gaps: string[] = [];
  if (!opts.url && !opts.port) gaps.push("--url <Postgres 连接串>（或 --port 让 docker 起一个）");
  if (!opts.provider) gaps.push("--provider <厂商 id>，例：deepseek");
  if (!opts.model) gaps.push("--model <模型 id>，例：deepseek-v4-flash");
  if (gaps.length === 0) return;
  throw new Error(
    `--yes 无人值守模式还缺参数：\n  ${gaps.join("\n  ")}\n完整写法：${UNATTENDED_HINT}`,
  );
}

/** 已有配置 → 问一句保留什么。数据库与密钥是「贵」的那部分，默认保留。 */
async function initialConfig(unattended: boolean): Promise<CliConfig> {
  const existing = await readConfig();
  if (!existing) return emptyConfig();
  if (unattended) return existing; // 无人值守不动既有库与密钥；要不要换连接串由 --url/--port 决定

  const choice = unwrap(
    await select({
      message: `已存在配置（${configPath()}）`,
      options: [
        {
          value: "reuse",
          label: "保留数据库与密钥，只重选厂商/模型",
          hint: existing.selection
            ? `现在是 ${existing.selection.provider}/${existing.selection.model}`
            : "还没选过厂商",
        },
        { value: "reset", label: "重新配置数据库与密钥", hint: "不会删除已有数据库" },
      ],
    }),
  );
  if (choice === "reuse") return existing;
  return { ...emptyConfig(), database: existing.database, server: existing.server };
}

async function setupDatabase(config: CliConfig, opts: InitOptions): Promise<void> {
  const docker = await dockerVersion();
  const hasUrl = Boolean(config.database.url);

  let mode: "docker" | "url";
  if (opts.url) {
    mode = "url";
  } else if (opts.port) {
    if (!docker) {
      throw new Error(
        `指定了 --port ${opts.port}，但没有可用的 docker daemon。` +
          `启动 Docker Desktop，或改用 --url <已有 Postgres 的连接串>。`,
      );
    }
    mode = "docker";
  } else if (hasUrl) {
    mode = unwrap(
      await select({
        message: "数据库",
        options: [
          { value: "url", label: "沿用当前连接串", hint: config.database.url },
          ...(docker ? [{ value: "docker" as const, label: "改用 Docker 新建一个" }] : []),
        ],
      }),
    ) as "docker" | "url";
  } else if (docker) {
    mode = unwrap(
      await select({
        message: `数据库（检测到 ${docker}）`,
        options: [
          { value: "docker", label: `Docker 起一个 ${DEFAULT_DB_PLAN.image}（推荐）` },
          { value: "url", label: "我有现成的连接串", hint: "本机或远程 Postgres 都行" },
        ],
      }),
    ) as "docker" | "url";
    log.info("容器已存在会直接复用，不会重建");
  } else {
    if (await dockerCliInstalled()) {
      log.warn("装了 docker 但 daemon 没起来（Docker Desktop 没启动？）：改用手填连接串");
    } else {
      log.warn("没找到 docker：改用手填连接串");
    }
    mode = "url";
  }

  if (mode === "url") {
    // 云端分两条：Supabase 项目 / 自己贴串。`--url` 给了就都不问。
    const url = opts.url?.trim() ?? (await askCloudUrl());
    const migrateUrl = await pickMigrateUrl(url, opts);
    config.database = { url, migrateUrl, docker: null };
  } else {
    // 容器名固定默认值，避免多问一句；同名容器存在时直接复用（见 ensureContainer）
    const plan = { ...DEFAULT_DB_PLAN };
    plan.port = opts.port ?? (await askDockerPort());
    config.database = {
      url: planToUrl(plan),
      migrateUrl: null,
      docker: {
        container: plan.container,
        image: plan.image,
        port: plan.port,
        managed: true,
      },
    };
  }

  const url = config.database.url;
  const spin = spinner();
  spin.start("准备数据库…");
  try {
    if (mode === "docker" && config.database.docker) {
      await ensureContainer(
        { ...DEFAULT_DB_PLAN, port: config.database.docker.port },
        (msg) => spin.message(msg),
      );
    }
    await prepareDatabase(url, (msg) => spin.message(msg), {
      ...(config.database.migrateUrl ? { migrateUrl: config.database.migrateUrl } : {}),
    });
    spin.stop(`数据库就绪（${dbNameOf(url)}）`);
  } catch (err) {
    spin.error("数据库准备失败");
    throw err;
  }
}

/**
 * 迁移串：`--migrate-url` 优先；否则按主机名推导（Supabase 池化串 → 同 host 的 5432）。
 *
 * 推导不出的（自建 pgbouncer、Neon 之类我们认不出的池化地址）在交互模式下问一句 ——
 * 这是唯一一处「用户知道而我们推不出」的输入。无人值守不问：一条串对绝大多数后端够用。
 *
 * ⚠️ 这里**不能**默认 null 了事：Supabase 上 `--url` 给的通常是事务池串，而迁移是 DDL，
 * 在事务池上必然失败。老代码写死 `migrateUrl: null`，于是 `migrate.ts` 回退到
 * `DATABASE_URL`（正是那条事务池串）—— 文档专门警告过「两条串不能混用」，CLI 自己却违反了。
 */
async function pickMigrateUrl(url: string, opts: InitOptions): Promise<string | null> {
  const explicit = opts.migrateUrl?.trim();
  if (explicit) return explicit;

  const derived = resolveMigrateUrl(url); // 直连域名在这里带替代写法抛错
  if (derived) return derived;
  if (opts.yes || !isInteractive()) return null;

  const answer = unwrap(
    await text({
      message: "有没有单独的迁移连接串？（留空 = 与上面同一条）",
      placeholder: "postgres://user:password@host:5432/db",
      defaultValue: "",
    }),
  ).trim();
  return answer || null;
}

async function askConnectionString(): Promise<string> {
  return unwrap(
    await text({
      message: "Postgres 连接串",
      placeholder: "postgres://postgres:postgres@127.0.0.1:5432/remember_api",
      validate: (value) => {
        const bad = required("连接串")(value);
        if (bad) return bad;
        try {
          const parsed = new URL((value ?? "").trim());
          if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "必须是 postgres:// 开头";
          return undefined;
        } catch {
          return "不是合法的连接串";
        }
      },
    }),
  ).trim();
}

/**
 * 「连接串从哪来？」——云端两条路。
 *
 * 无人值守不走这里（`--url` 已经给了），所以下面全是真人向导的交互。
 */
async function askCloudUrl(): Promise<string> {
  const source = unwrap(
    await select({
      message: "连接串从哪来？",
      options: [
        {
          value: "supabase",
          label: "Supabase 项目",
          hint: "用 supabase CLI 挑项目，再贴一条池化串（没登录会让你先登录）",
        },
        { value: "custom", label: "自己贴连接串", hint: "自建 / 其他云厂商 / 本机都行" },
      ],
    }),
  ) as string;

  return source === "supabase" ? askSupabaseUrl() : askConnectionString();
}

/**
 * Supabase 路：CLI 认项目 → 用户贴一次池化串 → 按 ref/区域校验。
 *
 * CLI 用不上（没装 / 没登录 / 网络不通）就**退回手填**，不把人卡在这一步。
 * 另外 CLI 给不出池化串——里面差一个只有 Dashboard 有的数据库密码，
 * 而池化主机名的集群前缀（aws-0 / aws-1）推不出来，所以那一段必须用户贴。
 */
async function askSupabaseUrl(): Promise<string> {
  const list = await listSupabaseProjects();
  if (!list.ok) {
    log.warn(list.reason);
    log.info("也没关系：去 Dashboard → Connect 复制池化串，直接贴进来");
    return askConnectionString();
  }
  if (!list.projects.length) {
    log.warn("这个账号名下还没有 Supabase 项目");
    return askConnectionString();
  }

  const ref = unwrap(
    await select({
      message: "选一个项目",
      options: list.projects.map((p) => ({
        value: p.ref,
        label: p.name,
        hint: `${p.ref}${p.region ? ` · ${p.region}` : ""}`,
      })),
    }),
  ) as string;
  const chosen = list.projects.find((p) => p.ref === ref);
  if (!chosen) return askConnectionString();

  const url = unwrap(
    await text({
      message: `贴 ${chosen.name} 的池化连接串（Dashboard → Connect → Transaction pooler）`,
      placeholder: `postgres://postgres.${chosen.ref}:<password>@aws-0-${
        chosen.region || "<region>"
      }.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`,
      validate: (value) => {
        const problems = checkSupabaseConnectionString(value ?? "", chosen);
        return problems.length ? problems.join("；") : undefined;
      },
    }),
  ).trim();

  log.info(`配套的 SUPABASE_URL=https://${chosen.ref}.supabase.co（写进 apps/api/.env 才会挂 /api）`);
  return url;
}

async function askDockerPort(): Promise<number> {
  const raw = unwrap(
    await text({
      message: "Postgres 端口",
      defaultValue: String(DEFAULT_DB_PLAN.port),
      placeholder: String(DEFAULT_DB_PLAN.port),
      validate: (value) => {
        const n = Number(value?.trim() || DEFAULT_DB_PLAN.port);
        return Number.isInteger(n) && n > 0 && n < 65536 ? undefined : "端口要在 1-65535 之间";
      },
    }),
  ).trim();
  return Number(raw || DEFAULT_DB_PLAN.port);
}

/** 写 provider_configs（Key 加密存这里，网关按 (user, provider) 读） */
async function saveCredential(
  config: CliConfig,
  target: ChosenTarget,
  opts: InitOptions,
): Promise<void> {
  const { findProviderConfig, upsertProviderConfig } = await import("@remember/db");
  applyEnv(config);
  const provider = getProvider(target.provider);
  if (!provider) throw new Error(`模型目录里没有 provider「${target.provider}」`);
  const existing = await findProviderConfig(config.user.id, target.provider);
  const apiKey = await chooseKey(provider, Boolean(existing?.apiKeyEncrypted), {
    ...(opts.key ? { provided: opts.key } : {}),
    unattended: Boolean(opts.yes),
  });

  await upsertProviderConfig({
    userId: config.user.id,
    provider: target.provider,
    encryptionKey: config.secrets.encryptionKey,
    baseUrl: target.baseUrl,
    defaultModel: target.model,
    ...(apiKey ? { apiKey } : {}),
  });

  if (!apiKey && !existing?.apiKeyEncrypted) {
    throw new Error(
      `「${target.provider}」没有可用的 API Key —— 上游会退回 MockProvider（假回复）。` +
        `补一把：--key <API Key>` + (provider.envVar ? `，或设环境变量 ${provider.envVar}` : ""),
    );
  }
  // 端点能不能用先在这里判一次：目录没给端点、用户又填了空，就在这里拦住
  resolveBaseUrl(target.provider, target.baseUrl ?? undefined);
  log.success(`凭据已保存（${target.provider}）`);
}

/** 建用户 + 样例数据 + 引导 Key（必须早于写 provider_configs，见 runInit 里的顺序注释） */
async function seedUser(config: CliConfig, target: ChosenTarget): Promise<void> {
  const { seedUser: seed } = await import("@remember/db");
  applyEnv(config);

  const bootstrap = config.apiKey?.value ?? "";
  const spin = spinner();
  spin.start("写入本地样例数据…");
  try {
    if (bootstrap) {
      await seed({
        userId: config.user.id,
        email: config.user.email,
        name: config.user.name,
        provider: target.provider,
        model: target.model,
        pepper: config.secrets.apiKeyPepper,
        bootstrapApiKey: bootstrap,
      });
    }
    spin.stop("样例数据已就绪");
  } catch (err) {
    spin.error("样例数据写入失败");
    throw err;
  }
}

/** 把 Profile 指到选中的 provider/model（种子在已有样例数据时会跳过 Profile，这里补上） */
async function pointProfiles(config: CliConfig, target: ChosenTarget): Promise<void> {
  const { setProfilesTarget } = await import("@remember/db");
  applyEnv(config);

  const changed = await setProfilesTarget(config.user.id, target);
  if (changed === 0) {
    // 极端情况：库里有 Key 行却没有 Profile（被手工删过）——留个明话，别让 /v1/models 空着
    log.warn("库里没有该用户的 Profile，/v1/models 会是空的。请重跑 init 或重建数据库。");
    return;
  }
  if (changed > 1) {
    log.warn(`已把 ${changed} 个 Profile 都指向 ${target.provider}/${target.model}`);
  }
  log.success(`Profile 已指向 ${target.provider}/${target.model}`);
}

async function selfCheck(config: CliConfig, unattended: boolean): Promise<void> {
  if (!unattended) {
    const run = unwrap(
      await confirm({
        message: "现在做一次自检（起个临时网关，验证 Key 与 Profile 能对上）？",
        initialValue: true,
      }),
    );
    if (!run) return;
  }

  const spin = spinner();
  spin.start("自检中…");
  try {
    const checks = await runSmoke(config);
    const green = reportSmoke(checks, (line) => log.message(line));
    if (green) spin.stop("自检通过");
    else {
      spin.error("自检未全绿（见上）");
      process.exitCode = 1; // 无人值守要靠退出码说话
    }
  } catch (err) {
    spin.error(`自检失败：${(err as Error).message}`);
    process.exitCode = 1;
  }
}

