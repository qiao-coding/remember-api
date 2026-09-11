/**
 * 本地 Postgres 引导 —— 把 `install/local.mdx` 里那串手工命令（起容器 / 建库 /
 * 补 `auth.uid()` 桩 / 迁移）变成幂等的函数。
 *
 * 全部步骤都可重跑：容器已存在就复用，库已存在就跳过，桩用 CREATE OR REPLACE。
 * 向导中断后重来不会留下半截状态，也不会误删用户已有的库。
 */
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient, runMigrations } from "@remember/db";

const execFileAsync = promisify(execFile);

export interface DbPlan {
  container: string;
  image: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export const DEFAULT_DB_PLAN: DbPlan = {
  container: "remember-pg",
  image: "postgres:16",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "remember_api",
};

export function planToUrl(plan: DbPlan, database = plan.database): string {
  const auth = `${plan.user}:${encodeURIComponent(plan.password)}`;
  return `postgres://${auth}@127.0.0.1:${plan.port}/${database}`;
}

/** 维护库连接（CREATE DATABASE 不能在目标库里执行） */
export function planToAdminUrl(plan: DbPlan): string {
  return planToUrl(plan, "postgres");
}

/** 把任意连接串换到维护库；用户自填 URL 时用它建库 */
export function toAdminUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

export function dbNameOf(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) throw new Error(`连接串里没有库名：${url}`);
  return name;
}

/**
 * 托管 Postgres 的主机名后缀。
 *
 * 判据是「这个库不是我们的」：没有 CREATE DATABASE 的权限，也不该在一个别人的
 * 实例里建库。**不**用「非 localhost 即托管」这种粗判——用户自己的 VPS / 局域网的
 * Postgres 需要走完整流程（建库 + 补 auth 桩）。
 */
const HOSTED_DB_SUFFIXES = [".supabase.co", ".pooler.supabase.com"];

/** 从连接串或裸主机名里取主机（去端口、去路径） */
function hostOf(urlOrHost: string): string | null {
  const raw = urlOrHost.trim();
  if (!raw) return null;
  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname;
    } catch {
      return null;
    }
  }
  return raw.split("/")[0]?.split(":")[0] ?? null;
}

/** 是不是托管 Postgres（目前识别 Supabase 的直连与池化主机） */
export function isHostedPostgres(urlOrHost: string): boolean {
  const host = hostOf(urlOrHost)?.toLowerCase();
  if (!host) return false;
  return HOSTED_DB_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Supabase 直连域名 `db.<ref>.supabase.co` —— 只解析出 IPv6，没有 A 记录 */
const SUPA_DIRECT_HOST_RE = /^db\.[a-z0-9]+\.supabase\.co$/i;

/** Supabase 池化端口：6543 事务池（运行时用）/ 5432 session 池（迁移用） */
export const POOLER_TRANSACTION_PORT = 6543;
export const POOLER_SESSION_PORT = 5432;

/**
 * 迁移串 —— Supabase 上「运行时串」与「迁移串」是两条，这里从给的那条推另一条。
 *
 * 分野的原因：事务池（6543）跑不了 DDL，迁移必须走 session 池（5432）。
 * 两者是**同一个 pooler 主机**，所以只换端口，区域不用猜。
 *
 * 三种输入：
 * - 池化串 → 同 host 换成 5432（并去掉 `pgbouncer=true`：那是给运行时的驱动看的）
 * - 直连域名 → **报错**。它只有 IPv6，纯 IPv4 网络下 DNS 就解析不到，
 *   静默接受只会让用户在「连不上」上浪费一轮。给 pooler 的替代写法。
 * - 其它（本机 docker、自建 VPS）→ null，表示一条串够用（直连允许 DDL）
 */
export function resolveMigrateUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // 不是合法 URL：留给下游的「连不上」报错去说，这里不抢话
  }
  const host = parsed.hostname.toLowerCase();

  if (SUPA_DIRECT_HOST_RE.test(host)) {
    throw new Error(
      `Supabase 直连域名 ${host} 在只有 IPv4 的网络里解析不到（没有 A 记录），迁移必然失败。\n` +
        `改成同一个项目的池化地址（端口 5432 = session 池，DDL 走这条）：\n` +
        `  postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require\n` +
        `区域查法：npx supabase projects list，或控制台 Project Settings → Database → Connection pooling。\n` +
        `（网络确实有 IPv6 时直连是可用的：加 --migrate-url <同一条串> 可跳过这条检查。）`,
    );
  }
  if (!host.endsWith(".pooler.supabase.com")) return null;

  // 池化端点还有个独立的坑：用户名必须带项目 ref。Supavisor 靠它路由租户
  // （external_id），裸 `postgres` 会得到一句看不懂的
  // `(ENOIDENTIFIER) no tenant identifier provided`。实测：同一把密码、同一台主机，
  // 用户名加不加 `.<ref>` 就是「连上」与「连不上」的区别。
  // 注意 ref 推不出来（共享池化主机名里没有它），所以这里只能报错让人补。
  const user = decodeURIComponent(parsed.username);
  if (!user.includes(".")) {
    throw new Error(
      `Supabase 池化地址的用户名必须带项目 ref，你给的是「${user}」—— 连上去只会得到 ` +
        `no tenant identifier provided。\n` +
        `改成 postgres.<ref>，例如 postgres.abcdefghijklmnopqrst。\n` +
        `ref 查法：控制台 Project URL 里那段，或 npx supabase projects list。`,
    );
  }

  parsed.port = String(POOLER_SESSION_PORT);
  // 只对事务池有意义；留在迁移串上会让人以为这条也走 pgbouncer
  parsed.searchParams.delete("pgbouncer");
  parsed.searchParams.delete("connection_limit");
  return parsed.toString();
}

