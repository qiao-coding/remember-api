#!/usr/bin/env node
/**
 * 安装流程端到端 —— 把 docs 里的安装路径真跑一遍。
 *
 *   node scripts/install-e2e.mjs local     复刻文档 install/local 的源码栏（本机源码 + 本机 Postgres）
 *   node scripts/install-e2e.mjs npx       复刻文档 install/local 的 npx 栏（npx 一行装）
 *   node scripts/install-e2e.mjs supabase  复刻文档的 install/cloud-db（真云端项目）
 *   node scripts/install-e2e.mjs wizard    交互向导（弹真控制台窗口，**要人操作**）
 *   node scripts/install-e2e.mjs all       = local + npx（**不含云端与向导**，见下）
 *
 * 为什么要有它：单元测试证明的是「零件」，不是「装完能不能用」。文档里那串命令
 * 从来没人整体跑过——09-10 那次只留下叙述、没留下脚本，于是「到底验了什么」
 * 今天无从重跑。这个脚本就是把它变成可重复的。
 *
 * ⚠️ 有意为之的边界（别把这几条当 bug）：
 *   - **不打真上游**。验到 `/v1/models` 为止（Key 与 Profile 能对上就算通），
 *     所以登录、对话、真实 usage、各厂商 wire 契约都不在覆盖内。
 *   - **向导的交互分支走 `wizard` 这一条**。它要真 TTY，脚本侧没有，所以弹一个
 *     控制台窗口交给用户操作（见 `handoff`）。`local`/`npx` 用的是 `--yes`，
 *     那是**另一条分支**——测了它不等于测了交互那条。
 *   - **私人服务器不做**（要 VPS）。
 *   - **`all` 故意不含 `supabase`**：云端路会**真写一个线上项目**（建测试用户、
 *     跑迁移），必须显式点名才会发生。顺带也让 `all` 保持「离线可重复」——
 *     云端路的成败还取决于出口网络，不该拖垮本机两条路。
 *
 * 环境变量：
 *   E2E_PG_CONTAINER  默认 remember-pg（本机已跑的 postgres:16）
 *   E2E_PG_PORT       默认 5433（容器映射到宿主机的端口）
 *   E2E_REPORT        报告落盘路径；默认写进系统临时目录，不污染仓库
 *
 * 云端路（supabase）额外读这些；**缺省时回退读 `apps/api/.env`（只读，绝不回显密码）**：
 *   E2E_SUPABASE_DB_URL / DATABASE_URL                 运行时串，事务池 6543
 *   E2E_SUPABASE_MIGRATE_URL / MIGRATE_DATABASE_URL    迁移串，session 池 5432
 *   E2E_SUPABASE_URL / SUPABASE_URL                    项目 URL（/api 路由要靠它挂载）
 *   E2E_SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   E2E_SUPABASE_ANON_KEY                              GoTrue 登录取 token 用；缺省试
 *                                                      `npx supabase projects api-keys`，再退回 service role
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? "remember-pg";
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 5433);
const PG_USER = "postgres";
const PG_PASSWORD = "postgres";

/** demo 引导 Key —— 与 install/local.mdx 里的 BOOTSTRAP_API_KEY 一致 */
const DEMO_KEY = "rma_local_demo";
/** 上游 Key 是假的：本脚本不打出站请求，只要它「存在且能存进去」 */
const FAKE_UPSTREAM_KEY = "sk-e2e-not-a-real-key";
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";

// ─────────────────────────── 输出与步骤记录 ───────────────────────────

const results = [];
let failures = 0;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function section(title) {
  console.log(`\n${c.bold(`═══ ${title} ═══`)}`);
}

/**
 * 跑一个步骤并把结果记进报告。
 * 步骤抛错会**继续往上抛**——一条链路上前面断了后面没有意义，没必要硬撑着跑完。
 */
