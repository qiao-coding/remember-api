/**
 * 这两件事都不是「能跑就行」的：
 *  - `listSupabaseProjects` 必须**把失败变成一句人话**，因为它的失败路径就是
 *    「用不了 CLI，请退回手填」。抛错会把向导卡死在一个本来有替代方案的分支上。
 *  - `checkSupabaseConnectionString` 是用户贴错串时唯一的防线。这几条规则来自实测踩坑：
 *    用户名漏 `<ref>` 得到的是 `no tenant identifier provided`（看着像密码错）、
 *    直连域名在纯 IPv4 网络里根本没有 A 记录、两条串用反则 DDL 失败。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[][],
  /** 弹窗调用（spawn）的参数 */
  spawns: [] as string[][],
  /** 弹窗失败（模拟没有终端 / ENOENT） */
  spawnFails: false,
  /** runCli 的返回值 */
  reply: { ok: true, out: "" } as { ok: boolean; out: string },
  /**
   * 依次消费的返回值，用光后回落到 `reply`。
   * 轮询类的函数（登录、等 provisioning）必须能「先失败几次再成功」，单一回值测不出来。
   */
  queue: [] as { ok: boolean; out: string }[],
  /**
   * 失败时错误打在哪个流。**默认 stdout** —— 真机 supabase CLI 就是这样：
   * 实测登出后 `projects list --output-format json` 是 exit 1、stdout 一整段 JSON、
   * stderr **0 字节**。早先这里写死 stderr，于是 `runCli` 只读 stderr 也能让测试全绿，
   * 真机上却永远拿不到真因（只剩 execFile 那句 `Command failed: npx …`）。
   * 留一个 stderr 分支是因为不能假定 CLI 永远不换流。
   */
  errStream: "stdout" as "stdout" | "stderr",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (
      err: (Error & { stdout?: string; stderr?: string }) | null,
      out?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    state.calls.push([file, ...args]);
    const res = state.queue.shift() ?? state.reply;
    if (!res.ok) {
      // 真 execFile 失败时 `message` 只有 `Command failed: …` 一行，**真因在两个流里**。
      // 哪个流有内容由 errStream 决定，两个流都空才轮得到 message。
      cb(
        Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}`), {
          stdout: state.errStream === "stdout" ? res.out : "",
          stderr: state.errStream === "stderr" ? res.out : "",
        }),
      );
      return;
    }
    cb(null, { stdout: res.out, stderr: "" });
  },
  spawn: (file: string, args: string[], _opts: unknown) => {
    state.spawns.push([file, ...args]);
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const child = {
      on: (ev: string, fn: (...a: unknown[]) => void) => {
        (handlers[ev] ??= []).push(fn);
        return child;
      },
      unref: () => {},
    };
    // 真 spawn 的成败是**事件**、晚于返回；同步触发就测不出「监听器挂上了没」
    queueMicrotask(() => {
      for (const fn of handlers[state.spawnFails ? "error" : "spawn"] ?? []) fn(new Error("boom"));
    });
    return child;
  },
}));

const {
  checkSupabaseConnectionString,
  createProject,
  getServiceRoleKey,
  isPaused,
  listOrganizations,
  listSupabaseProjects,
  loginSupabase,
  openInTerminal,
  projectUrl,
  safeArg,
  terminalCommand,
  waitForProject,
} = await import("./supabase.js");

const PROJECT = {
  ref: "abcdefghijklmnopqrst",
  name: "my-app",
  region: "us-east-1",
  status: "ACTIVE_HEALTHY",
};
const GOOD = `postgres://postgres.${PROJECT.ref}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`;

function reply(out: string): void {
  state.reply = { ok: true, out };
}

function fail(out: string): void {
  state.reply = { ok: false, out };
}

/** 排队若干次返回值，供轮询类的函数用 */
function then(...res: { ok: boolean; out: string }[]): void {
  state.queue = res;
}

/**
 * 登出状态下 `npx supabase projects list --output-format json` 的原样 stdout —— **实测抄回来的**，
 * 不是编的。要点：退出码 1，原因全在 **stdout**，stderr 是空的。
 */
const LOGGED_OUT =
  '{"_tag":"Error","error":{"code":"LegacyPlatformAuthRequiredError","message":"Access token not provided. Supply an access token by running `supabase login` or setting the SUPABASE_ACCESS_TOKEN environment variable."}}';

beforeEach(() => {
  state.calls = [];
  state.spawns = [];
  state.spawnFails = false;
  state.queue = [];
  state.reply = { ok: true, out: "" };
  state.errStream = "stdout";
});

describe("listSupabaseProjects —— 失败也要给出一句能照做的话", () => {
  it("正常返回时解出 ref / 名字 / 区域", async () => {
    reply(
      JSON.stringify([
        { id: "abcdefghijklmnopqrst", name: "my-app", region: "us-east-1", status: "ACTIVE_HEALTHY" },
      ]),
    );

    const res = await listSupabaseProjects();

    expect(res).toEqual({ ok: true, projects: [PROJECT] });
    expect(state.calls[0]).toEqual([
      "npx",
      "--yes",
      "supabase",
      "projects",
      "list",
      "--output-format",
      "json",
    ]);
  });

  it("CLI 自己在 JSON 前打了提示行时照样能解析", async () => {
    // 真机上见过 CLI 往 stdout 混东西；从第一个 `[` 起解析比「假定输出干净」稳
    reply(
      `WARNING: something\n[{"id":"abcdefghijklmnopqrst","name":"my-app","region":"us-east-1","status":"ACTIVE_HEALTHY"}]`,
    );

    expect((await listSupabaseProjects()).ok).toBe(true);
  });

  it("真机的形状：外层是对象 {projects:[…]}，不是裸数组", async () => {
    // 这一条是实测回来的。supabase CLI 2.x 的 `projects list --output-format json`
    // 回的是外层对象；只认数组的话，向导里「Supabase 项目」这条路**每次**都掉回手填，
    // 还会甩一句被误读成「CLI 坏了」的话。两种形状都得收。
    reply(
      JSON.stringify({
        projects: [
          {
            id: "abcdefghijklmnopqrst",
            ref: "abcdefghijklmnopqrst",
            organization_id: "leaskitbsfzqilvmymky",
            name: "my-app",
            region: "us-east-1",
            status: "ACTIVE_HEALTHY",
          },
        ],
        message: "",
      }),
    );

    expect(await listSupabaseProjects()).toEqual({ ok: true, projects: [PROJECT] });
  });

  it("外层对象还带着提示行（真机的完整形态）也能解析", async () => {
    // 实机 stdout 里混的是一句 `Cannot find project ref…`——切片的两种开口都得试
    reply(
      'Cannot find project ref. Have you run supabase link?\n' +
        JSON.stringify({
          projects: [
            {
              id: "abcdefghijklmnopqrst",
              name: "my-app",
              region: "us-east-1",
              status: "ACTIVE_HEALTHY",
            },
          ],
          message: "",
        }),
    );

    expect(await listSupabaseProjects()).toEqual({ ok: true, projects: [PROJECT] });
  });

  it("没登录（真机形状：原因在 stdout、stderr 空）→ 让人去跑 npx supabase login", async () => {
    // **这条是回归线**。早先 runCli 的 catch 只读 `e.stderr`，真机 stdout 里的原因整条丢掉，
    // 提示退化成 `跑 npx supabase projects list 失败：Command failed: npx --yes …` ——
    // 既看不出是没登录，也看不出下一步该干嘛。
    fail(LOGGED_OUT);

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx supabase login/);
  });

  it("「没登录」必须点明是 Supabase 账号，不是数据库凭据", async () => {
    // 用户分不清这两件事是向导最贵的一个坑：跑去翻数据库密码，那里根本没有解。
    fail(LOGGED_OUT);

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/Supabase 账号/);
      expect(res.reason).toMatch(/不是数据库凭据/);
    }
  });

  it("原因只落在 stderr 时也能拿到（不假定 CLI 永远用 stdout）", async () => {
    state.errStream = "stderr";
    fail("Access token not provided. Run supabase login.");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx supabase login/);
  });

  it("拉不起 CLI 与「没登录」是两回事 —— 别让人白登一次", async () => {
    // 网络/registry 问题去登录一次毫无用处，所以这一句里不能出现 login 的指引
    fail("npm ERR! network request to https://registry.npmjs.org/supabase failed");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/与登录无关/);
      expect(res.reason).not.toMatch(/npx supabase login/);
      // 这里**只出诊断、不出下一步**：同一失败在向导阶段和装机中途该给的下一步不一样
      // （向导该说「改手填」、中途该说「跳过不影响网关」），写死在这层必然有一处过期。
      expect(res.reason).not.toMatch(/回向导/);
      // CLI 自己的原话要带上，否则用户没法定夺
      expect(res.reason).toMatch(/registry\.npmjs\.org/);
    }
  });

  it("其它失败 → 带上原错误的第一行，别吞掉", async () => {
    state.errStream = "stderr";
    fail("getaddrinfo ENOTFOUND api.supabase.com\n长堆栈…");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ENOTFOUND api\.supabase\.com/);
  });

  it("CLI 连一个流的没给（超时 / 被 kill）→ 落到 Command failed 那行，不能空着", async () => {
    fail("");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx/);
  });

  it("输出里没有 JSON / 有 JSON 但没有项目数组 → 各自给一句人话", async () => {
    reply("nothing here");
    const noJson = await listSupabaseProjects();
    expect(noJson.ok).toBe(false);

    reply('{"error":"whatever"}');
    const notArray = await listSupabaseProjects();
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.reason).toMatch(/不是数组/);
  });

  it("没有 id 的条目直接丢掉，不产生半个项目对象", async () => {
    reply(JSON.stringify([{ name: "no-id" }, { id: "abcdefghijklmnopqrst", name: "ok" }]));

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.projects).toHaveLength(1);
      // 没有 name / region 时也要有可用的占位，后续拼提示词不会出 undefined
      expect(res.projects[0]).toEqual({
        ref: "abcdefghijklmnopqrst",
        name: "ok",
        region: "",
        status: "",
      });
    }
  });
});