/** 迁移文件夹：`drizzle/` 与产物同级的兄弟目录（package.json 的 files 里带了它） */
export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

async function run(
  file: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { windowsHide: true });
    return { ok: true, stdout: (stdout || stderr).trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, stderr: (e.stderr || e.message || String(err)).trim() };
  }
}

/**
 * 可用 docker 服务的版本串；没有可用的 docker 返回 null。
 *
 * 判的是 **daemon**（`docker info`）而不是 CLI（`docker --version`）：装了 Docker Desktop
 * 但没启动时，`--version` 照样有输出，于是向导会热心地推荐 Docker 路径，然后在
 * `docker run` 上失败。宁可一开始就说「没找到 docker: 请启动 Docker Desktop」。
 */
export async function dockerVersion(): Promise<string | null> {
  const res = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return res.ok && res.stdout ? res.stdout : null;
}

/** docker CLI 在但 daemon 没起 —— 用于给出比「没装 docker」更准的提示 */
export async function dockerCliInstalled(): Promise<boolean> {
  const res = await run("docker", ["--version"]);
  return res.ok;
}

/** 容器状态：running / exited / created…；不存在返回 null */
export async function containerState(name: string): Promise<string | null> {
  const res = await run("docker", ["inspect", "-f", "{{.State.Status}}", name]);
  return res.ok ? res.stdout : null;
}

/**
 * 确保一个可连的本地 Postgres 容器。
 * 已存在同名的就**复用**（跑的接着跑，停的 start 起来），绝不重建 —— 重建等于删库。
 */
export async function ensureContainer(
  plan: DbPlan,
  log: (msg: string) => void,
): Promise<{ action: "reused" | "started" | "created" }> {
  const state = await containerState(plan.container);
  if (state === "running") {
    log(`容器 ${plan.container} 已在运行，复用`);
    return { action: "reused" };
  }
  if (state) {
    const res = await run("docker", ["start", plan.container]);
    if (!res.ok) throw new Error(`启动已有容器失败：${res.stderr}`);
    log(`容器 ${plan.container} 已启动（原有数据保留）`);
    return { action: "started" };
  }

  const res = await run("docker", [
    "run",
    "-d",
    "--name",
    plan.container,
    "-e",
    `POSTGRES_PASSWORD=${plan.password}`,
    "-p",
    `${plan.port}:5432`,
    plan.image,
  ]);
  if (!res.ok) {
    throw new Error(
      `创建容器失败：${res.stderr}\n` +
        `提示：端口 ${plan.port} 若被本机已有的 Postgres 占用，可直接用那一个（向导里选「我有连接串」）。`,
    );
  }
  log(`容器 ${plan.container} 已创建（${plan.image}，端口 ${plan.port}）`);
  return { action: "created" };
}

/** 一次性连接（探针/建库/建桩都只发一两条语句）；SSL 判定与网关同源 */
function oneShot(url: string) {
  return createClient(url, { max: 1, connectTimeout: 5, onnotice: () => {} });
}

/** 轮询到能连上为止；超时抛错（docker 首次拉镜像可能要几十秒） */
export async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const sql = oneShot(url);
    try {
      await sql`SELECT 1`;
      await sql.end();
      return;
    } catch (err) {
      lastError = (err as Error).message;
      await sql.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`等待 Postgres 就绪超时（${timeoutMs / 1000}s）：${lastError}`);
}