async function step(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`);
  const started = Date.now();
  const record = { name, ok: false, ms: 0, notes: [] };
  results.push(record);
  try {
    const notes = await fn();
    if (notes) record.notes.push(...(Array.isArray(notes) ? notes : [notes]));
    record.ok = true;
    process.stdout.write(`   ${c.green("✓")} ${c.dim(`${Date.now() - started}ms`)}\n`);
    for (const n of record.notes) console.log(`   ${n}`);
    return record;
  } catch (err) {
    record.ms = Date.now() - started;
    record.error = err instanceof Error ? err.message : String(err);
    failures += 1;
    process.stdout.write(`   ${c.red("✗")} ${record.error.split("\n")[0]}\n`);
    throw err;
  } finally {
    record.ms = Date.now() - started;
  }
}

/** 跳过并**明说跳过**——沉默的跳过会被读成「验过了」 */
function skipped(name, why) {
  results.push({ name, ok: true, skipped: true, notes: [why] });
  console.log(`\n▶ ${name}\n   ${c.dim(`⊘ 跳过：${why}`)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─────────────────────────── 通用工具 ───────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 随机后缀，保证每轮跑在新的库上 */
const rand = () => randomBytes(4).toString("hex");

const tail = (s, n = 1500) => {
  const str = String(s ?? "");
  return str.length > n ? `…${str.slice(-n)}` : str;
};

/** cmd.exe 下给参数加引号（连接串、路径里都可能有冒号/反斜杠） */
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

/** 直接 spawn，不经 shell —— 参数里有引号、单引号、`;` 的 SQL 都安全 */
function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: childEnv(opts),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  if (out.code !== 0) {
    throw new Error(
      `命令失败（exit ${out.code}）：${cmd} ${args.join(" ")}\n` +
        `  stdout: ${tail(out.stdout)}\n  stderr: ${tail(out.stderr)}`,
    );
  }
  return out;
}

/** 子进程环境 = 本进程环境 + 覆盖项 − 显式删掉的键（`env: {X: undefined}` 会变成字符串 "undefined"） */
function childEnv(opts) {
  const env = { ...process.env, ...opts.env };
  for (const k of opts.unset ?? []) delete env[k];
  return env;
}

/**
 * 经 shell 跑（pnpm / npm / npx 在 Windows 上是 .cmd，不经 shell 找不到）。
 * 只用于**前台一次性**命令；长驻进程一律 spawnBg，见那里的注释。
 */
function shStr(command, opts = {}) {
  const res = spawnSync(command, {
    cwd: opts.cwd ?? ROOT,
    env: childEnv(opts),
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  if (out.code !== 0) {
    throw new Error(
      `命令失败（exit ${out.code}）：${command}\n` +
        `  stdout: ${tail(out.stdout)}\n  stderr: ${tail(out.stderr)}`,
    );
  }
  return out;
}

// ─────────────────────────── 数据库 ───────────────────────────

/**
 * 发一条 SQL。宿主机上没有 psql 客户端（实测），所以走容器内的。
 * `ON_ERROR_STOP=1` 让错误真的变成非零退出码——否则 psql 会「成功」返回。
 */
function psql(sql, database = "postgres") {
  return sh("docker", [
    "exec",
    "-i",
    PG_CONTAINER,
    "psql",
    "-U",
    PG_USER,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    sql,
  ]).stdout.trim();
}

function dropDatabase(name) {
  // 不先踢掉连接的话，DROP DATABASE 会因「还有活动连接」失败
  try {
    psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    psql(`DROP DATABASE IF EXISTS "${name}"`);
  } catch (err) {
    console.warn(`   ${c.dim(`清理数据库 ${name} 失败（不致命）：${err.message.split("\n")[0]}`)}`);
  }
}

const dbUrl = (name) => `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${name}`;

// ─────────────────────────── 端口与进程 ───────────────────────────

async function freePort() {
  const srv = createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function waitForHttp(url, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "（还没试过）";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await sleep(300);
  }
  throw new Error(`等待 ${url} 超时（${timeoutMs}ms）：${last}`);
}

/**
 * 起一个长驻进程。
 *
 * **不经过 pnpm / npx / shell**：Windows 上杀父进程不会带走孙进程，pnpm→tsx→node
 * 这种链子会在 taskkill 之后留下一个占着端口的孤儿。直接 spawn node，进程树就是一层。
 */
function spawnBg(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: childEnv(opts),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(String(d)));
  child.stderr.on("data", (d) => chunks.push(String(d)));
  child.captured = () => chunks.join("");
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
}

// ─────────────────── 交互接力：把真 TTY 交给用户 ───────────────────

/**
 * 起一个**真控制台窗口**，把里面那件事交给用户，等 marker 落盘再继续。
 *
 * 为什么需要它：向导的交互分支要 pty，脚本/agent 侧没有。此前这条路完全没测过 ——
 * `--yes` 测的是**另一条分支**，两者在 `isInteractive()` 就分岔了，测了后者不等于
 * 测了前者。窗口里是货真价实的控制台，`process.stdin.isTTY` 为真，向导才会走交互那条。
 *
 * 为什么不能用 `cmd /c start`：从**没有 console** 的父进程里调它不新建窗口，命令直接
 * 跑在父进程的管道上（实测：banner 漏进 stdout、marker 不生成）。`wt.exe -w -1 new-tab`
 * 实测同样没动静。只有 `Start-Process` 真建控制台。
 *
 * ⚠️ **绝不重定向窗口里进程的 stdout**：一旦管道化，`isTTY` 变假，向导会**静默**切到
 * 非交互分支 —— 那就等于测了另一条路，而且从输出上看不出来。所以这里不抓转录，
 * 只认两样东西：marker 里的退出码，和向导留下的**产物**（config.json / 数据库状态）。
 *
 * 中文一律经 `readme.txt` + `chcp 65001` 由 node 打出来：.cmd 本身按 ANSI 代码页解析，
 * 直接写中文会是乱码（这台机器上实测过）。
 */
async function handoff({
  title,
  readme,
  run,
  env = {},
  marker,
  timeoutMs = 20 * 60_000,
  /** 跑完停住等按键。给用户看结果用；dry-run 之类的自动化场景置 false 让窗口自己关 */
  hold = true,
}) {
  const dir = mkdtempSync(join(tmpdir(), "rmb-e2e-handoff-"));
  const bat = join(dir, "run.cmd");
  const guide = join(dir, "readme.txt");
  writeFileSync(guide, readme, "utf8");

  const body =
    [
      "@echo off",
      "chcp 65001 >nul",
      `title ${title}`,
      `cd /d "${ROOT}"`,
      ...Object.entries(env).map(([k, v]) => `set "${k}=${v}"`),
      // 先打清单再问问题：用户是照着清单答的，顺序反了就得往上翻
      `node -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))" "${guide}"`,
      ...run,
      "set CODE=%ERRORLEVEL%",
      "if %CODE% equ 0 goto e2e_ok",
      `>"${marker}" echo FAIL %CODE%`,
      "goto e2e_done",
      ":e2e_ok",
      `>"${marker}" echo OK`,
      ":e2e_done",
      ...(hold
        ? [
            "echo.",
            "echo ==== done (exit %CODE%). Go back to Claude to continue. ====",
            "pause",
          ]
        : []),
    ].join("\r\n") + "\r\n";
  writeFileSync(bat, body, "utf8");

  // 只有 Start-Process 会新建控制台。单引号包路径，内含单引号按 PowerShell 的规矩翻倍。
  const launched = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-Process -FilePath '${bat.replace(/'/g, "''")}'`],
    { windowsHide: true, encoding: "utf8" },
  );
  assert(
    launched.status === 0,
    `弹窗失败（powershell exit ${launched.status}）：${tail(launched.stderr || launched.stdout, 300)}`,
  );

  const deadline = Date.now() + timeoutMs;
  let waited = 0;
  while (!existsSync(marker)) {
    assert(
      Date.now() < deadline,
      `等窗口里的操作超时（${timeoutMs / 60_000} 分钟）—— 窗口可能还开着，但这轮先算失败`,
    );
    await sleep(1000);
    waited += 1000;
    if (waited % 15_000 === 0) {
      process.stdout.write(`   ${c.dim(`…等窗口里的操作（${waited / 1000}s）`)}\n`);
    }
  }

  const verdict = readFileSync(marker, "utf8").trim();
  // 成功就收掉自己的临时文件；失败时留着 —— run.cmd 里是这次原样交给用户的清单
  if (verdict === "OK") rmSync(dir, { recursive: true, force: true });
  // 窗口是 pause 住的，失败时**先别关**：那里面的输出是唯一线索
  assert(
    verdict === "OK",
    `窗口里那一步以 ${verdict} 收场。窗口还开着的话，请把它里面的内容复制过来\n` +
      `  （窗口标题栏右键 → 编辑 → 全选 → 复制）—— 这是唯一的线索，脚本故意不抓转录\n` +
      `  本次窗口的脚本与清单留在 ${dir}`,
  );
  return `窗口里走完（${waited / 1000}s，退出码 0）`;
}

/** 清理栈：无论成功失败都跑，倒序执行 */
const cleanups = [];
const onCleanup = (fn) => cleanups.push(fn);

async function runCleanups() {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      console.warn(`   ${c.dim(`清理失败（不致命）：${err.message ?? err}`)}`);
    }
  }
  cleanups.length = 0;
}

// ─────────────────────────── 断言 ───────────────────────────

/** 起网关后共用的三条检查 */
async function checkGateway(port, apiKey) {
  const base = `http://127.0.0.1:${port}`;
  const notes = [];

  await step("GET /health", async () => {
    await waitForHttp(`${base}/health`);
    return `${base}/health 200`;
  });

  await step("GET /v1/models（Bearer 认证 + Profile 已建）", async () => {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // 先读一次 body：assert 的 message 参数是**先于** assert 求值的，
    // 写成 assert(ok, tail(await res.text())) 会在成功路径上也把 body 读掉，
    // 后面 res.json() 直接炸「Body has already been read」。
    const raw = await res.text();
    assert(res.status === 200, `期望 200，实际 ${res.status}：${tail(raw, 300)}`);
    const ids = (JSON.parse(raw).data ?? []).map((m) => m.id).filter(Boolean);
    assert(
      ids.includes("remember-dev"),
      `模型列表里没有 remember-dev。实际：${JSON.stringify(ids)}。` +
        `（多半是 Profile 没建出来，或 Key 的 pepper 与建库时不是同一个）`,
    );
    return `model：${ids.join("、")}`;
  });

  await step("负向：错的 Key 必须被拒", async () => {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: "Bearer rma_definitely_wrong" },
    });
    assert(
      res.status === 401,
      `错 Key 应该 401，实际 ${res.status}——鉴权链没在跑（或不认 Key 就放行）`,
    );
    return "401 ✓（鉴权不是摆设）";
  });

  return notes;
}

/**
 * 产物必须自带根 CA —— 返回一行说明，缺了就直接红。
 *
 * tsup 把 `@remember/db` 打进 `apps/api/dist/index.js`，于是 `client.ts` 里那句
 * `join(HERE, "..", "certs")` 解析到的是 **`apps/api/certs`**，不是源码树里的
 * `packages/db/certs`。得靠构建脚本把它拷过去（`apps/api/scripts/copy-assets.mjs`）。
 *
 * 为什么值得单独卡一道：拷贝一旦失效，症状出现在很久之后的 TLS 握手上
 * （`self-signed certificate in certificate chain`），而「源码树里 CA 在位」那条照样绿 ——
 * 它查的是另一个路径，给的是虚假的安心。本地路不握手 TLS，但「产物是否自带」的道理一样，
 * 所以两条路都查，也让它在这台机器上能被真跑到。
 */
function assertBundleCarriesCa() {
  const src = join(ROOT, "packages", "db", "certs", "supabase-ca.pem");
  const bundled = join(ROOT, "apps", "api", "certs", "supabase-ca.pem");
  assert(existsSync(bundled), `产物里没有 ${bundled} —— copy-assets.mjs 没跑或没拷成功`);
  assert(
    readFileSync(bundled).equals(readFileSync(src)),
    `${bundled} 与源码树那份 ${src} 不一致（拷到了旧的或别的文件）`,
  );
  return `${bundled}（${readFileSync(bundled).length} 字节，与源码树逐字节一致）`;
}

// ─────────────────────────── 路径 A：本地源码 ───────────────────────────

