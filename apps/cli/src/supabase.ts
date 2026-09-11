/**
 * 「用 supabase CLI 帮忙配一个云端项目」这条路 —— 本模块只管**跟 CLI 打交道**：
 * 登录、组织、项目清单、建项目、API Key。连接串怎么从这些信息里推出来是另一件事，
 * 在 `supabase-connect.ts`（那一步要真连库试）。
 *
 * 一条贯穿全模块的原则：CLI 用不上（没装 / 没登录 / 网络不通 / 版本变了）**一律不抛错**，
 * 把「为什么」写成一句人话交回调用方，由它退回手填。加分的辅助路不该把人卡死。
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SupaProject {
  /** 项目 ref（就是 Project URL 里那段） */
  ref: string;
  name: string;
  region: string;
  /**
   * CLI 报的状态：`ACTIVE_HEALTHY` / `INACTIVE` / …
   *
   * 带出来是**必须**的：Supabase 会把闲置项目暂停，而暂停的项目池化主机**连不上**，
   * 报错和「密码不对」「还没 provisioning」长得一模一样。真机上这个账号三个项目里
   * 两个就是 `INACTIVE` —— 不把它读出来，用户会一直在密码上找原因。
   */
  status: string;
}

export type ProjectList = { ok: true; projects: SupaProject[] } | { ok: false; reason: string };

/**
 * 用户输入进 shell 前的白名单。
 *
 * 不是「顺手校验一下」：Windows 上 npx 是 `npx.cmd`，`execFile` 直接执行会 EINVAL，
 * 所以 `runCli` 必须走 `shell: true` —— 参数会被 cmd.exe **再解析一遍**，一个叫
 * `a & del x` 的项目名就能变成一条真命令。这几类值本来就有严格字符集要求，
 * 卡死在白名单上既不损失表达力，又把注入口子堵死。
 *
 * 数据库密码**不走这里**，因为它根本不进 `runCli`：建项目那条路的密码是我们生成的 hex，
 * 已有项目的密码只用于直连（走 URL 的 `encodeURIComponent`，不过 shell）。
 */
export function safeArg(value: string, kind: "name" | "id"): string {
  const ok = kind === "name" ? /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(value) : /^[A-Za-z0-9._-]+$/.test(value);
  if (!ok) throw new Error(`${kind === "name" ? "项目名" : "标识"}里有不允许的字符：${value}`);
  return value;
}

async function runCli(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["--yes", "supabase", ...args], {
      windowsHide: true,
      // 见 safeArg 的注释：走 shell 是被 Windows 的 npx.cmd 逼的，
      // 代价是用户输入必须先过白名单。
      shell: process.platform === "win32",
      maxBuffer: 8 * 1024 * 1024,
      // 登录、建项目都是慢命令。没有上限时 CLI 一卡住，向导就永久静止在那儿，
      // 用户既看不到错也等不到头（explore 确认老代码没有 timeout）。
      timeout: opts.timeoutMs ?? 120_000,
    });
    return { ok: true, out: (stdout || stderr).trim() };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      signal?: string;
    };
    // **两个流都要看**：supabase CLI 把错误打在 **stdout**（实测——登出后
    // `projects list --output-format json` 是 exit 1、stdout 一整段 JSON、stderr 0 字节）。
    // 只看 stderr 会把真因整条丢掉，只剩 execFile 那句 `Command failed: npx …`，
    // 于是「没登录」这个唯一有明确下一步的失败认不出来。
    // 只认字符串：execFile 默认 utf8，但别假定它永远不给 Buffer（Buffer 没有 trim）
    const out = [e.stderr, e.stdout]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .join("\n");
    if (e.killed || e.signal) return { ok: false, out: `supabase CLI 超时未返回${out ? `：${out}` : ""}` };
    return { ok: false, out: out || (e.message ?? String(err)).trim() };
  }
}

