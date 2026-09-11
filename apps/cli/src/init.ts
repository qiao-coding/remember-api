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
import { confirm, intro, log, outro, password, select, spinner, text } from "@clack/prompts";
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
  generateSecret,
  readConfig,
  writeConfig,
} from "./config.js";
import { NeedsInteractiveError, isInteractive, required, unwrap } from "./prompt.js";
import {
  type SupaOrg,
  type SupaProject,
  checkSupabaseConnectionString,
  createProject,
  getServiceRoleKey,
  isPaused,
  listOrganizations,
  listSupabaseProjects,
  loginSupabase,
  projectUrl,
  waitForProject,
} from "./supabase.js";
import { derivePoolerConnection } from "./supabase-connect.js";
import { ensureAuthUser } from "./supabase-auth.js";
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

  // `--host` 以前解析了却没人读：`config.server.host` 一直是默认的 127.0.0.1，
  // 用户以为「我指定了对外地址」而实际没生效 —— 接上它，让 `up` 真的绑到那个地址。
  // （注意 `init --port` 是 docker 起库的端口，与这里不是一回事。）
  const host = opts.host?.trim();
  if (host) config.server = { ...config.server, host };

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

/**
 * 数据库这段的四种走向。
 *
 * 分开命名而不是复用同一个 `"url"`：「沿用当前连接串」与「手填一条新串」在提示语、
 * 是否追问上是两件事 —— 混用一个值正是这次要修的 bug（选了「沿用」却被重新问一遍）。
 */
type DbMode = "docker" | "reuse" | "cloud" | "manual";

const CLOUD_HINT = "弹终端登录 → 选/建项目 → 连接串自动推出来";