async function runLocal() {
  section("路径 A：本地源码（install/local.mdx 的源码栏）");

  const dbName = `e2e_local_${rand()}`;
  const url = dbUrl(dbName);
  const port = await freePort();
  const pepper = randomBytes(32).toString("hex");
  const encryptionKey = randomBytes(32).toString("hex");

  console.log(`   库 ${c.dim(dbName)} · 端口 ${c.dim(String(port))}`);

  onCleanup(() => dropDatabase(dbName));

  await step("建库 + auth 桩（复刻文档里的三条 psql）", () => {
    psql(`DROP DATABASE IF EXISTS "${dbName}"`);
    psql(`CREATE DATABASE "${dbName}"`);
    psql("CREATE SCHEMA IF NOT EXISTS auth", dbName);
    psql(
      "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT null::uuid'",
      dbName,
    );
    return dbName;
  });

  await step("建表（pnpm db:migrate）", () => {
    // 全程用 env 前缀，**不写 apps/api/.env** —— 那是仓库里的真实文件，E2E 不该污染它
    shStr("pnpm db:migrate", { env: { MIGRATE_DATABASE_URL: url, DATABASE_URL: url } });
  });

  await step("写入 demo 数据（pnpm db:seed）", () => {
    shStr("pnpm db:seed", {
      env: {
        DATABASE_URL: url,
        API_KEY_PEPPER: pepper,
        ENCRYPTION_KEY: encryptionKey,
        SEED_USER_ID: "usr_local_admin",
        SEED_USER_EMAIL: "admin@remember.local",
        BOOTSTRAP_API_KEY: DEMO_KEY,
      },
    });
    return `demo Key ${DEMO_KEY}，Profile remember-dev`;
  });

  await step("构建网关产物", () => {
    shStr("pnpm --filter @remember/api build");
    return assertBundleCarriesCa();
  });

  const server = spawnBg("node", ["dist/index.js"], {
    cwd: join(ROOT, "apps", "api"),
    env: {
      DATABASE_URL: url,
      API_KEY_PEPPER: pepper,
      ENCRYPTION_KEY: encryptionKey,
      PORT: String(port),
      HOST: "127.0.0.1",
      LOG_LEVEL: "error",
      // gateway-only：不挂需要 Supabase JWT 的 /api 控制台
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      // 刻意置空：本地一律走 provider_configs，别让开发机上残留的 env Key 接管出站凭据
      UPSTREAM_API_KEY: "",
      UPSTREAM_BASE_URL: "",
    },
  });
  onCleanup(() => stop(server));

  await checkGateway(port, DEMO_KEY);

  skipped(
    "POST /v1/chat/completions",
    "需要真实上游 Key。本脚本只验到 /v1/models —— 真实对话、usage、各家 wire 契约不在覆盖内",
  );

  return { dbName, port, apiKey: DEMO_KEY };
}

// ─────────────────────────── 路径 B：npx 装包 ───────────────────────────

async function runNpx() {
  section("路径 B：npx 安装（install/local.mdx 的 npx 栏）");

  const dbName = `e2e_npx_${rand()}`;
  const url = dbUrl(dbName);
  const port = await freePort();
  const workdir = mkdtempSync(join(tmpdir(), "rmb-e2e-npx-"));
  const home = join(workdir, "home"); // REMEMBER_API_HOME：把 config.json 关进沙盒
  const prefix = join(workdir, "app"); // npm install 的目标
  mkdirSync(home, { recursive: true });
  mkdirSync(prefix, { recursive: true });

  console.log(`   库 ${c.dim(dbName)} · 端口 ${c.dim(String(port))}`);
  console.log(`   沙盒 ${c.dim(workdir)}`);

  onCleanup(() => dropDatabase(dbName));
  onCleanup(() => rmSync(workdir, { recursive: true, force: true }));

  const cliDir = join(ROOT, "apps", "cli");
  let tarball = "";

  await step("构建 CLI", () => {
    shStr("pnpm --filter remember-api build");
  });

  await step("npm pack 出 tarball", () => {
    const out = shStr("npm pack", { cwd: cliDir }).stdout;
    const name = out.trim().split(/\r?\n/).filter(Boolean).at(-1);
    assert(name?.endsWith(".tgz"), `没拿到 tarball 文件名，npm pack 输出：${tail(out, 400)}`);
    tarball = join(cliDir, name);
    return name;
  });

  await step("装进空目录", () => {
    // npm install 仍会去 registry 拉已声明的 @clack/prompts（运行时用不到，已被内联）
    shStr("npm init -y", { cwd: prefix });
    shStr(`npm install --no-audit --no-fund ${q(tarball)}`, { cwd: prefix });
    const installed = join(prefix, "node_modules", "remember-api", "dist", "cli.js");
    assert(
      readFileSync(installed, "utf8").length > 0,
      `装完找不到 ${installed}——package.json 的 files 漏了 dist？`,
    );
    return "node_modules/remember-api 就位";
  });

  // 所有 CLI 调用都走真的 npx。`--no-install` 是关键：否则它可能去 registry 拿一个
  // 同名包，测的就不是我们刚打出来的这个了。
  const npx = (args, opts = {}) =>
    shStr(`npx --no-install remember-api ${args}`, {
      cwd: prefix,
      env: { REMEMBER_API_HOME: home, ...opts.env },
    });

  await step("npx --no-install 能解析到 bin", () => {
    const out = npx("--version").stdout.trim();
    assert(/^\d+\.\d+\.\d+/.test(out), `--version 输出不像版本号：${tail(out, 200)}`);
    return `remember-api ${out}`;
  });

  await step("init --yes（含向导自检）", () => {
    const out = npx(
      `init --yes --url ${q(url)} --provider ${PROVIDER} --model ${MODEL} --key ${q(FAKE_UPSTREAM_KEY)}`,
    ).stdout;
    // 向导末尾的 selfCheck 会真起一个临时网关打 /health 与 /v1/models，
    // 但**不碰上游**——所以一把假 Key 足够把这条链验通。
    assert(
      /自检通过|配置已写入/.test(out),
      `init 没走到收尾。输出：${tail(out, 800)}`,
    );
    return "建库 → 迁移 → 录凭据 → 种子 → 自检 全通";
  });

  const configPath = join(home, "config.json");
  let gatewayKey = "";

  await step("配置落盘且带着网关 Key", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    gatewayKey = config.apiKey?.value ?? "";
    assert(gatewayKey, "config.json 里没有 apiKey.value——connect/up 打不出三件套");
    assert(config.database?.url === url, `配置里的库不是这个：${config.database?.url}`);
    assert(config.selection?.provider === PROVIDER, `selection 没落盘：${JSON.stringify(config.selection)}`);
    return `Key ${gatewayKey.slice(0, 8)}…（配置落在沙盒里，没碰 ~/.remember-api）`;
  });

  await step("status 认得这个库", () => {
    const out = npx("status").stdout;
    assert(/数据库\s+可达/.test(out), `status 说库不可达：${tail(out, 500)}`);
    assert(/已迁移\s+是/.test(out), `status 说没迁移：${tail(out, 500)}`);
    return "数据库可达 · 已迁移";
  });

  await step("connect 打印三件套", () => {
    const out = npx("connect").stdout;
    assert(out.includes(`http://127.0.0.1:4000/v1`), `connect 没打印 Base URL：${tail(out, 400)}`);
    assert(out.includes(gatewayKey), "connect 打印的 Key 与配置里的不是同一把");
    return "Base URL / API Key / Model 三件套齐全";
  });

  await step("model list", () => {
    const out = npx("model").stdout;
    assert(out.includes(PROVIDER), `model 列表里没有 ${PROVIDER}：${tail(out, 400)}`);
    return `${PROVIDER} 在列`;
  });

  await step(`up --port ${port}（真实网关进程）`, async () => {
    // 这里**不用 npx**：npx 是 shell 包装，Windows 上杀不干净会留下占端口的孤儿。
    // 直接跑装好的产物——同一个文件，少一层进程。
    const entry = join(prefix, "node_modules", "remember-api", "dist", "cli.js");
    const child = spawnBg("node", [entry, "up", "--port", String(port)], {
      cwd: prefix,
      env: { REMEMBER_API_HOME: home },
    });
    onCleanup(() => stop(child));
    await waitForHttp(`http://127.0.0.1:${port}/health`);
    assert(
      child.exitCode === null,
      `up 起完就退了（exit ${child.exitCode}）：${tail(child.captured(), 500)}`,
    );
    return "网关进程在跑";
  });

  await checkGateway(port, gatewayKey);

  skipped(
    "POST /v1/chat/completions",
    "需要真实上游 Key。本脚本只验到 /v1/models",
  );

  return { dbName, port, apiKey: gatewayKey };
}