/** 从可能混了提示行的输出里，切出第一个能解析的 JSON 值 */
function parseLoose(out: string): unknown {
  const trimmed = out.trim();
  const cuts = [trimmed];
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const from = trimmed.indexOf(open);
    const to = trimmed.lastIndexOf(close);
    if (from >= 0 && to > from) cuts.push(trimmed.slice(from, to + 1));
  }
  for (const text of cuts) {
    try {
      return JSON.parse(text);
    } catch {
      // 换下一刀
    }
  }
  return undefined;
}

/**
 * 把 CLI 的输出解成项目数组。
 *
 * ⚠️ 真机（supabase CLI 2.x）回的是 **`{"projects":[...]}` 这个外层对象**，不是裸数组。
 * 早先只认数组，于是向导里「Supabase 项目」这条路**每次都掉回手填**，还顺带说了一句
 * 会被误读成「CLI 坏了」的话（`projects list 回的不是数组：{"projects":[…]}`）。
 * 两种形状都收 —— 实测出来的形状，不是猜的。
 *
 * 外面还可能混提示行（实测 stdout 里会带 `Cannot find project ref…`），所以先整体解析，
 * 失败再从第一个 `[` / `{` 切到对应的最后一个闭括号。反过来只按 `[` 切会把
 * `{"error":...}` 这种「合法 JSON 但没有项目」误报成「没回 JSON」，把人往错方向带。
 */
function parseProjects(out: string): { ok: true; projects: SupaProject[] } | { ok: false; reason: string } {
  const raw = parseLoose(out);
  if (raw === undefined) {
    return { ok: false, reason: `projects list 没回 JSON：${out.slice(0, 200)}` };
  }

  const boxed = raw && typeof raw === "object" ? (raw as { projects?: unknown }).projects : undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(boxed) ? boxed : null;
  if (!list) {
    return {
      ok: false,
      reason: `projects list 回的既不是数组、也没有 projects 数组：${out.slice(0, 200)}`,
    };
  }

  return {
    ok: true,
    projects: list
      .map((p) => p as Record<string, unknown>)
      .filter((p) => typeof p.id === "string" && p.id)
      .map((p) => ({
        ref: String(p.id),
        name: typeof p.name === "string" && p.name ? p.name : String(p.id),
        region: typeof p.region === "string" ? p.region : "",
        status: typeof p.status === "string" ? p.status : "",
      })),
  };
}

/**
 * 项目被暂停了吗（Supabase 会暂停闲置项目）。
 *
 * 用**正面匹配**而不是「不含 ACTIVE 就算暂停」：状态值集合是 CLI 定的、会加新的，
 * 反推的话哪天多一个没见过的值就会被误判成暂停。
 */
export function isPaused(status: string): boolean {
  return /inactive|paused/i.test(status);
}

/**
 * 「没登录」认的是 CLI 输出的英文。CLI 换文案就失效，所以只认几个确凿信号，
 * **不认裸的 `login`** —— 我们自己那句「先跑一次 npx supabase login」也含它，会自匹配。
 */
const NOT_LOGGED_IN_RE = /access token|not logged in|LegacyPlatformAuthRequiredError|not authenticated/i;

/** 「拉不起 CLI」：网络 / registry 的问题，**与登录无关**，下一步是查网不是去登录 */
const CLI_UNAVAILABLE_RE = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|npm ERR!|network/i;

