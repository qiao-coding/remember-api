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
  /** runCli 的返回值 */
  reply: { ok: true, out: "" } as { ok: boolean; out: string },
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: (Error & { stderr?: string }) | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    state.calls.push([file, ...args]);
    if (!state.reply.ok) {
      cb(Object.assign(new Error(state.reply.out), { stderr: state.reply.out }));
      return;
    }
    cb(null, { stdout: state.reply.out, stderr: "" });
  },
}));

const { listSupabaseProjects, checkSupabaseConnectionString } = await import("./supabase.js");

const PROJECT = { ref: "abcdefghijklmnopqrst", name: "my-app", region: "us-east-1" };
const GOOD = `postgres://postgres.${PROJECT.ref}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`;

function reply(out: string): void {
  state.reply = { ok: true, out };
}

function fail(out: string): void {
  state.reply = { ok: false, out };
}

beforeEach(() => {
  state.calls = [];
  state.reply = { ok: true, out: "" };
});

describe("listSupabaseProjects —— 失败也要给出一句能照做的话", () => {
  it("正常返回时解出 ref / 名字 / 区域", async () => {
    reply(JSON.stringify([{ id: "abcdefghijklmnopqrst", name: "my-app", region: "us-east-1" }]));

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
    reply(`WARNING: something\n[{"id":"abcdefghijklmnopqrst","name":"my-app","region":"us-east-1"}]`);

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
        JSON.stringify({ projects: [{ id: "abcdefghijklmnopqrst", name: "my-app", region: "us-east-1" }], message: "" }),
    );

    expect(await listSupabaseProjects()).toEqual({ ok: true, projects: [PROJECT] });
  });

  it("没登录 → 明确让人去跑 npx supabase login（不抛错）", async () => {
    fail("Access token not provided. Run supabase login.");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/npx supabase login/);
  });

  it("其它失败 → 带上原错误的第一行，别吞掉", async () => {
    fail("getaddrinfo ENOTFOUND api.supabase.com\n长堆栈…");

    const res = await listSupabaseProjects();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ENOTFOUND api\.supabase\.com/);
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
      expect(res.projects[0]).toEqual({ ref: "abcdefghijklmnopqrst", name: "ok", region: "" });
    }
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