// ─────────────────────────── 路径 D：交互向导 ───────────────────────────

/**
 * 交互向导，真控制台窗口。
 *
 * 与前三条路的根本差别：这里**不驱动**向导，是**用户**在窗口里驱动它。脚本只负责
 * 铺好一次性环境、给一份照抄的清单，然后**只看产物**。这样既绕开了「本机没有 pty」，
 * 也顺带验了一件自动化测不到的事：这道向导落在一个真人手里，能不能顺利走完。
 *
 * 为什么走「我有现成的连接串」而不是默认的 Docker：Docker 那条的容器名与库名在
 * `DEFAULT_DB_PLAN` 里写死（`remember-pg` / `remember_api`），而容器里**已经有**
 * 用户的开发库 `remember_api`。照默认答会把 migration 与 seed 写进他的开发数据。
 * 一次性库走 URL 那条，既安全，又正好覆盖 `ensureDatabase`/`ensureAuthStub`。
 */
async function runWizard() {
  section("路径 D：交互向导（install/local.mdx 的 init，真控制台窗口）");

  const dbName = `e2e_wiz_${rand()}`;
  const url = dbUrl(dbName);
  const workdir = mkdtempSync(join(tmpdir(), "rmb-e2e-wizard-"));
  const home = join(workdir, "home"); // REMEMBER_API_HOME：配置关进沙箱
  const marker = join(workdir, "done.txt");
  mkdirSync(home, { recursive: true });

  // 沙箱外的配置：跑之前记下 mtime，跑完必须没变（REMEMBER_API_HOME 没生效的话会变）
  const outside = join(homedir(), ".remember-api", "config.json");
  const outsideBefore = existsSync(outside) ? statSync(outside).mtimeMs : null;

  console.log(`   一次性库 ${c.dim(dbName)}（跑完 DROP）`);
  console.log(`   ${c.dim("不碰容器里已有的 remember_api —— 那是你的开发库")}`);
  console.log(`   现场 ${c.dim(workdir)}`);

  // **失败就保留现场**：这条路唯一的线索是窗口里的输出，而脚本**故意**不抓转录
  // （管道化会让 isTTY 变假、向导静默切到非交互分支）。所以至少要留下 config.json
  // 与那个库——它们能说明向导走到了哪一步（config 是建库成功后立刻写的，见 init.ts）。
  // 少了这一条，失败时手里只剩一句「exit 1」，等于没法查。
  let keepScene = true;
  onCleanup(() => {
    if (!keepScene) return;
    console.log(`   ${c.dim(`保留现场：${workdir}（下面这些能看出向导走到了哪一步）`)}`);
  });
  onCleanup(() => {
    if (keepScene) return;
    dropDatabase(dbName);
  });
  onCleanup(() => {
    if (keepScene) return;
    rmSync(workdir, { recursive: true, force: true });
  });

  await step("构建 CLI 产物", () => {
    shStr("pnpm --filter remember-api build");
    return "apps/cli/dist/cli.js";
  });

  const readme = [
    "================ remember-api init 向导（E2E 接力） ================",
    "",
    "这不是真实安装：库是一次性的（跑完就删），配置关在沙箱里，",
    "你的 ~/.remember-api 和容器里已有的 remember_api 都不会被碰。",
    "",
    "照着选就行，一共 7 个问题：",
    "",
    "1) 数据库（检测到 Docker…）",
    "   → 选「我有现成的连接串」          （↓ 一下，回车）",
    "   ⚠️ 别选 Docker 那条：它写死用容器里的 remember_api，那是你的开发库",
    "",
    "2) 连接串从哪来？",
    "   → 选「自己贴连接串」              （↓ 一下，回车）",
    "",
    "3) Postgres 连接串 —— 粘贴这整条：",
    `      ${url}`,
    "   ⚠️ 端口是 5433 不是 5432：5432 上是你本机的原生 Postgres，",
    "      5433 才是 Docker 容器。选错了就会写进另一个库。",
    "",
    "4) 有没有单独的迁移连接串？（留空 = 与上面同一条）",
    "   → 直接回车（留空）",
    "",
    "5) 选上游厂商（输入关键字搜索）",
    "   → 输入 deepseek，回车选中 DeepSeek",
    "",
    `6) 选「DeepSeek」的模型 → 选 ${MODEL}（目录里第一项，多半直接回车）`,
    "",
    "7) DeepSeek API Key",
    `   → 粘贴： ${FAKE_UPSTREAM_KEY}`,
    "   （假 Key，不会打出站请求。这步测的是「能不能存进去」，不是能不能用）",
    "",
    "8) 现在做一次自检…？",
    "   → 回车（默认 Yes）",
    "",
    "走完窗口会停住。**不管成功失败，看一眼就回 Claude 这边** ——",
    "我按 config.json 与数据库状态判断，不按窗口里的文字。",
    "===================================================================",
  ].join("\n");

  await step("弹窗等你走完向导（清单在窗口里）", () =>
    handoff({
      title: "remember-api init wizard (E2E)",
      readme,
      run: [`node "${join(ROOT, "apps", "cli", "dist", "cli.js")}" init`],
      env: {
        REMEMBER_API_HOME: home,
        // 清掉厂商 Key：留着的话向导会先问「检测到环境变量 DEEPSEEK_API_KEY，直接用它？」
        // —— 那是另一条分支，而且会把真 Key 写进沙箱
        DEEPSEEK_API_KEY: "",
      },
      marker,
    }),
  );

  const cfg = await step("config.json 是「真走完」的样子", () => {
    const file = join(home, "config.json");
    assert(existsSync(file), `没有 ${file} —— 向导没走到写配置那一步`);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert(
      parsed.database?.url === url,
      `config 里的库不是那个一次性库：${describeUrl(parsed.database?.url ?? "")}`,
    );
    assert(
      parsed.database?.migrateUrl === null,
      `迁移串留空应存成 null，实际 ${JSON.stringify(parsed.database?.migrateUrl)}`,
    );
    assert(parsed.database?.docker === null, "走「自己贴连接串」时不该记下 docker 计划");
    assert(
      parsed.selection?.provider === PROVIDER,
      `provider 应为 ${PROVIDER}，实际 ${parsed.selection?.provider}`,
    );
    assert(
      parsed.selection?.model === MODEL,
      `model 应为 ${MODEL}，实际 ${parsed.selection?.model}`,
    );
    assert(String(parsed.apiKey?.value ?? "").startsWith("rma_"), "引导 Key 没生成");
    return `${PROVIDER}/${MODEL} · 库 ${describeUrl(parsed.database.url)} · 迁移串留空`;
  });

  await step("库是向导自己建出来的（ensureDatabase + 迁移 + 桩 + seed）", () => {
    const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
    assert(exists.trim() === "1", `库里没有 ${dbName} —— ensureDatabase 那一步没跑`);

    const tables = psql(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1",
      dbName,
    );
    for (const t of [
      "api_keys",
      "memories",
      "profiles",
      "projects",
      "provider_configs",
      "request_usage",
      "skills",
      "users",
    ]) {
      assert(tables.includes(t), `表 ${t} 没建出来。实际：[${tables.replace(/\s+/g, " ").trim()}]`);
    }

    const stub = psql(
      "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname = 'auth' AND p.proname = 'uid'",
      dbName,
    );
    assert(stub === "1", `auth.uid() 桩不在（count=${stub}）`);

    const users = psql("SELECT count(*) FROM users", dbName);
    const profiles = psql("SELECT count(*) FROM profiles", dbName);
    assert(Number(users) >= 1, `users 是空的 —— seedUser 没跑`);
    assert(Number(profiles) >= 1, `profiles 是空的 —— Profile 没建出来（/v1/models 会是空的）`);

    return `8 张表 + auth 桩 + ${users} 个用户 + ${profiles} 个 Profile`;
  });

  await step("沙箱没漏：~/.remember-api 一动没动", () => {
    const now = existsSync(outside) ? statSync(outside).mtimeMs : null;
    assert(
      now === outsideBefore,
      `沙箱外的 ${outside} 被改了 —— REMEMBER_API_HOME 没生效，这轮可能动过你的真实配置`,
    );
    return outsideBefore === null ? "沙箱外本来就没有 config，跑完还是没有" : "沙箱外那份 mtime 未变";
  });

  keepScene = false; // 全绿才回收现场（失败时上面的 onCleanup 会保留）
  return { dbName, apiKey: cfg.apiKey.value };
}