/** 一句话摘要：错误输出可能是一整段 JSON，原样塞进提示里没法看 */
function clip(text: string, max = 200): string {
  const one =
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? "";
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * CLI 失败的统一说法。**必须分三类，因为下一步完全不同** —— 把它们含糊成一句
 * 「失败了」正是最坑人的地方：
 *
 * - **没登录** → 要的是 Supabase **账号**，不是数据库凭据。说清这一点，
 *   否则用户会跑去翻数据库密码，而那里根本没有解。
 * - **拉不起 CLI**（含「本机压根没装」）→ 与登录无关，别让人白登一次。
 * - **其它** → 把 CLI 的原话带上，别吞掉。
 *
 * **这里只给「为什么」，不给「那怎么办」**：同一个失败在不同阶段下一步完全不同 ——
 * 向导选库那一步该说「改用选手填」，而装到一半拿 service-role key 时该说「跳过、不影响网关」。
 * 把下一步写死在这儿，必然有一处是过期的。下一步由各调用方自己补。
 *
 * 这些串会经 `@clack/prompts` 的 `log.*` 打到终端，**不渲染 markdown**，别写 `**`。
 */
function cliFailure(what: string, out: string): string {
  if (NOT_LOGGED_IN_RE.test(out)) {
    return (
      "supabase CLI 还没登录 —— 这一步要的是 Supabase 账号，不是数据库凭据。" +
      "先跑一次：npx supabase login"
    );
  }
  if (CLI_UNAVAILABLE_RE.test(out)) {
    return (
      `拉不起 supabase CLI（网络 / registry 的问题，与登录无关；` +
      `本机没装过的话 npx 会现去下载一份）：${clip(out)}`
    );
  }
  return `${what.trim()}失败：${clip(out)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 项目清单。失败**不抛错**而是把原因带回来：能不能用 CLI 帮忙是「加分项」，
 * 用不上就该退回手填，不该把人卡在这一步。
 */
export async function listSupabaseProjects(): Promise<ProjectList> {
  const res = await runCli(["projects", "list", "--output-format", "json"]);
  if (!res.ok) return { ok: false, reason: cliFailure("跑 npx supabase projects list ", res.out) };
  return parseProjects(res.out);
}

// ─────────────────────────── 登录 ───────────────────────────

export interface TerminalSpec {
  file: string;
  args: string[];
  /** Windows 那条要把整串交给 cmd.exe 自己解析，所以走 shell */
  shell?: boolean;
}

/**
 * 怎么在一个**新窗口**里跑一条命令。纯函数，便于把三个平台的选择逻辑测出来。
 *
 * Windows 用 `cmd /k` 而不是 `/c`：命令失败时窗口留着，用户能看见那行报错 ——
 * 一闪而过的窗口对排错毫无帮助，而这一步出错的概率恰恰不低（网络、代理、浏览器没起来）。
 * `start` 的第一个参数是**窗口标题位**，给空串，否则它会把命令名当成标题。
 */
export function terminalCommand(
  cmd: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): TerminalSpec | null {
  if (platform === "win32") {
    return { file: `start "" cmd /k "${cmd}"`, args: [], shell: true };
  }
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: [
        "-e",
        `tell application "Terminal" to do script "${cmd}"`,
        "-e",
        'tell application "Terminal" to activate',
      ],
    };
  }
  const term = env.TERMINAL?.trim();
  if (term) return { file: term, args: ["-e", "sh", "-c", cmd] };
  return null; // 拿不到终端 → 调用方退回本进程跑，别静默什么都不做
}

/** 开一个独立窗口跑命令。返回「窗口有没有真的起来」，不是「命令有没有成功」 */
export function openInTerminal(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const spec = terminalCommand(cmd);
    if (!spec) return resolve(false);
    let settled = false;
    const done = (value: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    // spawn 的失败是**异步事件**不是异常：不挂 error 监听，ENOENT 会变成
    // 未捕获的 'error' 事件，直接把 CLI 带崩
    const child = spawn(spec.file, spec.args, {
      detached: true,
      stdio: "ignore",
      shell: spec.shell ?? false,
      windowsHide: false,
    });
    child.on("error", () => done(false));
    child.on("spawn", () => {
      child.unref(); // 让本进程能正常退出，不等那个窗口
      done(true);
    });
  });
}

export interface LoginOptions {
  /** 状态播报：检查前的预告（npx 可能要下载 CLI）、弹窗提示、等待中 */
  note?: (msg: string) => void;
  /** 轮询总时长，默认 5 分钟 —— 登录要跳浏览器、可能还要注册 */
  timeoutMs?: number;
  pollMs?: number;
  /** 测试注入：默认真开窗口 */
  open?: (cmd: string) => Promise<boolean>;
}

export type LoginResult = { ok: true } | { ok: false; reason: string };

/**
 * 确保 supabase CLI 已登录：没登录就**弹一个新终端窗口**让用户自己去登，
 * 本进程只轮询「登好了没」，不代劳、也不等他。
 *
 * 为什么不在本进程跑 `supabase login`：它会阻塞等浏览器回调，把向导的进度输出
 * 和那个交互搅在一起；而且用户看到的是「向导卡住了」，不是「该我操作了」。
 * 单独一个窗口既是明确的「该你了」，登录完也能自己想关就关。
 */
export async function loginSupabase(opts: LoginOptions = {}): Promise<LoginResult> {
  // 先喊一声再动手：`npx --yes supabase` 在**没装过 CLI 的机器上会现去 registry 下一份**
  // （首次几十秒到几分钟，还整条静默）。不预告的话，这段等待和「卡死」没有区别。
  opts.note?.("正在用 npx 检查 supabase 登录状态（本机没装过 CLI 的话，这一步会现下载一份，慢是正常的）");

  const first = await runCli(["projects", "list", "--output-format", "json"], { timeoutMs: 60_000 });
  if (first.ok) return { ok: true };
  // 报错不是「没登录」的，别把网络问题说成没登录 —— 那会让人白登一次
  if (!NOT_LOGGED_IN_RE.test(first.out)) {
    return { ok: false, reason: cliFailure("检查 supabase 登录状态 ", first.out) };
  }

  const open = opts.open ?? openInTerminal;
  const cmd = "npx --yes supabase login";
  if (!(await open(cmd))) {
    return { ok: false, reason: `弹不出终端窗口，请自己跑一次：${cmd}` };
  }
  const waitMs = opts.timeoutMs ?? 5 * 60_000;
  // 短于一分钟时说「秒」：否则测试那种 5ms 的等待会打出「等了 0 分钟」，看着像坏了
  const waitText = waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} 分钟` : `${Math.round(waitMs / 1000)} 秒`;
  // 把**上限**和**退出方式**都说出来。轮询没法知道那边窗口是不是被关掉了，
  // 用户若改主意不登了，不说清的话他只能对着这个空转干等满全程。
  opts.note?.(
    `已弹出终端窗口，请在那边完成登录（浏览器里点一下就好）。` +
      `最多等 ${waitText}；不想登就关掉窗口，回来选「手填连接串」也一样。`,
  );

  const deadline = Date.now() + waitMs;
  const pollMs = opts.pollMs ?? 2000;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const res = await runCli(["projects", "list", "--output-format", "json"], { timeoutMs: 60_000 });
    if (res.ok) return { ok: true };
  }
  return { ok: false, reason: `等了 ${waitText}还没检测到登录完成` };
}