/** 库不存在才建（幂等） */
export async function ensureDatabase(adminUrl: string, database: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`库名只允许字母、数字与下划线：${database}`);
  }
  const sql = oneShot(adminUrl);
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${database}`;
    if (rows.length > 0) return false;
    await sql.unsafe(`CREATE DATABASE "${database}"`);
    return true;
  } finally {
    await sql.end();
  }
}

/** 我们自己的桩长什么样（用来认出「这个 auth.uid() 是不是我们建的」） */
const STUB_SRC_RE = /^\s*select\s+null::uuid\s*;?\s*$/i;

/**
 * `auth.uid()` —— 本地 PostgreSQL 没有 Supabase 的 auth schema，而
 * `drizzle/0001_supabase_rls.sql` 的 CREATE POLICY 引用了它，缺了迁移必失败。
 * 返回 null::uuid：本地是单用户 + 直连（表属主绕过 RLS），不需要真实身份。
 *
 * ⚠️ **只在它不存在时创建，绝不覆盖已有的。**
 *
 * Supabase 托管的库里有真的 `auth.uid()`（读 JWT claim）。老代码无脑
 * `CREATE OR REPLACE`，把用户指向真 Supabase 的连接串喂进来，就会把那个函数换成
 * 恒返回 null 的桩 —— 等于把该项目**所有表的 RLS 对所有人静默关掉**，而用户的
 * Supabase 账号里往往还跑着别的应用。托管库上「已存在且不是我们的」是**正常且
 * 期望**的状态（不是错误），所以这里安静地沿用，只把结论回给调用方去说。
 */
export async function ensureAuthStub(url: string): Promise<"created" | "kept"> {
  const sql = oneShot(url);
  try {
    // 读 pg_proc.prosrc 而不是 pg_get_functiondef()：后者对非属主会报
    // 「must be owner of function」，而我们在托管库上恰恰不是属主。
    const rows = (await sql`
      SELECT p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'auth' AND p.proname = 'uid' AND p.pronargs = 0
    `) as { prosrc: string }[];

    // 已经有一个（我们的，或 Supabase 真的）→ 一个字都不动
    if (rows.length > 0) return "kept";

    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS auth");
    await sql.unsafe(
      "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT null::uuid'",
    );
    return "created";
  } finally {
    await sql.end();
  }
}

/** 供测试与诊断：这个 prosrc 是不是我们自己的桩 */
export function isOwnAuthStub(prosrc: string): boolean {
  return STUB_SRC_RE.test(prosrc);
}

/** 连通性探针（status 用）；返回错误串而不是抛 */
export async function probe(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!url) return { ok: false, error: "未配置 DATABASE_URL" };
  const sql = oneShot(url);
  try {
    await sql`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await sql.end().catch(() => {});
  }
}

export interface PrepareOptions {
  /** 等待 Postgres 就绪的上限。本地新建容器可能要几十秒；托管库从暂停中唤醒要几分钟 */
  timeoutMs?: number;
  /** 迁移/建桩用的连接串；不给则从 `url` 推（见 `resolveMigrateUrl`），推不出就用 `url` */
  migrateUrl?: string;
}

/**
 * 让一个库变成「可迁移」的状态，幂等。
 *
 * 本机库：等就绪（对维护库）→ 建库 → 补 auth 桩 → 迁移。
 * 托管库：**跳过建库**（没权限，也不该在别人的实例里建），直接对目标库等就绪。
 * 两边都会补 auth 桩，但只在它不存在时（见 `ensureAuthStub`）。
 *
 * 分流依据是**主机名**，不是调用方选了哪个函数——老代码只要拿到 `--url` 就无脑
 * 走建库 + `CREATE OR REPLACE auth.uid()`，指向真 Supabase 就会静默关掉 RLS。
 *
 * **建桩与迁移走 `migrateUrl` 而不是 `url`**：Supabase 上 `url` 常常是事务池
 * （6543，给运行时的），而 `CREATE FUNCTION` / `CREATE TABLE` 是 DDL，
 * 在事务池上会失败。这两步都要求 session 级连接。
 *
 * 迁移文件夹相对**本产物**（`dist/cli.js` → `<包根>/drizzle`），不是 cwd。
 */
export async function prepareDatabase(
  url: string,
  log: (msg: string) => void,
  opts: PrepareOptions = {},
): Promise<void> {
  const hosted = isHostedPostgres(url);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const migrateUrl = opts.migrateUrl ?? resolveMigrateUrl(url) ?? url;

  log("等待 Postgres 就绪…");
  if (hosted) {
    await waitForServer(migrateUrl, timeoutMs);
  } else {
    const adminUrl = toAdminUrl(url);
    await waitForServer(adminUrl, timeoutMs);
    const dbName = dbNameOf(url);
    if (await ensureDatabase(adminUrl, dbName)) log(`已创建数据库 ${dbName}`);
    else log(`数据库 ${dbName} 已存在`);
  }

  const stub = await ensureAuthStub(migrateUrl);
  log(stub === "created" ? "auth.uid() 桩已就位" : "auth.uid() 已存在，沿用原函数（未覆盖）");

  if (migrateUrl !== url) log(`迁移走 session 池（${POOLER_SESSION_PORT}）`);
  await runMigrations(migrateUrl, migrationsFolder());
  log("迁移完成");
}
