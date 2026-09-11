/**
 * 「用 supabase CLI 帮忙配一个云端项目」这条路。
 *
 * 为什么只做到这一步：CLI 能告诉我们**项目清单**（ref + 区域），但给不出
 * **池化连接串**——那里面还差一个数据库密码，而密码只有 Dashboard 有。
 * 更关键的是池化主机名里带集群前缀（`aws-0-` / `aws-1-`），**推不出来**：
 * 同一个区域两种前缀都存在（实测 aws-0-us-east-1 与 aws-1-us-east-1 都有解析）。
 * 所以这里的做法是：CLI 拿 ref/区域 → 用户贴一次 Dashboard 上那条池化串 →
 * 我们**按 ref 与区域校验**它。宁可让用户贴一次，也不猜一个可能错的主机名。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SupaProject {
  /** 项目 ref（就是 Project URL 里那段） */
  ref: string;
  name: string;
  region: string;
}

export type ProjectList = { ok: true; projects: SupaProject[] } | { ok: false; reason: string };

async function runCli(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["--yes", "supabase", ...args], {
      windowsHide: true,
      // Windows 上 npx 是 npx.cmd，execFile 直接执行会 EINVAL。
      // 本模块传进去的参数全是写死的字面量、没有用户输入，走 shell 是安全的。
      shell: process.platform === "win32",
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: (stdout || stderr).trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, out: (e.stderr || e.message || String(err)).trim() };
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
      })),
  };
}

/**
 * 项目清单。失败**不抛错**而是把原因带回来：能不能用 CLI 帮忙是「加分项」，
 * 用不上就该退回手填，不该把人卡在这一步。
 */
export async function listSupabaseProjects(): Promise<ProjectList> {
  const res = await runCli(["projects", "list", "--output-format", "json"]);
  if (!res.ok) {
    if (/access token|not logged in|login/i.test(res.out)) {
      return { ok: false, reason: "supabase CLI 还没登录。先跑一次：npx supabase login" };
    }
    return { ok: false, reason: `跑 npx supabase projects list 失败：${res.out.split("\n")[0]}` };
  }
  return parseProjects(res.out);
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