// ─────────────────────────── 路径 C：Supabase 云端 ───────────────────────────

/** Supabase 直连域名 `db.<ref>.supabase.co` —— 只有 IPv6，纯 IPv4 网络里 DNS 都解析不到 */
const SUPA_DIRECT_HOST_RE = /^db\.[a-z0-9]+\.supabase\.co$/i;
/** 云端路专用的引导 Key，与本地路的 rma_local_demo 区分开，免得在云端库里认错行 */
const CLOUD_KEY = "rma_cloud_e2e";

/** 只回显 `user@host` —— 连接串里有密码，日志、报错、报告里都不能带出来 */
function describeUrl(url) {
  try {
    const p = new URL(url);
    return `${decodeURIComponent(p.username)}@${p.host}`;
  } catch {
    return "（不是合法连接串）";
  }
}

/**
 * 读 `.env` 只取值。**不回灌 process.env** —— local/npx 两条路是 spread 本进程环境的，
 * 云端凭据一旦进去，它们就会跑去连线上库，而它们本该只碰本机容器。
 */
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(raw.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function cloudCredentials() {
  const envPath = join(ROOT, "apps", "api", ".env");
  const file = readEnvFile(envPath);
  const pick = (env, key) => process.env[env]?.trim() || file[key] || "";
  const runtime = pick("E2E_SUPABASE_DB_URL", "DATABASE_URL");
  let migrate = pick("E2E_SUPABASE_MIGRATE_URL", "MIGRATE_DATABASE_URL");
  const base = pick("E2E_SUPABASE_URL", "SUPABASE_URL").replace(/\/+$/, "");
  const service = pick("E2E_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

  // `.env` 没写迁移串时按端口推：事务池 6543 → 同 host 的 session 池 5432。
  // 规则与 CLI 的 resolveMigrateUrl 相同，但这里是脚本**自带**的实现——
  // E2E 要独立复算出「用户该填什么」，拿被测代码去验被测代码等于没验。
  if (!migrate && runtime) {
    try {
      const u = new URL(runtime);
      u.port = "5432";
      u.searchParams.delete("pgbouncer");
      u.searchParams.delete("connection_limit");
      migrate = u.toString();
    } catch {
      /* 形状不对留给自检步去报，这里不抢话 */
    }
  }
  return { runtime, migrate, base, service, anon: process.env.E2E_SUPABASE_ANON_KEY?.trim() ?? "", envPath };
}

/** TCP 通不通 */
function tcpProbe(host, port, ms = 8000) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(ms, () => done("TIMEOUT"));
    sock.once("connect", () => done("OK"));
    sock.once("error", (e) => done(`ERR ${e.code ?? e.message}`));
  });
}

/**
 * TLS 能不能握上手。**与 TCP 分开测是刻意的**：两者失败的含义完全不同——
 * 「TCP 不通」是网络/DNS，「TCP 通但 TLS 握不上」是中间有东西在挡。
 *
 * ⚠️ Postgres 的 TLS **不是从第一个字节开始的**：客户端要先发一个**明文** SSLRequest
 * （8 字节：int32 长度 8 + int32 code 80877103），服务端回一个 `S` 之后才开始 TLS 握手。
 * 直接 `tls.connect({host, port})` 怼过去，服务端还在等 SSLRequest 包，于是现象是
 * 「TLS 零响应 / ERR_SSL_WRONG_VERSION_NUMBER」—— 本脚本 09-11 那条「出口把 5432/6543
 * 的 TLS 拦了、跨区域一致」的结论就是这么量出来的**假警报**：同一批主机按正确协议
 * 全部 TLSv1.3 握手成功。探 Postgres 端口必须走 SSLRequest，不能裸 TLS。
 */
function tlsProbe(host, port, ms = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const sock = connect({ host, port });
    sock.setTimeout(ms, () => {
      sock.destroy();
      done("TIMEOUT（TCP 都不通）");
    });
    sock.once("error", (e) => done(`ERR ${e.code ?? e.message}`));
    sock.once("connect", () => {
      const req = Buffer.alloc(8);
      req.writeInt32BE(8, 0);
      req.writeInt32BE(80877103, 4);
      sock.write(req);
    });
    sock.once("data", (chunk) => {
      const first = chunk[0];
      if (first !== 0x53) {
        sock.destroy();
        // 'N' 是服务端明说「我不支持 SSL」，与「被拦」是两回事，别混成一句话
        return done(
          first === 0x4e
            ? "服务端不提供 TLS（SSLRequest 回了 N）"
            : `SSLRequest 异常应答：${JSON.stringify(chunk.subarray(0, 16).toString("latin1"))}`,
        );
      }
      sock.setTimeout(0); // 超时改由 TLS 那层管
      let secure;
      try {
        secure = tlsConnect({ socket: sock, servername: host, rejectUnauthorized: false }, () => {
          secure.destroy();
          done(`OK（${secure.getProtocol()}）`);
        });
      } catch (e) {
        return done(`ERR ${e.message}`);
      }
      secure.setTimeout(ms, () => {
        secure.destroy();
        done("TIMEOUT（TLS 无响应）");
      });
      secure.once("error", (e) => done(`ERR ${e.code ?? e.message}`));
    });
  });
}

/**
 * 对云端发一条 SQL。走容器里的 psql —— 宿主机没有 psql 客户端（实测）。
 * 连接串是作为 **argv** 传给 `docker exec` 的，会在本机进程列表里短暂可见；
 * E2E 场景（本机、短时）可以接受，但别把这个模式抄进生产脚本。
 */
function psqlRemote(sql, url) {
  return sh("docker", [
    "exec",
    "-i",
    PG_CONTAINER,
    "psql",
    url,
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    sql,
  ]).stdout.trim();
}

/** 表/函数可能还不存在（迁移前）—— 那种情况返回 null 而不是抛错 */
function psqlRemoteMaybe(sql, url) {
  try {
    return psqlRemote(sql, url);
  } catch {
    return null;
  }
}