describe("isPaused：暂停的项目连不上，而报错跟「密码错」一模一样", () => {
  it("真机上见过的值：ACTIVE_HEALTHY 是活的，INACTIVE 是暂停的", () => {
    // 这三个值来自本机真实输出（一个账号三个项目，两个 INACTIVE）
    expect(isPaused("ACTIVE_HEALTHY")).toBe(false);
    expect(isPaused("INACTIVE")).toBe(true);
    expect(isPaused("PAUSED")).toBe(true);
  });

  it("用正面匹配，不做「不含 ACTIVE 就算暂停」的反推", () => {
    // 状态集合是 CLI 定的、会加新的；反推的话一个没见过的值就会被误判成暂停
    expect(isPaused("")).toBe(false);
    expect(isPaused("COMING_UP")).toBe(false);
  });
});

describe("checkSupabaseConnectionString —— 用户贴错串时唯一的防线", () => {
  it("对的串：零问题（正对照，否则「全拒」也能让下面全绿）", () => {
    expect(checkSupabaseConnectionString(GOOD, PROJECT)).toEqual([]);
  });

  it("用户名漏了 ref —— 这是最坑的一个，报错长得像密码错", () => {
    const bad = GOOD.replace(`postgres.${PROJECT.ref}:pw`, "postgres:pw");

    const problems = checkSupabaseConnectionString(bad, PROJECT);

    expect(problems.join("；")).toMatch(/no tenant identifier/);
    expect(problems.join("；")).toMatch(new RegExp(`postgres\\.${PROJECT.ref}`));
  });

  it("用户名里的 ref 是别的项目（复制串时串台了）", () => {
    const bad = GOOD.replace(`postgres.${PROJECT.ref}`, "postgres.zzzzzzzzzzzzzzzzzzzz");

    expect(checkSupabaseConnectionString(bad, PROJECT).join("；")).toMatch(/ref 不是这个项目/);
  });

  it("直连域名 db.<ref>.supabase.co —— 纯 IPv4 网络解析不到", () => {
    const bad = `postgres://postgres.${PROJECT.ref}:pw@db.${PROJECT.ref}.supabase.co:5432/postgres`;

    const problems = checkSupabaseConnectionString(bad, PROJECT).join("；");

    expect(problems).toMatch(/直连域名/);
    expect(problems).toMatch(/pooler\.supabase\.com/);
  });

  it("区域对不上（照着别的区域的模板抄的）", () => {
    const bad = GOOD.replace("aws-0-us-east-1", "aws-0-ap-southeast-1");

    expect(checkSupabaseConnectionString(bad, PROJECT).join("；")).toMatch(/区域对不上/);
  });

  it("端口写成 5432 —— 两条串用反了，DDL 会在事务池上失败", () => {
    const bad = GOOD.replace(":6543", ":5432");

    expect(checkSupabaseConnectionString(bad, PROJECT).join("；")).toMatch(/6543/);
  });

  it("不是 Supabase 的主机 / 不是合法 URL", () => {
    expect(
      checkSupabaseConnectionString("postgres://u:p@my-vps.example.com:5432/x", PROJECT).join("；"),
    ).toMatch(/不像 Supabase 池化地址/);
    expect(checkSupabaseConnectionString("随便一句话", PROJECT)).toEqual(["这不是一个合法的连接串"]);
  });

  it("区域未知的项目不做区域判定（不产生假阳性）", () => {
    // CLI 没给 region 时（旧版本），不该因此判用户贴的串是错的
    const noRegion = { ...PROJECT, region: "" };
    expect(checkSupabaseConnectionString(GOOD, noRegion)).toEqual([]);
  });
});