async function setupDatabase(config: CliConfig, opts: InitOptions): Promise<void> {
  const docker = await dockerVersion();
  const hasUrl = Boolean(config.database.url);

  let mode: DbMode;
  let cloud: CloudChoice | null = null;

  if (opts.url) {
    mode = "manual"; // 串已经给了，下面不再追问
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
          { value: "reuse", label: "沿用当前连接串", hint: config.database.url },
          ...(docker ? [{ value: "docker" as const, label: "改用 Docker 新建一个" }] : []),
          { value: "cloud", label: "接一个 Supabase 项目", hint: CLOUD_HINT },
          { value: "manual", label: "手填一条新连接串" },
        ],
      }),
    ) as DbMode;
  } else if (docker) {
    mode = unwrap(
      await select({
        message: `数据库（检测到 ${docker}）`,
        options: [
          { value: "docker", label: `Docker 起一个 ${DEFAULT_DB_PLAN.image}（推荐）` },
          { value: "cloud", label: "接一个 Supabase 项目", hint: CLOUD_HINT },
          { value: "manual", label: "我有现成的连接串", hint: "本机或远程 Postgres 都行" },
        ],
      }),
    ) as DbMode;
    if (mode === "docker") log.info("容器已存在会直接复用，不会重建");
  } else {
    if (await dockerCliInstalled()) {
      log.warn("装了 docker 但 daemon 没起来（Docker Desktop 没启动？）");
    } else {
      log.warn("没找到 docker");
    }
    // 以前这条路直接跳到手填，于是「接一个 Supabase 项目」在没装 docker 的机器上
    // **根本不可见** —— 而没装 docker 的人恰恰最需要它。
    mode = unwrap(
      await select({
        message: "数据库",
        options: [
          { value: "cloud", label: "接一个 Supabase 项目", hint: CLOUD_HINT },
          { value: "manual", label: "我有现成的连接串", hint: "本机或远程 Postgres 都行" },
        ],
      }),
    ) as DbMode;
  }

  if (mode === "docker") {
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
  } else if (mode === "reuse") {
    // hasUrl 保证这里非空。以前这一步是 `opts.url ?? askCloudUrl()` —— opts.url 在交互
    // 模式下永远是 undefined，于是「沿用」变成了「重新问一遍」并丢掉原串。
    const url = config.database.url;
    config.database = { url, migrateUrl: await pickMigrateUrl(url, opts), docker: null };
  } else if (mode === "cloud") {
    cloud = await chooseCloudDatabase();
    if (cloud) {
      config.database = { url: cloud.url, migrateUrl: cloud.migrateUrl, docker: null };
    } else {
      const url = await askConnectionString(); // CLI 那条路走不通 → 退回手填，不卡人
      config.database = { url, migrateUrl: await pickMigrateUrl(url, opts), docker: null };
    }
  } else {
    const url = opts.url?.trim() ?? (await askConnectionString());
    config.database = { url, migrateUrl: await pickMigrateUrl(url, opts), docker: null };
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

  // 建 auth 用户必须在库就绪之后：先确认库真的能用，再去动云端账号，
  // 不然会出现「Supabase 上多了一个用户，本地却什么都没装上」。
  if (cloud) await ensureCloudAuthUser(config, cloud);
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

// ─────────────────────── Supabase 云端那条路 ───────────────────────

interface CloudChoice {
  /** 运行时串（事务池 6543） */
  url: string;
  /** 迁移串（session 池 5432） */
  migrateUrl: string;
  ref: string;
  /** 要建的 auth 用户的邮箱 */
  email: string;
  /** 那个 auth 用户的密码 */
  userPassword: string;
}

/** 建项目时的区域短名单 —— 不甩 CLI 那 18 个枚举，只留常用的几个 */
const REGION_CHOICES = [
  { value: "ap-northeast-1", label: "东京 ap-northeast-1", hint: "亚太，国内延迟最低" },
  { value: "ap-southeast-1", label: "新加坡 ap-southeast-1" },
  { value: "us-east-1", label: "美东 us-east-1" },
  { value: "us-west-1", label: "美西 us-west-1" },
  { value: "eu-central-1", label: "法兰克福 eu-central-1" },
];

const DEFAULT_AUTH_EMAIL = "admin@remember.local";

/**
 * 云端这条路：弹终端登录 → 选/建项目 → 试出池化主机 → 一对连接串。
 *
 * 返回 null = 「这次用不上」（没登录、CLI 报错、试连全败、用户自己选了手填），
 * 由调用方退回手填。**全程不抛错**是刻意的：它是加分的辅助路，不该把人卡死在这儿。
 */
async function chooseCloudDatabase(): Promise<CloudChoice | null> {
  const login = await loginSupabase({ note: (m) => log.info(m) });
  if (!login.ok) {
    log.warn(login.reason);
    // 这句话得**单独给**：上面那句说的是「为什么 CLI 用不了」，这句说的是「那我现在怎么办」。
    // 要把「不需要 CLI、也不需要 Supabase 账号」点明 —— 否则用户会以为自己卡死了。
    log.info("不用 CLI 也能继续：下面选「手填连接串」，去 Dashboard → Connect 复制那条池化串贴上就行");
    return null;
  }

  const orgs = await listOrganizations();
  if (!orgs.ok) {
    log.warn(orgs.reason);
    log.info("不用 CLI 也能继续：下面选「手填连接串」，去 Dashboard → Connect 复制那条池化串贴上就行");
    return null;
  }
  const listed = await listSupabaseProjects();
  if (!listed.ok) log.warn(listed.reason); // 列不出来不影响新建
  const existing = listed.ok ? listed.projects : [];

  const how = unwrap(
    await select({
      message: "Supabase 项目",
      options: [
        ...(existing.length
          ? [{ value: "existing", label: "接入已有项目", hint: `${existing.length} 个` }]
          : []),
        ...(orgs.orgs.length
          ? [{ value: "new", label: "新建一个项目", hint: "会真的在 Supabase 上创建（可能计费）" }]
          : []),
        { value: "manual", label: "改用手填连接串" },
      ],
    }),
  ) as string;
  if (how === "manual") return null;

  // 两条路最后都落到同样的三个值上：ref + 区域 + 数据库密码
  let ref: string;
  let region: string;
  let dbPassword: string;
  let project: SupaProject;

  if (how === "existing") {
    const picked = await pickExistingProject(existing);
    if (!picked) return null;
    project = picked;
    ref = picked.ref;
    region = picked.region;
    // 暂停的项目池化主机连不上，而那个报错和「密码错」长得一样。清单里现成有 status，
    // 现在说一句，比让人试连全败之后去猜密码强。
    if (isPaused(picked.status)) {
      log.warn(
        `${picked.name}（${picked.ref}）现在是 ${picked.status} —— 被暂停的项目连不上。` +
          `先去 Dashboard 点 Restore/Resume，再回来继续。`,
      );
    }
    dbPassword = await askDbPassword(picked);
  } else {
    const made = await createNewProject(orgs.orgs);
    if (!made) return null;
    ref = made.ref;
    region = made.region;
    dbPassword = made.dbPassword;
    project = { ref, name: made.name, region, status: "" };
  }

  if (!region) {
    log.warn(`项目 ${ref} 没报出区域，推不出池化主机名 —— 改用手填`);
    return null;
  }

  const derived = await derivePoolerConnection({ ref, region, password: dbPassword });
  if (!derived.ok) {
    log.warn(
      isPaused(project.status)
        ? `两个候选池化主机都连不上，而 ${ref} 正被暂停（${project.status}）—— 多半就是这个原因：`
        : "两个候选池化主机都连不上（密码不对？或者项目还在 provisioning？）：",
    );
    for (const line of derived.tried) log.warn(`  ${line}`);
    const pasted = await askSupabasePaste(project);
    if (!pasted) return null;
    return {
      url: pasted,
      migrateUrl: resolveMigrateUrl(pasted) ?? pasted,
      ref,
      email: await askAuthEmail(),
      userPassword: generateSecret(),
    };
  }

  log.success(`池化主机试出来了：${derived.conn.host}`);
  return {
    url: derived.conn.url,
    migrateUrl: derived.conn.migrateUrl,
    ref,
    email: await askAuthEmail(),
    userPassword: generateSecret(),
  };
}

/**
 * 挑一个已有项目。区域也在这里拿到 —— 它就是池化主机名的一部分。
 *
 * 名字**不可靠**：真机上见到的账号三个项目全叫「xier123456's Project」，全靠 ref 区分。
 * 所以 hint 里 ref 必须在，暂停状态也得在 —— 那三个里两个是 INACTIVE，选错了会连不上，
 * 而报错与「密码错」长得一样。
 */
async function pickExistingProject(projects: SupaProject[]): Promise<SupaProject | null> {
  const ref = unwrap(
    await select({
      message: "选一个项目",
      options: projects.map((p) => ({
        value: p.ref,
        label: p.name,
        hint: [p.ref, p.region, isPaused(p.status) ? `${p.status}（连不上，需先恢复）` : ""]
          .filter(Boolean)
          .join(" · "),
      })),
    }),
  ) as string;
  return projects.find((p) => p.ref === ref) ?? null;
}

/**
 * 项目的数据库密码 —— 这条路**躲不掉**的那个输入。
 *
 * 它只存在 Supabase 侧：Dashboard 要它、`supabase link -p` 要它、直连当然也要。
 * 但比起让用户从控制台复制**一整条池化串**，敲一个密码已经省掉了最容易抄错的三段
 * （池化主机名、`postgres.<ref>` 用户名、端口）—— 那三段我们推。
 * 建新项目时连这一句都不用问：密码是我们生成的。
 */
async function askDbPassword(project: SupaProject): Promise<string> {
  return unwrap(
    await password({
      message: `${project.name} 的数据库密码（控制台 Project Settings → Database）`,
      validate: required("数据库密码"),
    }),
  ).trim();
}

/** 试连全败时的手贴兜底：至少按 ref / 区域 / 端口校验形状，不把串台与端口错放过去 */
async function askSupabasePaste(project: SupaProject): Promise<string | null> {
  const url = unwrap(
    await text({
      message: `贴 ${project.name} 的池化连接串（Dashboard → Connect → Transaction pooler）`,
      placeholder: `postgres://postgres.${project.ref}:<password>@aws-0-${
        project.region || "<region>"
      }.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`,
      validate: (value) => {
        const problems = checkSupabaseConnectionString(value ?? "", project);
        return problems.length ? problems.join("；") : undefined;
      },
    }),
  ).trim();
  return url || null;
}

async function askAuthEmail(): Promise<string> {
  const typed = unwrap(
    await text({
      message: "给这个项目建一个 auth 用户，用哪个邮箱？",
      defaultValue: DEFAULT_AUTH_EMAIL,
      placeholder: DEFAULT_AUTH_EMAIL,
      validate: (value) => ((value ?? "").trim() || DEFAULT_AUTH_EMAIL).includes("@") ? undefined : "要是个邮箱",
    }),
  ).trim();
  return typed || DEFAULT_AUTH_EMAIL;
}

/**
 * 新建项目。
 *
 * 建项目是**对外、可能计费**的动作，所以：先问清三个值 → 把**确切命令**摆出来 →
 * 要一次显式确认，绝不静默执行。数据库密码由我们生成（hex，URL 安全）——
 * 这既是「连接串可推导」的前提，也让它能安全地过 shell。
 */
async function createNewProject(
  orgs: SupaOrg[],
): Promise<{ ref: string; name: string; region: string; dbPassword: string } | null> {
  const orgId =
    orgs.length === 1
      ? (orgs[0]?.id ?? "")
      : (unwrap(
          await select({
            message: "建在哪个组织下",
            options: orgs.map((o) => ({ value: o.id, label: o.name, hint: o.id })),
          }),
        ) as string);
  const org = orgs.find((o) => o.id === orgId);
  if (!org) return null;

  const name = unwrap(
    await text({
      message: "项目名",
      defaultValue: `remember-api-${Math.floor(Math.random() * 9000 + 1000)}`,
      validate: (value) =>
        /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test((value ?? "").trim())
          ? undefined
          : "只能是字母、数字与短横线",
    }),
  ).trim();
  const region = unwrap(await select({ message: "区域", options: REGION_CHOICES })) as string;
  const dbPassword = generateSecret();

  const ok = unwrap(
    await confirm({
      message:
        `要现在创建吗？\n` +
        `npx supabase projects create ${name} --org-id ${org.id} --region ${region} --db-password <生成的 64 位 hex>\n` +
        `（会真的在 Supabase 上建一个项目，可能计费）`,
      initialValue: false,
    }),
  );
  if (!ok) return null;

  const spin = spinner();
  spin.start(`正在创建 ${name}…`);
  const made = await createProject({ name, orgId: org.id, dbPassword, region });
  if (!made.ok) {
    spin.error("建项目失败");
    throw new Error(made.reason);
  }
  // 建完不能马上连：provisioning 是分钟级的。等它出现在清单里（顺便拿到官方区域名）
  const waited = await waitForProject(made.ref ? { ref: made.ref } : { name }, {
    note: (m) => spin.message(m),
  });
  if (!waited.ok) {
    spin.error("等新项目就绪超时");
    throw new Error(waited.reason);
  }
  spin.stop(`项目 ${name} 已创建（${waited.project.ref}）`);
  log.info(`数据库密码（只显示这一次，请自己存好）：${dbPassword}`);
  return {
    ref: waited.project.ref,
    name,
    region: waited.project.region || region,
    dbPassword,
  };
}

/**
 * 在真 Supabase 项目里建 auth 用户，把 uid 对齐给 seed。
 *
 * 失败**不阻断**安装：网关跑的是 gateway-only（不校验 Supabase 身份），拿不到真 uid 时
 * seed 用本地假 id 照样通。代价只是那个用户在走 RLS 的路径下不可见 —— 值得说清楚，
 * 但不值得让整台装不上。
 */
async function ensureCloudAuthUser(config: CliConfig, cloud: CloudChoice): Promise<void> {
  const spin = spinner();
  spin.start("在 Supabase Auth 里建用户…");

  const key = await getServiceRoleKey(cloud.ref);
  if (!key.ok) {
    spin.stop("跳过 Auth 用户");
    log.warn(`${key.reason}\nseed 会用本地假 id：网关不受影响，但这个用户在走 RLS 的路径下不可见`);
    return;
  }

  const made = await ensureAuthUser({
    projectUrl: projectUrl(cloud.ref),
    serviceRoleKey: key.key,
    email: cloud.email,
    password: cloud.userPassword,
  });
  if (!made.ok) {
    spin.stop("跳过 Auth 用户");
    log.warn(`${made.reason}\nseed 会用本地假 id：网关不受影响，但这个用户在走 RLS 的路径下不可见`);
    return;
  }

  config.user = { id: made.id, email: cloud.email, name: config.user.name };
  spin.stop(
    `Auth 用户 ${cloud.email} ${made.created ? "已创建" : "已存在，复用"}` +
      `（uid ${made.id}${made.created ? ` · 密码 ${cloud.userPassword}` : ""}）`,
  );
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

