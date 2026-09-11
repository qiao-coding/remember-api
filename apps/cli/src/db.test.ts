/**
 * `db.ts` 的纯函数部分 —— 这些是「托管库 vs 本机库」分流的判据，
 * 判错的后果不是报错而是**静默改坏别人的库**（见 ensureAuthStub 的注释），
 * 所以按真实连接串的形状逐条钉住。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DB_PLAN,
  dbNameOf,
  ensureDatabase,
  isHostedPostgres,
  isOwnAuthStub,
  migrationsFolder,
  planToAdminUrl,
  planToUrl,
  probe,
  resolveMigrateUrl,
  toAdminUrl,
} from "./db.js";

describe("连接串拼装", () => {
  it("planToUrl 指向 127.0.0.1，密码做 URL 编码", () => {
    expect(planToUrl(DEFAULT_DB_PLAN)).toBe("postgres://postgres:postgres@127.0.0.1:5432/remember_api");
    expect(planToUrl({ ...DEFAULT_DB_PLAN, password: "p@ss w/ord" })).toBe(
      "postgres://postgres:p%40ss%20w%2Ford@127.0.0.1:5432/remember_api",
    );
  });

  it("planToAdminUrl 换到维护库 postgres", () => {
    expect(planToAdminUrl(DEFAULT_DB_PLAN)).toContain("/postgres");
  });

  it("toAdminUrl 只换库名，主机/端口/查询参数都保留", () => {
    const out = toAdminUrl("postgres://u:p@db.example.com:6543/remember_api?sslmode=require");
    expect(out).toContain("db.example.com:6543");
    expect(out).toContain("sslmode=require");
    expect(new URL(out).pathname).toBe("/postgres");
  });

  it("dbNameOf 取出库名；没有库名时报错而不是返回空串", () => {
    expect(dbNameOf("postgres://u:p@h:5432/remember_api")).toBe("remember_api");
    expect(() => dbNameOf("postgres://u:p@h:5432")).toThrow(/没有库名/);
  });
});

describe("isHostedPostgres —— 决定走「建库」还是「只迁移」", () => {
  it.each([
    "postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require",
    "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    "postgres://postgres.abcdefghijklmnopqrst:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres",
    "db.abcdefghijklmnopqrst.supabase.co",
  ])("托管：%s", (url) => {
    expect(isHostedPostgres(url)).toBe(true);
  });

  it.each([
    // 自己的 VPS / 局域网 / 本地都要走完整流程：建库 + 补 auth 桩
    "postgres://postgres:pw@127.0.0.1:5432/remember_api",
    "postgres://postgres:pw@localhost:5432/remember_api",
    "postgres://postgres:pw@192.168.1.50:5432/remember_api",
    "postgres://postgres:pw@db.my-own-server.com:5432/remember_api",
    // 像是 supabase 但其实不是：后缀必须带点，别把 evil-supabase.co 也放过去
    "postgres://postgres:pw@notsupabase.co:5432/x",
    "postgres://postgres:pw@supabase.co.evil.com:5432/x",
    "",
    "不是个连接串",
  ])("不是托管：%s", (url) => {
    expect(isHostedPostgres(url)).toBe(false);
  });

  it("带端口与路径的裸主机名也能识别", () => {
    expect(isHostedPostgres("db.x.supabase.co:5432/postgres")).toBe(true);
  });
});

describe("resolveMigrateUrl —— Supabase 上「运行时串」与「迁移串」是两条", () => {
  // 判错的后果是静默的：迁移跑在事务池上，DDL 失败被当成「连不上」，
  // 而文档专门用 Callout 警告过「两条串不能混用」。所以这里逐条钉住。
  const TX = "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com";

  it("事务池 6543 → 同 host 的 session 池 5432，并去掉 pgbouncer", () => {
    const out = resolveMigrateUrl(`${TX}:6543/postgres?pgbouncer=true&sslmode=require`);
    const parsed = new URL(out ?? "");

    expect(parsed.hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
    expect(parsed.port).toBe("5432");
    // 区域不用猜：只换端口，主机名一个字不动
    expect(parsed.username).toBe("postgres.abcdefghijklmnopqrst");
    // pgbouncer=true 是给运行时的驱动看的；留在迁移串上会误导人以为这条也走事务池
    expect(parsed.searchParams.get("pgbouncer")).toBeNull();
    // sslmode 丢了就是连不上（client.ts 靠它决定要不要 TLS）
    expect(parsed.searchParams.get("sslmode")).toBe("require");
  });

  it("session 池 5432 → 仍是一条可用的迁移串，sslmode 保留", () => {
    const out = resolveMigrateUrl(`${TX}:5432/postgres?sslmode=require`);

    expect(out).toContain(":5432/");
    expect(out).toContain("sslmode=require");
  });

  it("池化地址的用户名必须带项目 ref —— 裸 postgres 连不上（实测）", () => {
    // Supavisor 靠用户名里的 `<ref>` 路由租户。裸 postgres 的报错是
    // `(ENOIDENTIFIER) no tenant identifier provided`，与「密码错」完全不像，
    // 用户会以为是密码或区域的问题。这条把那种排查循环掐在报错信息里。
    const call = () =>
      resolveMigrateUrl("postgres://postgres:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres");

    expect(call).toThrow(/必须带项目 ref/);
    expect(call).toThrow(/no tenant identifier/);
    expect(call).toThrow(/postgres\.<ref>/);
  });

  it("带 ref 的用户名放行（正对照，否则上面那条「一律拒绝」也会绿）", () => {
    expect(resolveMigrateUrl(`${TX}:6543/postgres?sslmode=require`)).toContain(
      "postgres.abcdefghijklmnopqrst",
    );
  });

  it("直连域名 → 抛错，并给出 pooler 替代（不能静默接受）", () => {
    // 直连域名只有 IPv6，纯 IPv4 网络下 DNS 就解析不到。静默接受会让用户
    // 在「连不上」上白白浪费一轮——而且他刚在控制台抄下来的就是这条。
    const call = () =>
      resolveMigrateUrl("postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres");

    expect(call).toThrow(/没有 A 记录/);
    expect(call).toThrow(/pooler\.supabase\.com:5432/);
  });

  it("本机 / 自建 VPS → null（一条串够用，直连允许 DDL）", () => {
    expect(resolveMigrateUrl("postgres://postgres:pw@127.0.0.1:5432/remember_api")).toBeNull();
    expect(resolveMigrateUrl("postgres://postgres:pw@192.168.1.50:5432/remember_api")).toBeNull();
    expect(resolveMigrateUrl("postgres://postgres:pw@db.my-own-server.com:5432/remember_api")).toBeNull();
  });

  it("不是合法连接串 → null，不抢下游「连不上」的报错", () => {
    expect(resolveMigrateUrl("")).toBeNull();
    expect(resolveMigrateUrl("不是个连接串")).toBeNull();
  });

  it("像 supabase 但不是的域名不会被误判成 pooler", () => {
    // 后缀必须带点，否则 evil-pooler.supabase.com.attacker.io 也会被当成自家主机
    expect(resolveMigrateUrl("postgres://u:p@pooler.supabase.com.evil.io:6543/x")).toBeNull();
  });
});

describe("isOwnAuthStub —— 认得出哪个函数是我们建的", () => {
  it("我们自己的桩（含空白与大小写差异）", () => {
    expect(isOwnAuthStub("SELECT null::uuid")).toBe(true);
    expect(isOwnAuthStub(" select null::uuid ; ")).toBe(true);
    expect(isOwnAuthStub("\n  SELECT  NULL::uuid\n")).toBe(true);
  });

  it("Supabase 真的 auth.uid() 不是我们的 —— 必须判成 false，否则会被覆盖", () => {
    const real =
      "select coalesce(current_setting('request.jwt.claim.sub', true), " +
      "(current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid";
    expect(isOwnAuthStub(real)).toBe(false);
  });

  it("任何返回非 null 的实现都判 false", () => {
    expect(isOwnAuthStub("SELECT auth.uid()")).toBe(false);
    expect(isOwnAuthStub("SELECT '00000000-0000-0000-0000-000000000000'::uuid")).toBe(false);
  });
});

describe("migrationsFolder —— 迁移目录跟产物走，不跟 cwd 走", () => {
  // 安装后的布局是 <包根>/drizzle 与 <包根>/dist/cli.js 并排。用 cwd 拼会去当前
  // 工作目录找 drizzle/，用户在任意目录运行都找不到迁移，报的是「没有迁移文件」这类
  // 与真实原因（路径拼错）无关的错。
  it("解析成包根下的 drizzle/", () => {
    // 本文件在 <包根>/src/ 下，所以 ".." 就是包根
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    expect(migrationsFolder()).toBe(join(packageRoot, "drizzle"));
  });

  it("换 cwd 不影响结果", () => {
    const before = migrationsFolder();
    const prev = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "rmb-cwd-"));
    try {
      process.chdir(tmp);
      expect(migrationsFolder()).toBe(before);
    } finally {
      process.chdir(prev);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("ensureDatabase 的库名校验 —— 拦在拼 SQL 之前", () => {
  // 库名会被拼进 `CREATE DATABASE "<name>"`，所以这里放行什么就等于允许什么。
  // 校验必须发生在**连库之前**，否则一个坏库名会先建立一次连接、再报一个与库名无关的错。
  it.each(["bad-name", "with space", 'quote"', "semi;colon", "中文库", "dot.name", "", "a'b"])(
    "拒绝 %j",
    async (name) => {
      await expect(ensureDatabase("postgres://u:p@127.0.0.1:5432/postgres", name)).rejects.toThrow(
        /库名只允许字母、数字与下划线/,
      );
    },
  );

  it("合法库名不被这条规则拦下（正对照，否则「规则写死全拒」也会让上面全绿）", async () => {
    // 端口 1 上没有 Postgres，必然连不上；断言的是**错误不是库名规则**，
    // 证明校验放行了这个名字、流程确实往下走到了连库那一步。
    const err = (await ensureDatabase("postgres://u:p@127.0.0.1:1/postgres", "ok_name_1").catch(
      (e) => e as Error,
    )) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toMatch(/库名只允许/);
  });
});

describe("probe —— 没配连接串时不连库", () => {
  it("空串直接返回「未配置」，而不是抛错或去连一个空 URL", async () => {
    expect(await probe("")).toEqual({ ok: false, error: "未配置 DATABASE_URL" });
  });
});