const splitLines = (s) =>
  (s ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** 云端现状：表清单 + 每张表行数 + 迁移条数 + 真实 auth.uid() 定义 + 现有用户 id */
async function cloudSnapshot(url) {
  const tables = splitLines(
    psqlRemote(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      url,
    ),
  );
  const counts = {};
  for (const t of tables) counts[t] = Number(psqlRemote(`select count(*) from public."${t}"`, url));
  return {
    tables,
    counts,
    users: splitLines(psqlRemoteMaybe("select id from public.users order by 1", url)),
    migrations: Number(psqlRemoteMaybe("select count(*) from drizzle.__drizzle_migrations", url) ?? 0),
    authUidDef: psqlRemoteMaybe("select pg_get_functiondef('auth.uid()'::regprocedure)", url),
  };
}

/**
 * 把现有行导出成 INSERT 语句。**只回显路径、行数、列名，不回显值**——里面有 key 哈希。
 * 用途是留一份记录，不是一键回滚：迁移后 `api_keys.profile_id` 是 NOT NULL 外键，
 * 想还原同一行还得同时存在对应的 profile 与 project。文件头写明了这一点。
 */
function exportCloudRows(dir, url, tables) {
  const lit = (v) => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const lines = [
    "-- remember-api 云端迁移前备份",
    `-- 生成时间 ${new Date().toISOString()}，来源 ${describeUrl(url)}`,
    "-- 起因：迁移脚本里带 DELETE（0003 会删掉 profile_id IS NULL 的 api_keys）。",
    "-- 注意：这只是**记录**，不是一键回滚——迁移后 api_keys.profile_id 是 NOT NULL 外键，",
    "--       要还原同一行还得同时存在对应的 profile 与 project。",
    "-- 数值/布尔原样，时间与对象按文本引号写入（够读，不保证逐类型往返）。",
    "",
  ];
  const summary = [];
  for (const t of tables) {
    const rows = JSON.parse(
      psqlRemote(`select coalesce(json_agg(x), '[]'::json)::text from public."${t}" x`, url),
    );
    summary.push(`${t}=${rows.length}`);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    lines.push(`-- public.${t}（${rows.length} 行）`, `-- 列：${cols.join(", ")}`);
    for (const r of rows) {
      lines.push(
        `INSERT INTO public."${t}" (${cols.map((x) => `"${x}"`).join(", ")}) VALUES (${cols
          .map((x) => lit(r[x]))
          .join(", ")});`,
      );
    }
    lines.push("");
  }
  const file = join(dir, "cloud-backup.sql");
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return { file, summary };
}

/**
 * 清理**之后**才能做的核对。清理栈是 LIFO，所以在最前面注册它 = 最后才执行；
 * 早了就是在核对「还没清干净」的中间态，必然假红。
 * 结果要手动进报告，否则它会成为唯一一条不出现在报告里的检查。
 */
function afterCleanup(name, fn) {
  onCleanup(async () => {
    const record = { name, ok: false, ms: 0, notes: [] };
    results.push(record);
    const started = Date.now();
    console.log(`\n▶ ${name}`);
    try {
      const notes = await fn();
      // 「没验成」不能打绿勾 —— 那与「验过了」在报告里长得一模一样，正是假绿的来源
      if (notes && !Array.isArray(notes) && notes.skipped) {
        record.ok = true;
        record.skipped = true;
        record.notes.push(notes.skipped);
        console.log(`   ${c.dim(`⊘ 跳过：${notes.skipped}`)}`);
        return;
      }
      if (notes) record.notes.push(...(Array.isArray(notes) ? notes : [notes]));
      record.ok = true;
      console.log(`   ${c.green("✓")}`);
      for (const n of record.notes) console.log(`   ${n}`);
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      failures += 1;
      console.log(`   ${c.red("✗")} ${record.error}`);
    } finally {
      record.ms = Date.now() - started;
    }
  });
}

/** 云端路会真写一个线上项目：建测试用户、跑迁移。所以它必须显式点名才跑，且全程可回收。 */
async function runSupabase() {
  section("路径 C：Supabase 云端（install/cloud-db.mdx）");

  const creds = cloudCredentials();
  const workdir = mkdtempSync(join(tmpdir(), "rmb-e2e-cloud-"));
  const initHome = join(workdir, "init-home"); // REMEMBER_API_HOME：把 init 的 config.json 关进沙盒
  mkdirSync(initHome, { recursive: true });
  // 与 local 路同款：随机 pepper / 加密钥，跑完即弃，不写进任何文件
  const pepper = randomBytes(32).toString("hex");
  const encryptionKey = randomBytes(32).toString("hex");

  console.log(`   项目 ${c.dim(creds.base || "(未配 SUPABASE_URL)")}`);
  console.log(`   库   ${c.dim(describeUrl(creds.migrate))}`);
  console.log(`   工作目录 ${c.dim(workdir)}`);

  onCleanup(() => rmSync(initHome, { recursive: true, force: true }));

  let baseline = null;
  let uid = "";
  const mail = `e2e+${rand()}@example.com`;
  const password = `E2e-${randomBytes(12).toString("base64url")}`;
  let jwt = "";

  // 先注册：LIFO 下它最后执行 ⇒ 那时所有清理都已跑完
  afterCleanup("清理干净：行数回到基线", async () => {
    if (!baseline) return { skipped: "基线没取到（前面就中断了），无事可核对" };
    const after = await cloudSnapshot(creds.migrate);
    const drift = [];
    for (const [t, n] of Object.entries(baseline.counts)) {
      const now = after.counts[t];
      if (now === undefined) drift.push(`${t} 表不见了`);
      else if (now !== n) drift.push(`${t}: ${n} → ${now}`);
    }
    assert(
      !drift.length,
      `云端有残留：${drift.join("；")}\n     E2E 该把测试数据清干净，留痕就是 bug（多半是清理漏了某张表）`,
    );
    const added = after.tables.filter((t) => !(t in baseline.counts));
    const dirty = added.filter((t) => after.counts[t] !== 0);
    assert(
      !dirty.length,
      `迁移新增的表里不该有数据：${dirty.map((t) => `${t}=${after.counts[t]}`).join("；")}`,
    );
    return [
      ...(added.length ? [`迁移新增 ${added.length} 张表（${added.join("、")}），均为空`] : []),
      "既有表行数逐一如初 ✓",
    ];
  });

  await step("凭据齐全且形状正确（只回显 user@host）", () => {
    assert(
      creds.runtime,
      "没有运行时连接串：设 E2E_SUPABASE_DB_URL，或让 apps/api/.env 里有 DATABASE_URL",
    );
    assert(
      creds.migrate,
      "没有迁移连接串：设 E2E_SUPABASE_MIGRATE_URL，或写进 apps/api/.env 的 MIGRATE_DATABASE_URL",
    );
    assert(creds.base, "没有 SUPABASE_URL —— /api 管理路由靠它才挂载，缺了这条只验得到 /v1");
    assert(creds.service, "没有 SUPABASE_SERVICE_ROLE_KEY —— 建/删一次性测试用户要用它");

    const rx = new URL(creds.runtime);
    const mg = new URL(creds.migrate);
    assert(
      !SUPA_DIRECT_HOST_RE.test(rx.hostname),
      `运行时串指向直连域名 ${rx.hostname}：本机只有 IPv4、该域名没有 A 记录，必然连不上。\n` +
        `     改成同区域的 …pooler.supabase.com`,
    );
    assert(
      rx.hostname.endsWith(".pooler.supabase.com"),
      `运行时串主机不像 Supabase 池化地址：${rx.hostname}`,
    );
    assert(rx.port === "6543", `运行时串该走事务池 6543，实际 ${rx.port}`);
    assert(
      mg.port === "5432",
      `迁移串该走 session 池 5432，实际 ${mg.port} —— 事务池上跑 DDL 必失败`,
    );
    assert(
      mg.hostname === rx.hostname,
      `两条串该是同一个池化主机（只换端口）：${mg.hostname} vs ${rx.hostname}`,
    );
    // Supavisor 靠用户名里的 <ref> 路由租户；裸 postgres 报 no tenant identifier，那报错极难自查
    assert(
      rx.username.includes("."),
      `池化地址用户名必须带项目 ref（postgres.<ref>），实际「${rx.username}」`,
    );
    return [
      `运行时 ${describeUrl(creds.runtime)}`,
      `迁移　 ${describeUrl(creds.migrate)}`,
      "分属事务池 / session 池 ✓",
    ];
  });

  await step("根 CA 在位（缺了会报 self-signed certificate in certificate chain）", () => {
    const ca = join(ROOT, "packages", "db", "certs", "supabase-ca.pem");
    assert(existsSync(ca), `找不到 ${ca} —— 它是 *.pem、被 .gitignore 排除，需要单独获取`);
    return `${ca}（${readFileSync(ca).length} 字节）`;
  });

  await step("出口能到池化端口", async () => {
    const host = new URL(creds.migrate).hostname;
    const port = Number(new URL(creds.migrate).port);
    const tcp = await tcpProbe(host, port);
    assert(tcp === "OK", `${host}:${port} TCP 都连不上（${tcp}）—— 网络/DNS 层的问题，与凭据无关`);

    const tls = await tlsProbe(host, port);
    assert(
      tls.startsWith("OK"),
      `${host}:${port} TCP 通、但 TLS 握不上手（${tls}）。\n` +
        `     这不是密码 / 区域 / 账号的问题（都还没走到那一步）。\n` +
        `     先排除中间设备：公司代理 / 防火墙拦非标端口的 TLS 是最常见的原因。\n` +
        `     另注：本步已按 Postgres 协议发 SSLRequest 再升级 TLS；裸 tls.connect 怼\n` +
        `     Postgres 端口会得到假的「零响应」，别用那个写法去复现。`,
    );
    return `${host}:${port} TCP + TLS 均通（${tls}）`;
  });

  await step("基线快照（清理后要核对回到这里）", async () => {
    baseline = await cloudSnapshot(creds.migrate);
    assert(baseline.tables.length > 0, "public 下一张表都没有 —— 连接串指向的库不对？");
    return [
      `${baseline.tables.length} 张表：${Object.entries(baseline.counts)
        .map(([t, n]) => `${t}=${n}`)
        .join(" ")}`,
      `已应用迁移 ${baseline.migrations} 条 · 现有用户 ${baseline.users.length} 个`,
    ];
  });

  await step("迁移前导出既有数据（本地决策：先导出、再迁移）", () => {
    const { file, summary } = exportCloudRows(workdir, creds.migrate, baseline.tables);
    return [`备份 ${file}（权限 600；含 key 哈希，故内容不回显）`, summary.join(" ")];
  });

  await step("构建 CLI 与网关产物", () => {
    shStr("pnpm --filter remember-api build");
    shStr("pnpm --filter @remember/api build");
    return ["remember-api / @remember/api 产物就绪", assertBundleCarriesCa()];
  });

  await step("P0：init 打真云端（迁移 + auth.uid() 绝不被覆写）", () => {
    // 走 CLI 而不是 pnpm db:migrate 是刻意的：init 自己要把事务池串(6543)
    // 推导成迁移串(5432)。这条推导一旦退化（曾经是永远写 null，于是迁移落在
    // 事务池上、DDL 必失败），这一步就会红 —— 它同时是那个缺陷的变异探针。
    const out = shStr(
      `node dist/cli.js init --yes --url ${q(creds.runtime)}` +
        ` --provider ${PROVIDER} --model ${MODEL} --key ${q(FAKE_UPSTREAM_KEY)}`,
      { cwd: join(ROOT, "apps", "cli"), env: { REMEMBER_API_HOME: initHome } },
    ).stdout;
    assert(/自检通过|配置已写入/.test(out), `init 没走到收尾。输出：${tail(out, 800)}`);
    return "建桩 → 迁移 → 录凭据 → 种子 → 自检 全通";
  });

  await step("P0：真实 auth.uid() 与迁移前逐字节相同", () => {
    const after = psqlRemoteMaybe("select pg_get_functiondef('auth.uid()'::regprocedure)", creds.migrate);
    assert(after, "读不到 auth.uid() 的定义 —— 函数没了？");
    assert(
      after === baseline.authUidDef,
      "auth.uid() 被改写了！CLI 的建桩逻辑覆写了真实函数 —— 那等于把 RLS 悄悄关掉（P0 事故）。\n" +
        `     之前：${tail(baseline.authUidDef, 200)}\n     之后：${tail(after, 200)}`,
    );
    return "定义一字未变 ✓（建桩只认得自己造的那个 SELECT null::uuid）";
  });

  await step("建一次性 auth 用户（Auth Admin API）", async () => {
    const res = await fetch(`${creds.base}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: creds.service,
        Authorization: `Bearer ${creds.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: mail, password, email_confirm: true }),
    });
    const raw = await res.text();
    assert(res.status < 300, `建用户失败 HTTP ${res.status}：${tail(raw, 400)}`);
    uid = JSON.parse(raw).id ?? "";
    assert(uid, `Admin API 没回 id：${tail(raw, 300)}`);
    return `${mail} → uid ${uid}`;
  });

  onCleanup(async () => {
    if (!uid) return;
    // 顺序按外键来（子表先走）。其实这些表都从 users 级联，但显式写出来
    // 才不依赖「级联恰好配对了」这个前提。
    for (const t of [
      "request_usage",
      "memories",
      "profiles",
      "api_keys",
      "skills",
      "provider_configs",
      "projects",
    ]) {
      try {
        psqlRemote(`delete from public."${t}" where user_id = '${uid}'`, creds.migrate);
      } catch {
        /* 该表可能还不存在（迁移未跑），跳过 */
      }
    }
    psqlRemote(`delete from public.users where id = '${uid}'`, creds.migrate);
  });

  onCleanup(async () => {
    if (!uid) return;
    const res = await fetch(`${creds.base}/auth/v1/admin/users/${uid}`, {
      method: "DELETE",
      headers: { apikey: creds.service, Authorization: `Bearer ${creds.service}` },
    });
    if (res.status >= 400 && res.status !== 404) {
      console.warn(`   ${c.dim(`删 auth 用户失败 HTTP ${res.status}（不致命，但云端会留一个测试账号）`)}`);
    }
  });

  // init 自己也会往 public.users 写种子行；id 由它定，这里按「基线里没有的」回收
  onCleanup(async () => {
    if (!baseline) return;
    const now = splitLines(psqlRemoteMaybe("select id from public.users order by 1", creds.migrate));
    const extra = now.filter((id) => !baseline.users.includes(id));
    for (const id of extra) {
      try {
        psqlRemote(`delete from public.users where id = '${id}'`, creds.migrate);
      } catch (err) {
        console.warn(`   ${c.dim(`回收 init 种子用户 ${id} 失败：${String(err.message).split("\n")[0]}`)}`);
      }
    }
    if (extra.length) console.log(`   ${c.dim(`回收 init 写入的 ${extra.length} 个种子用户`)}`);
  });

  await step("种子（走事务池 6543）", () => {
    shStr("pnpm db:seed", {
      env: {
        DATABASE_URL: creds.runtime,
        SEED_USER_ID: uid,
        SEED_USER_EMAIL: mail,
        SEED_USER_NAME: "E2E Cloud",
        BOOTSTRAP_API_KEY: CLOUD_KEY,
        API_KEY_PEPPER: pepper,
        ENCRYPTION_KEY: encryptionKey,
      },
    });
    return `引导 Key ${CLOUD_KEY} · Profile remember-dev`;
  });

  const port = await freePort();
  const server = spawnBg("node", ["dist/index.js"], {
    cwd: join(ROOT, "apps", "api"),
    env: {
      DATABASE_URL: creds.runtime,
      SUPABASE_URL: creds.base,
      SUPABASE_SERVICE_ROLE_KEY: creds.service,
      API_KEY_PEPPER: pepper,
      ENCRYPTION_KEY: encryptionKey,
      PORT: String(port),
      HOST: "127.0.0.1",
      LOG_LEVEL: "error",
      UPSTREAM_API_KEY: "",
      UPSTREAM_BASE_URL: "",
    },
    // 刻意**删掉** DATABASE_SSL_CA：留着的话 client.ts 会用它，于是「构建时把
    // certs/ 拷进产物」这一步就验不到了——而那条路径正是打包后才炸的那个坑
    // （dev 走 tsx 从 packages/db/src 读，产物缺 CA 时只报 self-signed）。
    unset: ["DATABASE_SSL_CA"],
  });
  onCleanup(() => stop(server));

  await checkGateway(port, CLOUD_KEY);

  // /api 只在 SUPABASE_URL 非空时挂载（app.ts:26）—— 这一段是本机两条路没有的
  const base = `http://127.0.0.1:${port}`;
  const forgedJwt = (() => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    return (
      `${b64({ alg: "HS256", typ: "JWT" })}.` +
      // claims 全对（含正确的 iss/aud/sub），只有签名是编的 ——
      // 这样 401 就只可能来自**验签**，而不是「claims 没对上」
      `${b64({ sub: "attacker", aud: "authenticated", iss: `${creds.base}/auth/v1`, exp: now + 3600, iat: now })}.` +
      "A".repeat(43)
    );
  })();

  await step("负向：/api 三种非法凭证都必须 401", async () => {
    const cases = [
      ["不带 token", {}],
      ["拿网关 Key 冒充 JWT", { Authorization: `Bearer ${CLOUD_KEY}` }],
      ["claims 全对但签名伪造", { Authorization: `Bearer ${forgedJwt}` }],
    ];
    const notes = [];
    for (const [label, headers] of cases) {
      const res = await fetch(`${base}/api/auth/me`, { headers });
      assert(
        res.status === 401,
        `${label} 期望 401，实际 ${res.status}` +
          (res.status === 404 ? "（404 = /api 压根没挂载：SUPABASE_URL 没传进去？）" : ""),
      );
      notes.push(`${label} → 401`);
    }
    return notes;
  });

  await step("GoTrue 登录取真 JWT", async () => {
    const res = await fetch(`${creds.base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      // anon key 才是对的用法；拿不到时退回 service role（GoTrue 也认）
      headers: { apikey: creds.anon || creds.service, "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password }),
    });
    const raw = await res.text();
    assert(res.status === 200, `登录取 token 失败 HTTP ${res.status}：${tail(raw, 400)}`);
    jwt = JSON.parse(raw).access_token ?? "";
    assert(jwt, `响应里没有 access_token：${tail(raw, 300)}`);
    return `apikey 用 ${creds.anon ? "anon key" : "service role（没配 anon）"}，拿到 access_token`;
  });

  await step("正向：真 JWT 换 /api/auth/me 200（验签走远程 JWKS）", async () => {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const raw = await res.text();
    assert(res.status === 200, `期望 200，实际 ${res.status}：${tail(raw, 300)}`);
    const body = JSON.parse(raw);
    assert(body.user?.id === uid, `返回的不是刚建的那个用户：${JSON.stringify(body.user)} vs ${uid}`);
    assert(body.user?.email === mail, `email 对不上：${body.user?.email} vs ${mail}`);
    return `uid ${uid} 对上 ✓`;
  });

  if (process.env.E2E_SUPABASE_CLI === "1") {
    await step("npx supabase 已登录且区域与 .env 一致", () => {
      const out = shStr("npx --yes supabase projects list --output-format json").stdout;
      // 真机回的是 {"projects":[…]} 外层对象，**不是裸数组**（实测 supabase CLI 2.x）。
      // 这里早先只认数组 —— 跟 apps/cli/src/supabase.ts 是同一个错，只是从没跑到过。
      const from = out.search(/[[{]/);
      assert(from >= 0, `projects list 没回 JSON：${tail(out, 300)}`);
      const parsed = JSON.parse(out.slice(from));
      const list = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
      assert(Array.isArray(list) && list.length, `projects list 里没有项目：${tail(out, 300)}`);
      const ref = new URL(creds.base).hostname.split(".")[0];
      const mine = list.find((p) => p.id === ref);
      assert(mine, `登录的账号里没有项目 ${ref} —— 是不是登错账号了`);
      const migrate = new URL(creds.migrate);
      const runtime = new URL(creds.runtime);
      const host = migrate.hostname;
      assert(
        host.includes(mine.region),
        `区域对不上：.env 是 ${host}，CLI 说项目在 ${mine.region} —— 连接串抄错区域了`,
      );

      // 交叉核对「CLI 推导出的池化主机」的形状 —— 就是 supabase-connect.ts 里那两个候选。
      // 前缀 aws-0 / aws-1 推不出来（同一区域两种都存在），所以这里只断言它落在候选集里，
      // 而不是断言某个具体前缀：那等于把「猜一个」写进测试。
      const prefix = host.split("-").slice(0, 2).join("-");
      assert(
        ["aws-0", "aws-1"].includes(prefix),
        `池化主机前缀不在候选里：${host}（supabase-connect.ts 只试 aws-0 / aws-1）`,
      );
      assert(
        host === `${prefix}-${mine.region}.pooler.supabase.com`,
        `池化主机拼不出来：${host} vs ${prefix}-${mine.region}.pooler.supabase.com`,
      );
      // 两条串必须是同一个主机、只差端口；这是「推不出前缀就真连一次」得以成立的地方
      assert(runtime.hostname === host, `运行/迁移两条串不是同一个主机：${runtime.hostname} vs ${host}`);
      assert(runtime.port === "6543", `运行时串端口该是 6543，实际 ${runtime.port}`);
      assert(migrate.port === "5432", `迁移串端口该是 5432，实际 ${migrate.port}`);

      return `${ref} 在 ${mine.region}，池化主机 ${host}，与连接串一致`;
    });
  } else {
    skipped(
      "npx supabase 登录 / 区域交叉核对",
      "默认不跑：要 npx 现场下载 supabase CLI 且必须已登录。显式设 E2E_SUPABASE_CLI=1 才跑",
    );
  }

  skipped("POST /v1/chat/completions", "需要真实上游 Key。本脚本只验到 /v1/models");

  return { project: describeUrl(creds.runtime), uid, backup: workdir };
}

// ─────────────────────────── 入口 ───────────────────────────

function usage() {
  console.log("用法：node scripts/install-e2e.mjs [local|npx|supabase|wizard|all]");
  console.log("  local / npx  本机可重复，不需要云凭据");
  console.log("  supabase     真云端项目，会建一次性测试用户并跑迁移，跑完回收");
  console.log("  wizard       交互向导，会弹出一个控制台窗口要你操作（7 个问题）");
  console.log("  all          = local + npx（故意不含 supabase 与 wizard）");
}

async function main() {
  const which = (process.argv[2] ?? "all").toLowerCase();
  if (!["local", "npx", "supabase", "wizard", "all"].includes(which)) {
    usage();
    process.exitCode = 2;
    return;
  }

  console.log(c.bold("remember-api 安装 E2E"));
  console.log(c.dim(`仓库 ${ROOT}`));
  console.log(c.dim(`Postgres 容器 ${PG_CONTAINER} → 127.0.0.1:${PG_PORT}`));

  // 前置：容器必须在跑。不在跑的话后面每条 SQL 都会失败，先在这儿说清楚。
  try {
    const state = sh("docker", ["inspect", "-f", "{{.State.Status}}", PG_CONTAINER]).stdout.trim();
    assert(state === "running", `${PG_CONTAINER} 状态是 ${state}，不是 running`);
  } catch {
    console.error(
      `\n${c.red("前置不满足")}：容器 ${PG_CONTAINER} 不在运行。先起一个：\n` +
        `  docker run -d --name ${PG_CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} -p ${PG_PORT}:5432 postgres:16\n`,
    );
    process.exitCode = 1;
    return;
  }

  const outcome = {};
  try {
    if (which === "local" || which === "all") outcome.local = await runLocal();
    if (which === "npx" || which === "all") outcome.npx = await runNpx();
    // 云端路**只在显式点名时跑**：它会真写线上项目（建测试用户、跑迁移），
    // 不像本机两条路那样随手可重来。
    if (which === "supabase") outcome.supabase = await runSupabase();
    // 向导路要人守着窗口，同样只在显式点名时跑
    if (which === "wizard") outcome.wizard = await runWizard();

    if (outcome.local && outcome.npx) {
      section("两条路的对照");
      await step("都产出同一个 demo Profile", () => {
        assert(
          outcome.local.apiKey === DEMO_KEY,
          `本地路的 Key 应该是 ${DEMO_KEY}，实际 ${outcome.local.apiKey}`,
        );
        assert(
          outcome.npx.apiKey !== outcome.local.apiKey,
          "两条路的引导 Key 不该相同（npx 是向导生成的，本地是 seed 写的）",
        );
        return [
          `两条路都建出了 model 名 remember-dev 的 Profile，且 /v1/models 都返回它`,
          `引导 Key 不同是预期的：本地来自 BOOTSTRAP_API_KEY，npx 来自向导生成的随机 Key`,
        ];
      });
    }

    section(failures === 0 ? "全部通过" : `失败 ${failures} 项`);
    console.log(results.map((r) => `  ${r.ok ? (r.skipped ? "⊘" : "✅") : "❌"} ${r.name}`).join("\n"));
  } catch (err) {
    console.error(`\n${c.red("中断")}：${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  } finally {
    section("清理");
    await runCleanups();
    console.log("  已回收：进程、临时库、临时目录");

    const reportPath =
      process.env.E2E_REPORT ?? join(tmpdir(), "remember-api-install-e2e-report.json");
    writeFileSync(reportPath, JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
    console.log(`  报告：${reportPath}`);

    if (failures > 0) process.exitCode = 1;
  }
}

// 直接执行时才跑 main；被 import 时（dry-run 弹窗机制）只取函数。
// 比较归一化到小写、正斜杠：Windows 上盘符大小写与分隔符都可能对不上。
function invokedDirectly() {
  const self = fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
  return Boolean(process.argv[1]) && process.argv[1].replace(/\\/g, "/").toLowerCase() === self;
}

if (invokedDirectly()) await main();

export { handoff };
