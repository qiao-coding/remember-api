/**
 * `prepareDatabase` 的**分流行为** —— 纯函数测试证明不了这个。
 *
 * 风险不是报错，是静默改坏别人的库：托管库上跑了 `CREATE DATABASE`（没权限，炸）
 * 或跑了 `CREATE OR REPLACE FUNCTION auth.uid()`（把人家真的函数换成返回 null 的桩，
 * 等于关掉那个项目所有表的 RLS）。所以这里把 `@remember/db` 整个换掉，
 * 只看**到底往服务器发了哪些语句**、以及**用的是哪条连接串**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  statements: [] as string[],
  /** 每次 createClient 收到的连接串（等就绪 / 建库 / 建桩都走它） */
  urls: [] as string[],
  /** runMigrations 收到的连接串 */
  migrations: [] as string[],
  /** 服务器上已有的 auth.uid() 的 prosrc；null = 不存在 */
  authStubSrc: null as string | null,
}));

vi.mock("@remember/db", () => {
  const makeClient = () => {
    const client = async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      state.statements.push(query);
      if (query.includes("pg_proc")) {
        return state.authStubSrc === null ? [] : [{ prosrc: state.authStubSrc }];
      }
      if (query.includes("pg_database")) return []; // 库里没有这个库
      return [{ ok: 1 }];
    };
    client.unsafe = async (query: string) => {
      state.statements.push(query);
      return [];
    };
    client.end = async () => {};
    return client;
  };
  return {
    createClient: (url: string) => {
      state.urls.push(url);
      return makeClient();
    },
    runMigrations: async (url: string) => {
      state.migrations.push(url);
    },
  };
});

const { prepareDatabase } = await import("./db.js");

const REAL_SUPABASE_UID =
  "select coalesce(current_setting('request.jwt.claim.sub', true), " +
  "(current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid";

const REF = "abcdefghijklmnopqrst";
/** 池化主机：运行时串是事务池 6543（DDL 在这条上必失败） */
const HOSTED = `postgres://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`;
/** 同一个项目的直连域名 —— 只有 IPv6，纯 IPv4 网络下 DNS 就解析不到 */
const DIRECT = `postgres://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
const LOCAL = "postgres://postgres:pw@127.0.0.1:5432/remember_api";

const matching = (re: RegExp) => state.statements.filter((s) => re.test(s));
const ports = (urls: string[]) => urls.map((u) => new URL(u).port);

beforeEach(() => {
  state.statements = [];
  state.urls = [];
  state.migrations = [];
  state.authStubSrc = null;
});

describe("托管库（Supabase）", () => {
  it("绝不 CREATE DATABASE —— 没那个权限，也不该在别人的实例里建库", async () => {
    state.authStubSrc = REAL_SUPABASE_UID;
    await prepareDatabase(HOSTED, () => {});
    expect(matching(/CREATE DATABASE/i)).toHaveLength(0);
  });

  it("绝不覆盖已有的 auth.uid() —— 这条就是那个安全 bug 的回归测试", async () => {
    state.authStubSrc = REAL_SUPABASE_UID;
    await prepareDatabase(HOSTED, () => {});
    expect(matching(/CREATE OR REPLACE FUNCTION/i)).toHaveLength(0);
  });

  it("但仍要跑迁移", async () => {
    state.authStubSrc = REAL_SUPABASE_UID;
    await prepareDatabase(HOSTED, () => {});
    expect(state.migrations).toHaveLength(1);
  });

  it("库里没有 auth.uid() 时补一个（建库仍然不做）", async () => {
    state.authStubSrc = null;
    await prepareDatabase(HOSTED, () => {});
    expect(matching(/CREATE OR REPLACE FUNCTION auth\.uid/i)).toHaveLength(1);
    expect(matching(/CREATE DATABASE/i)).toHaveLength(0);
  });

  it("迁移换到 session 池 5432 —— 事务池上跑 DDL 必失败", async () => {
    // 老代码写死 migrateUrl: null → migrate.ts 回退 DATABASE_URL（正是上面那条 6543）→
    // DDL 在 pgbouncer 下失败。这是那个缺陷的回归测试。
    state.authStubSrc = REAL_SUPABASE_UID;
    await prepareDatabase(HOSTED, () => {});

    expect(new URL(state.migrations[0] ?? "").port).toBe("5432");
    expect(new URL(state.migrations[0] ?? "").hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
  });

  it("全程一次都不连事务池 —— 建桩也是 DDL", async () => {
    state.authStubSrc = null;
    await prepareDatabase(HOSTED, () => {});

    expect(state.urls.length).toBeGreaterThan(0);
    expect(ports(state.urls)).not.toContain("6543");
  });

  it("--migrate-url 显式给出时原样用它", async () => {
    const explicit = `postgres://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    state.authStubSrc = REAL_SUPABASE_UID;

    await prepareDatabase(HOSTED, () => {}, { migrateUrl: explicit });

    expect(state.migrations[0]).toBe(explicit);
  });
});

describe("直连域名 —— 它在 IPv4 网络上解析不到，不能静默接受", () => {
  it("连库之前就报错，并给出 pooler 的替代写法", async () => {
    const call = () => prepareDatabase(DIRECT, () => {});

    await expect(call()).rejects.toThrow(/没有 A 记录/);
    await expect(call()).rejects.toThrow(/pooler\.supabase\.com:5432/);
    // 一条语句都没发出去：报错要发生在动作之前，否则用户会收到
    // 「连接失败」这种把真实原因（域名不可用）盖掉的报错
    expect(state.statements).toHaveLength(0);
    expect(state.urls).toHaveLength(0);
  });

  it("给了 --migrate-url 就放行 —— 有 IPv6 的网络确实能用直连", async () => {
    state.authStubSrc = REAL_SUPABASE_UID;

    await prepareDatabase(DIRECT, () => {}, { migrateUrl: DIRECT });

    expect(state.migrations).toEqual([DIRECT]);
  });
});

describe("本机库（行为必须与改动前一致）", () => {
  it("建库 + 补桩 + 迁移，一个不少", async () => {
    state.authStubSrc = null;
    await prepareDatabase(LOCAL, () => {});
    expect(matching(/CREATE DATABASE/i)).toHaveLength(1);
    expect(matching(/CREATE OR REPLACE FUNCTION auth\.uid/i)).toHaveLength(1);
    expect(state.migrations).toHaveLength(1);
  });

  it("已有别人的 auth.uid() 时也不覆盖（自建 Supabase / 别家托管同理）", async () => {
    state.authStubSrc = REAL_SUPABASE_UID;
    await prepareDatabase(LOCAL, () => {});
    expect(matching(/CREATE OR REPLACE FUNCTION/i)).toHaveLength(0);
    expect(matching(/CREATE DATABASE/i)).toHaveLength(1);
  });

  it("不产生第二条串：迁移用的就是那一条", async () => {
    await prepareDatabase(LOCAL, () => {});
    expect(state.migrations).toEqual([LOCAL]);
  });
});