describe("登录：只在「真没登录」时弹窗，弹不出来就给一条能照做的命令", () => {
  it("已经登录 → 一次 CLI 就够了，绝不弹窗", async () => {
    reply('{"projects":[]}');
    const open = vi.fn(async () => true);

    const res = await loginSupabase({ open, pollMs: 1 });

    expect(res).toEqual({ ok: true });
    expect(open).not.toHaveBeenCalled();
    expect(state.calls).toHaveLength(1);
  });

  it("动手前先预告「可能在下载 CLI」—— 静默等几十秒和卡死没区别", async () => {
    // 本机没装过 supabase 时，`npx --yes supabase` 会现去 registry 下一份。
    // 这一句必须在**第一次探测之前**发出来：事后再解释等于让人白等一场。
    reply('{"projects":[]}');
    const notes: string[] = [];
    let callsWhenNoted = -1;

    await loginSupabase({
      open: async () => true,
      pollMs: 1,
      note: (m) => {
        notes.push(m);
        if (callsWhenNoted < 0) callsWhenNoted = state.calls.length;
      },
    });

    expect(notes.join("\n")).toMatch(/下载|装过/);
    expect(callsWhenNoted).toBe(0); // 说这句话的时候，CLI 一次都还没跑
  });

  it("没登录 → 弹一次终端，然后轮询到登好为止", async () => {
    // 第一次是探测登录态（没登），之后轮询前几次仍算没登（用户还在浏览器里），最后一次才算好
    then(
      { ok: false, out: LOGGED_OUT },
      { ok: false, out: "not logged in" },
      { ok: false, out: "not logged in" },
      { ok: true, out: '{"projects":[]}' },
    );
    const open = vi.fn(async (_cmd: string) => true);
    const notes: string[] = [];

    const res = await loginSupabase({ open, pollMs: 1, timeoutMs: 5_000, note: (m) => notes.push(m) });

    expect(res).toEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe("npx --yes supabase login");
    // 弹窗之后必须**明确告诉用户该他操作了**，否则界面看着就是卡住了
    expect(notes.join("\n")).toMatch(/完成登录/);
  });

  it("网络错的不能被说成「没登录」—— 那会让人白登一次", async () => {
    fail("getaddrinfo ENOTFOUND api.supabase.com");
    const open = vi.fn(async () => true);

    const res = await loginSupabase({ open, pollMs: 1 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ENOTFOUND/);
    expect(open).not.toHaveBeenCalled();
  });

  it("弹不出终端 → 把命令原文给出去，别留用户干等", async () => {
    fail("Access token not provided. Run supabase login.");
    const open = vi.fn(async () => false);

    const res = await loginSupabase({ open, pollMs: 1 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx --yes supabase login/);
    // 一次都没弹出来就不该继续轮询（那是 5 分钟的假等待）
    expect(state.calls).toHaveLength(1);
  });

  it("等超时 → 说清楚是等超时，不是「登录失败」", async () => {
    fail("Access token not provided. Run supabase login.");

    const res = await loginSupabase({ open: async () => true, pollMs: 1, timeoutMs: 5 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/还没检测到登录完成/);
  });
});

describe("terminalCommand：三个平台各自怎么开一个新窗口", () => {
  it("Windows 用 start 开一个新 cmd —— 标题位必须给空串", () => {
    const spec = terminalCommand("npx --yes supabase login", "win32", {});

    expect(spec?.shell).toBe(true);
    // start 的第一个参数吃窗口标题；不给空串的话它会把命令名当标题，命令本身就不执行了
    expect(spec?.file).toContain('start ""');
    // 用 /k 不是 /c：命令报错时窗口留着，用户能看见那行错
    expect(spec?.file).toContain("cmd /k");
    expect(spec?.file).toContain("npx --yes supabase login");
  });

  it("macOS 走 osascript 开 Terminal，并且要 activate 到前台", () => {
    const spec = terminalCommand("npx --yes supabase login", "darwin", {});

    expect(spec?.file).toBe("osascript");
    expect(spec?.args.join(" ")).toContain("Terminal");
    expect(spec?.args.join(" ")).toContain("activate");
  });

  it("Linux 认 $TERMINAL；认不出来时返回 null 让调用方退回本进程", () => {
    const withTerm = terminalCommand("npx --yes supabase login", "linux", { TERMINAL: "alacritty" });
    expect(withTerm?.file).toBe("alacritty");
    expect(withTerm?.args).toEqual(["-e", "sh", "-c", "npx --yes supabase login"]);

    // 返回 null 而不是编一个不存在的终端：调用方要知道「弹不出来」才能兜底
    expect(terminalCommand("npx --yes supabase login", "linux", {})).toBeNull();
  });
});

describe("openInTerminal：spawn 的失败是异步事件，不能变成未捕获异常", () => {
  it("窗口起来了 → true", async () => {
    expect(await openInTerminal("npx --yes supabase login")).toBe(true);
    expect(state.spawns).toHaveLength(1);
  });

  it("没有这个可执行文件（ENOENT）→ false，而不是崩掉整个 CLI", async () => {
    state.spawnFails = true;

    expect(await openInTerminal("npx --yes supabase login")).toBe(false);
  });
});

describe("safeArg：用户输入进 shell 前的白名单", () => {
  it("正常的项目名 / 组织 id 原样通过", () => {
    expect(safeArg("my-app-2", "name")).toBe("my-app-2");
    expect(safeArg("leaskitbsfzqilvmymky", "id")).toBe("leaskitbsfzqilvmymky");
  });

  it("带 shell 元字符的一律拒掉", () => {
    // Windows 上 npx 是 npx.cmd，runCli 必须 shell:true，参数会被 cmd.exe 再解析一次。
    // 这类值过不去，才不会变成一条真命令。
    for (const bad of ["a & del x", "a | whoami", "a\nrm -rf /", "$(id)", "a;b", "a b"]) {
      expect(() => safeArg(bad, "name")).toThrow();
    }
  });

  it("组织 id 允许 `.` 与 `_`（CLI 自己的形状），但仍不许空格与分号", () => {
    expect(safeArg("org_1.2-3", "id")).toBe("org_1.2-3");
    expect(() => safeArg("org 1", "id")).toThrow();
  });
});

describe("listOrganizations：两种形状都收（同一类子命令踩过一次）", () => {
  it("外层对象 {organizations:[…]}", async () => {
    reply(JSON.stringify({ organizations: [{ id: "org1", name: "My Org" }] }));

    const res = await listOrganizations();

    expect(res).toEqual({ ok: true, orgs: [{ id: "org1", name: "My Org" }] });
    expect(state.calls[0]).toEqual([
      "npx",
      "--yes",
      "supabase",
      "orgs",
      "list",
      "--output-format",
      "json",
    ]);
  });

  it("裸数组", async () => {
    reply(JSON.stringify([{ id: "org1", name: "My Org" }]));

    expect(await listOrganizations()).toEqual({ ok: true, orgs: [{ id: "org1", name: "My Org" }] });
  });

  it("没登录 → 同一句「去跑 supabase login」", async () => {
    fail("Access token not provided. Run supabase login.");

    const res = await listOrganizations();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx supabase login/);
  });

  it("没回 JSON / 没名字 → 各自给一句人话，缺名字用 id 顶上", async () => {
    reply("nope");
    expect((await listOrganizations()).ok).toBe(false);

    reply(JSON.stringify([{ id: "org1" }]));
    expect(await listOrganizations()).toEqual({ ok: true, orgs: [{ id: "org1", name: "org1" }] });
  });
});

describe("createProject：建项目是对外动作，命令形状必须一字不差", () => {
  it("完整命令里该有的都在（区域、组织、输出 JSON）", async () => {
    reply('{"id":"abcdefghijklmnopqrst"}');

    const res = await createProject({
      name: "my-app",
      orgId: "org1",
      dbPassword: "abcdef0123456789",
      region: "ap-northeast-1",
    });

    expect(res).toEqual({ ok: true, ref: "abcdefghijklmnopqrst" });
    expect(state.calls[0]).toEqual([
      "npx",
      "--yes",
      "supabase",
      "projects",
      "create",
      "my-app",
      "--org-id",
      "org1",
      "--db-password",
      "abcdef0123456789",
      "--region",
      "ap-northeast-1",
      "--output-format",
      "json",
    ]);
  });

  it("旧版 CLI 不回 JSON 时 ref 是 null（不编一个假的出来）", async () => {
    reply("Created project my-app");

    expect(await createProject({ name: "my-app", orgId: "org1", dbPassword: "abcdef0123456789", region: "us-east-1" })).toEqual(
      { ok: true, ref: null },
    );
  });

  it("密码不是纯字母数字 → 当场抛内部错误，绝不带着它去过 shell", async () => {
    await expect(
      createProject({ name: "x", orgId: "o", dbPassword: "pw'; rm -rf /", region: "us-east-1" }),
    ).rejects.toThrow(/纯字母数字/);
  });
});

describe("waitForProject：手里有 ref 就必须按 ref 认", () => {
  it("同名项目已存在时，按名字等会命中旧的那个 —— 按 ref 等才不会", async () => {
    // 这正是「新建之后连的还是老项目」那个坑：create 已经给了 ref，就不能按名字找，
    // 否则清单里那个同名的旧项目会立刻命中，向导拿着过期 ref 去连，报一句「连不上」。
    reply(JSON.stringify({ projects: [{ id: "OLDrefoldrefoldrefol", name: "my-app", region: "us-east-1" }] }));

    const res = await waitForProject({ ref: "NEWrefnewrefnewrefne" }, { pollMs: 1, timeoutMs: 10 });

    expect(res.ok).toBe(false);
  });

  it("ref 出现了 → 连区域一起带回来（以清单为准，不是我们建时给的枚举）", async () => {
    then(
      { ok: true, out: '{"projects":[]}' },
      {
        ok: true,
        out: JSON.stringify({
          projects: [
            {
              id: "n1",
              name: "my-app",
              region: "ap-northeast-1",
              status: "ACTIVE_HEALTHY",
            },
          ],
        }),
      },
    );

    const res = await waitForProject({ ref: "n1" }, { pollMs: 1, timeoutMs: 5_000 });

    expect(res).toEqual({
      ok: true,
      project: {
        ref: "n1",
        name: "my-app",
        region: "ap-northeast-1",
        status: "ACTIVE_HEALTHY",
      },
    });
  });

  it("只有名字时按名字等", async () => {
    // CLI 回的是 `id`（映射成 ref），这里得照真形状给，不能拿 PROJECT 直接塞
    reply(JSON.stringify({ projects: [{ id: PROJECT.ref, name: PROJECT.name, region: PROJECT.region }] }));

    expect((await waitForProject({ name: PROJECT.name }, { pollMs: 1 })).ok).toBe(true);
  });

  it("什么都没给 → 直接报错，不做 5 分钟的无谓轮询", async () => {
    const res = await waitForProject({});

    expect(res.ok).toBe(false);
    expect(state.calls).toHaveLength(0);
  });
});

describe("getServiceRoleKey：拿真 key 必须 --reveal", () => {
  it("命令带 --reveal（不带的话拿到的是掩码，要等真发请求才报错）", async () => {
    reply(JSON.stringify([{ name: "service_role", api_key: "sb_secret_abc" }]));

    const res = await getServiceRoleKey("abcdefghijklmnopqrst");

    expect(res).toEqual({ ok: true, key: "sb_secret_abc" });
    expect(state.calls[0]).toContain("--reveal");
  });

  it("新老两种命名都认：sb_secret_ 前缀 / name === service_role", async () => {
    reply(
      JSON.stringify([
        { name: "anon", api_key: "sb_publishable_x" },
        { name: "service_role", api_key: "the-old-jwt" },
      ]),
    );
    expect(await getServiceRoleKey("abcdefghijklmnopqrst")).toEqual({ ok: true, key: "the-old-jwt" });

    reply(JSON.stringify([{ name: "whatever", api_key: "sb_secret_new" }]));
    expect(await getServiceRoleKey("abcdefghijklmnopqrst")).toEqual({ ok: true, key: "sb_secret_new" });
  });

  it("一个都不是 → 明确说没有，不返回半个 key", async () => {
    reply(JSON.stringify([{ name: "anon", api_key: "sb_publishable_x" }]));

    const res = await getServiceRoleKey("abcdefghijklmnopqrst");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/service_role/);
  });
});

describe("projectUrl：Auth Admin API 的前缀由 ref 直推", () => {
  it("https://<ref>.supabase.co", () => {
    expect(projectUrl("abcdefghijklmnopqrst")).toBe("https://abcdefghijklmnopqrst.supabase.co");
  });

  it("ref 里混进非法字符 → 当场抛，别拼出一个奇怪的 host", () => {
    expect(() => projectUrl("abc/../evil")).toThrow();
  });
});