// ─────────────────────────── 组织与项目 ───────────────────────────

export interface SupaOrg {
  id: string;
  name: string;
}

export type OrgList = { ok: true; orgs: SupaOrg[] } | { ok: false; reason: string };

function parseOrgs(out: string): OrgList {
  const raw = parseLoose(out);
  if (raw === undefined) return { ok: false, reason: `orgs list 没回 JSON：${out.slice(0, 200)}` };
  const boxed =
    raw && typeof raw === "object" ? (raw as { organizations?: unknown }).organizations : undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(boxed) ? boxed : null;
  if (!list) return { ok: false, reason: `orgs list 回的既不是数组、也没有 organizations 数组` };

  return {
    ok: true,
    orgs: list
      .map((o) => o as Record<string, unknown>)
      .filter((o) => typeof o.id === "string" && o.id)
      .map((o) => ({
        id: String(o.id),
        name: typeof o.name === "string" && o.name ? o.name : String(o.id),
      })),
  };
}

/**
 * 组织清单。建项目必须落在某个组织下，而组织 id 用户根本不知道（Dashboard 里也不显眼），
 * 所以这一步必须由 CLI 来给。
 *
 * 形状按「外层对象 or 裸数组」两种都收 —— `projects list` 的真机形状踩过一次
 * （见 `parseProjects`），同一个 CLI、同一类子命令，不赌它这次是数组。
 */
export async function listOrganizations(): Promise<OrgList> {
  const res = await runCli(["orgs", "list", "--output-format", "json"]);
  if (!res.ok) return { ok: false, reason: cliFailure("跑 npx supabase orgs list ", res.out) };
  return parseOrgs(res.out);
}

/** 建项目时从 CLI 输出里扒 ref（新版回 JSON、旧版可能什么都不回，所以是可选的） */
function extractRef(out: string): string | null {
  const raw = parseLoose(out) as Record<string, unknown> | undefined;
  if (raw && typeof raw === "object") {
    for (const key of ["id", "ref", "project_ref"]) {
      const value = raw[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return null;
}

export interface CreateProjectOptions {
  name: string;
  orgId: string;
  /** **我们生成的**密码：这条路用户不该手敲一个字符 */
  dbPassword: string;
  region: string;
}

export type CreateResult = { ok: true; ref: string | null } | { ok: false; reason: string };

/**
 * 建一个项目。压缩到只剩三个必填：名字、组织、区域。
 *
 * 密码由调用方生成 hex 传进来 —— 这既是「云端一键装」的前提（密码我们知道 = 连接串
 * 可推导），也决定了它必须过 shell 白名单。注意 `--db-password` 会出现在本机进程列表里；
 * 本地单用户场景下这是可接受的代价，但它确实不是秘密通道。
 */
export async function createProject(opts: CreateProjectOptions): Promise<CreateResult> {
  if (!/^[A-Za-z0-9]{16,}$/.test(opts.dbPassword)) {
    throw new Error("生成的数据库密码必须是纯字母数字（它要过 shell），这里出了内部错误");
  }
  const res = await runCli(
    [
      "projects",
      "create",
      safeArg(opts.name, "name"),
      "--org-id",
      safeArg(opts.orgId, "id"),
      "--db-password",
      opts.dbPassword,
      "--region",
      safeArg(opts.region, "id"),
      "--output-format",
      "json",
    ],
    { timeoutMs: 5 * 60_000 }, // 建项目是慢命令，给足
  );
  if (!res.ok) return { ok: false, reason: `建项目失败：${res.out.split("\n")[0]}` };
  return { ok: true, ref: extractRef(res.out) };
}

export interface WaitProjectOptions {
  timeoutMs?: number;
  pollMs?: number;
  note?: (msg: string) => void;
}

/** 等哪个项目。**ref 优先**：`createProject` 已经给了 ref 时按它等，别按名字认 */
export interface ProjectMatch {
  ref?: string;
  name?: string;
}

/**
 * 等新项目出现在清单里。
 *
 * 建项目是**异步 provisioning**：`projects create` 返回不代表库能连了，中间隔着分钟级。
 * 不轮询就会出现「刚建好就连、连不上、报一堆迷惑的错」。区域也从这里拿 ——
 * 建的时候我们给的是枚举值，清单回的是它自己认的区域名，以它为准。
 *
 * **手里有 ref 就必须按 ref 等**：按名字等会在「同名项目已存在」时当场命中旧的那个，
 * 于是向导拿着老的 ref 去连，报的还是「新项目连不上」，几乎没法自查。
 */
export async function waitForProject(
  match: ProjectMatch,
  opts: WaitProjectOptions = {},
): Promise<{ ok: true; project: SupaProject } | { ok: false; reason: string }> {
  const label = match.ref ?? match.name ?? "";
  if (!label) return { ok: false, reason: "waitForProject 既没给 ref 也没给名字" };

  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const pollMs = opts.pollMs ?? 5000;
  let last = "";
  while (Date.now() < deadline) {
    const list = await listSupabaseProjects();
    if (list.ok) {
      const hit = list.projects.find((p) =>
        match.ref ? p.ref === match.ref : match.name ? p.name === match.name : false,
      );
      if (hit) return { ok: true, project: hit };
    } else {
      last = list.reason;
    }
    opts.note?.(`等待项目 ${label} 就绪…`);
    await sleep(pollMs);
  }
  return { ok: false, reason: `等项目 ${label} 就绪超时${last ? `（最近一次：${last}）` : ""}` };
}

/**
 * 项目的 service role Key —— 建真实 auth 用户要用它调 Auth Admin API。
 *
 * `--reveal` 不能省：不带它 CLI 打的是掩码，拿到的会是一串 `sb_secret_***`，
 * 报错要等到真发请求才出现。服务端密钥**只在本进程内存里过一遍**，绝不落盘
 * （`configToEnv` 刻意清空 `SUPABASE_SERVICE_ROLE_KEY` 就是为了防它悄悄接管出站凭据）。
 *
 * 两种命名都要认：老项目给 `service_role`，新项目给 `sb_secret_…` 前缀。
 */
export async function getServiceRoleKey(
  ref: string,
): Promise<{ ok: true; key: string } | { ok: false; reason: string }> {
  const res = await runCli([
    "projects",
    "api-keys",
    "--project-ref",
    safeArg(ref, "id"),
    "--reveal",
    "--output-format",
    "json",
  ]);
  if (!res.ok) return { ok: false, reason: cliFailure("取项目 API Key ", res.out) };

  const raw = parseLoose(res.out);
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { api_keys?: unknown }).api_keys)
      ? ((raw as { api_keys: unknown[] }).api_keys as unknown[])
      : null;
  if (!list) return { ok: false, reason: "api-keys 回的既不是数组、也没有 api_keys 数组" };

  const rows = list.map((r) => r as Record<string, unknown>);
  const pick = (r: Record<string, unknown>): string => String(r.api_key ?? r.key ?? "");
  const service =
    rows.find((r) => pick(r).startsWith("sb_secret_")) ??
    rows.find((r) => String(r.name ?? "") === "service_role");
  if (!service) return { ok: false, reason: "api-keys 里没有 service_role / sb_secret_ 条目" };
  return { ok: true, key: pick(service) };
}

/**
 * 项目的 HTTPS 端点 —— Auth Admin API 的调用前缀。
 * 由 ref 直推，不需要再问 CLI（`https://<ref>.supabase.co` 是固定形状）。
 */
export function projectUrl(ref: string): string {
  return `https://${safeArg(ref, "id")}.supabase.co`;
}

/**
 * 校验用户贴的运行时（池化）连接串是不是**这个项目**的。
 * 返回问题清单，空数组 = 通过。
 *
 * 这几条都是踩过的坑：区域抄错、用户名漏了 `<ref>`（Supavisor 报
 * no tenant identifier，那报错跟密码错完全不像）、错用直连域名（只有 IPv6）、
 * 以及把两条串搞反（运行时必须是事务池 6543）。
 */
export function checkSupabaseConnectionString(url: string, project: SupaProject): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return ["这不是一个合法的连接串"];
  }

  const problems: string[] = [];
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username);

  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) {
    problems.push(
      `这是直连域名（${host}）。只有 IPv6 的网络解析不到它，改用同区域的池化地址 ` +
        `aws-0-${project.region}.pooler.supabase.com（前缀也可能是 aws-1-，以 Dashboard 上那条为准）`,
    );
  } else if (!host.endsWith(".pooler.supabase.com")) {
    problems.push(`主机不像 Supabase 池化地址：${host}（该是 xxx.pooler.supabase.com）`);
  }

  if (project.region && !host.includes(project.region)) {
    problems.push(`区域对不上：这条串是 ${host}，但项目 ${project.ref} 在 ${project.region}`);
  }
  if (!user.includes(".")) {
    problems.push(
      `用户名必须带项目 ref（要写成 postgres.${project.ref}），只写 ${user} 会得到 ` +
        `no tenant identifier provided —— 那个报错看起来像密码错，极难自查`,
    );
  } else if (!user.endsWith(`.${project.ref}`)) {
    problems.push(`用户名的 ref 不是这个项目：${user} vs postgres.${project.ref}`);
  }
  if (parsed.port && parsed.port !== "6543") {
    problems.push(
      `运行时要用事务池端口 6543，这里是 ${parsed.port}。` +
        `5432 是迁移用的 session 池，两条串别用反（本工具会自动帮你推出 5432 那条）`,
    );
  }
  return problems;
}
