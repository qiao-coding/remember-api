/**
 * `remember-api init` 向导 —— 本仓**唯一**让用户跑起来的那条路。
 *
 * 为什么必须测：向导每一步都「成功」但整体是错的，是完全可能的，而且不报错。
 * 顺序写反（先写 provider_configs 再 seed 用户）在新库上必然外键失败；无人值守参数
 * 校验漏一条会走到一半才发现问不了人；`--yes` 下多问一句会让脚本永远挂住。
 *
 * ⚠️ 本文件**只测 `init.ts` 的外部行为**，它一行都不改（用户明确要求）。所以断言
 * 只能到「调用了谁、传了什么、什么顺序」这一层——函数内部的中间变量看不见。
 * 这是这条路的边界，不掩饰。真正的链路验证交给 `scripts/install-e2e.mjs`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** 全局有序调用记录：所有 mock 都往里推标签，用来断言顺序 */
  order: [] as string[],
  /** writeConfig 收到的配置快照（深拷贝） */
  written: [] as Record<string, never>[],
  /** readConfig 返回什么；null = 还没 init 过 */
  existing: null as Record<string, unknown> | null,
  /** dockerVersion 的返回值；null = daemon 没起 */
  docker: "29.7.2" as string | null,
  dockerCli: true,
  /** prepareDatabase / ensureContainer 收到的实参 */
  prepared: [] as string[],
  /** prepareDatabase 第 3 参里的 migrateUrl（没传就是 undefined） */
  migrateUrls: [] as (string | undefined)[],
  containers: [] as { port: number }[],
  /** chooseTarget / chooseKey 的实参与返回值 */
  targetHint: [] as unknown[],
  keyArgs: [] as { hasStored: boolean; opts: unknown }[],
  target: { provider: "deepseek", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com" },
  key: "sk-test" as string | null,
  /** @remember/db 侧 */
  storedCredential: null as { apiKeyEncrypted: string } | null,
  upserts: [] as Record<string, unknown>[],
  seeds: [] as Record<string, unknown>[],
  profilesChanged: 1,
  /** smoke 侧 */
  smoke: [{ name: "网关可启动", ok: true, detail: "ok" }],
  smokeThrows: false,
  generated: 0,
  logs: [] as string[],
  /** 每次 select 的入参（message + options）—— 用来断言「那一项到底有没有出现在选项里」 */
  selects: [] as { message: string; options: { value: string }[] }[],
  /** 依次消费的 select 返回值，用光后回落到 "reuse" */
  selectReplies: [] as string[],
}));

vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  const log = Object.assign(
    (msg: string) => state.logs.push(`message:${msg}`),
    {
      error: (m: string) => state.logs.push(`error:${m}`),
      warn: (m: string) => state.logs.push(`warn:${m}`),
      success: (m: string) => state.logs.push(`success:${m}`),
      info: (m: string) => state.logs.push(`info:${m}`),
      message: (m: string) => state.logs.push(`message:${m}`),
    },
  );
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    log,
    // printConnect 用它打印「三件套」；漏了这个 export，runInit 走到底就炸
    note: (body: string, title?: string) => state.logs.push(`note:${title}\n${body}`),
    spinner: () => ({
      start: (m: string) => state.logs.push(`spin.start:${m}`),
      message: (m: string) => state.logs.push(`spin.message:${m}`),
      stop: (m: string) => state.logs.push(`spin.stop:${m}`),
      error: (m: string) => state.logs.push(`spin.error:${m}`),
    }),
    // ./prompt.js 的 unwrap 靠它判定「用户按了 Ctrl-C」。必须是真货：
    // 真 isCancel 就是 `e === CANCEL_SYMBOL`，自造一个 Symbol 传进去永远 false，
    // 假谓词会让「取消被当成正常值继续往下走」这条分支变成永远绿。
    isCancel: actual.isCancel,
    // 交互三项都留成 vi.fn：无人值守模式必须**一次都不调用**它们
    select: vi.fn(async (opts: { message: string; options: { value: string }[] }) => {
      state.selects.push(opts);
      return state.selectReplies.shift() ?? "reuse";
    }),
    confirm: vi.fn(async () => true),
    text: vi.fn(async () => ""),
    password: vi.fn(async () => ""),
    autocomplete: vi.fn(async () => ""),
  };
});

vi.mock("./db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db.js")>();
  return {
    DEFAULT_DB_PLAN: {
      container: "remember-pg",
      image: "postgres:16",
      port: 5432,
      user: "postgres",
      password: "postgres",
      database: "remember_api",
    },
    dbNameOf: (url: string) => new URL(url).pathname.replace(/^\//, ""),
    planToUrl: (plan: { user: string; password: string; port: number; database: string }) =>
      `postgres://${plan.user}:${plan.password}@127.0.0.1:${plan.port}/${plan.database}`,
    dockerVersion: async () => state.docker,
    dockerCliInstalled: async () => state.dockerCli,
    ensureContainer: async (plan: { port: number; container: string }, log: (m: string) => void) => {
      state.order.push("ensureContainer");
      state.containers.push({ port: plan.port });
      log(`容器 ${plan.container} 已在运行，复用`);
      return { action: "reused" as const };
    },
    prepareDatabase: async (url: string, _log: unknown, opts?: { migrateUrl?: string }) => {
      state.order.push("prepareDatabase");
      state.prepared.push(url);
      state.migrateUrls.push(opts?.migrateUrl);
    },
    // 真货，不是手搓的副本：这条推导（事务池 6543 → session 池 5432）正是本轮修
    // 的那个缺陷，测试里再抄一份逻辑就等于允许它和实现各走各的。它和 docker 无关，
    // 拉进来不会碰真子进程/真连接。
    resolveMigrateUrl: actual.resolveMigrateUrl,
  };
});

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./config.js");
  return {
    ...actual,
    configPath: () => "/fake/home/config.json",
    readConfig: async () => state.existing,
    writeConfig: async (config: unknown) => {
      state.order.push("writeConfig");
      state.written.push(JSON.parse(JSON.stringify(config)));
    },
  };
});

vi.mock("./selection.js", () => ({
  chooseTarget: async (hint: unknown) => {
    state.order.push("chooseTarget");
    state.targetHint.push(hint);
    return state.target;
  },
  chooseKey: async (_provider: unknown, hasStored: boolean, opts: unknown) => {
    state.order.push("chooseKey");
    state.keyArgs.push({ hasStored, opts });
    return state.key;
  },
}));

vi.mock("./smoke.js", () => ({
  // 不落真实 process.env：本文件里没有网关要起
  applyEnv: () => {},
  reportSmoke: (checks: { ok: boolean }[]) => checks.every((c) => c.ok),
  runSmoke: async () => {
    state.order.push("runSmoke");
    if (state.smokeThrows) throw new Error("网关起不来");
    return state.smoke;
  },
}));

vi.mock("./catalog.js", () => ({
  getProvider: (id: string) =>
    id === "deepseek"
      ? { id: "deepseek", name: "DeepSeek", api: "https://api.deepseek.com" }
      : undefined,
}));

vi.mock("@remember/providers", () => ({ resolveBaseUrl: () => "https://api.deepseek.com" }));

vi.mock("@remember/shared", () => ({
  generateApiKey: () => {
    state.generated += 1;
    return "rma_generated";
  },
}));

vi.mock("@remember/db", () => ({
  findProviderConfig: async () => state.storedCredential,
  upsertProviderConfig: async (row: Record<string, unknown>) => {
    state.order.push("upsertProviderConfig");
    state.upserts.push(row);
  },
  seedUser: async (row: Record<string, unknown>) => {
    state.order.push("seedUser");
    state.seeds.push(row);
  },
  setProfilesTarget: async () => {
    state.order.push("setProfilesTarget");
    return state.profilesChanged;
  },
}));

import { confirm, select, text } from "@clack/prompts";
import { emptyConfig } from "./config.js";
import { runInit } from "./init.js";
import { NeedsInteractiveError } from "./prompt.js";

/** 一份完整的既有配置（走 importActual 拿真货，免得手搓出个不像的） */
function existingConfig(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(emptyConfig())) as Record<string, unknown>;
}

function writtenAt(index: number): Record<string, never> {
  const config = state.written[index];
  if (!config) throw new Error(`writeConfig 第 ${index} 次没发生（共写了 ${state.written.length} 次）`);
  return config;
}

const READY = { yes: true, provider: "deepseek", model: "deepseek-v4-flash", key: "sk-new" } as const;

// process.exitCode 是全局的，用完必须还回去，否则会污染同进程的其它测试文件
const originalExitCode = process.exitCode;
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalNodeVersion = process.versions.node;

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
}

beforeEach(() => {
  state.order = [];
  state.written = [];
  state.existing = null;
  state.docker = "29.7.2";
  state.dockerCli = true;
  state.prepared = [];
  state.migrateUrls = [];
  state.containers = [];
  state.targetHint = [];
  state.keyArgs = [];
  state.key = "sk-test";
  state.storedCredential = null;
  state.upserts = [];
  state.seeds = [];
  state.profilesChanged = 1;
  state.smoke = [{ name: "网关可启动", ok: true, detail: "ok" }];
  state.smokeThrows = false;
  state.generated = 0;
  state.logs = [];
  state.selects = [];
  state.selectReplies = [];
  process.exitCode = undefined;
  // 默认按「非 TTY」跑：本文件里所有用例都走 --yes，不该有任何交互
  setInteractive(false);
  vi.mocked(select).mockClear();
  vi.mocked(confirm).mockClear();
  vi.mocked(text).mockClear();
});

afterEach(() => {
  process.exitCode = originalExitCode;
  Object.defineProperty(process.versions, "node", {
    value: originalNodeVersion,
    configurable: true,
    writable: true,
  });
  if (originalTty) Object.defineProperty(process.stdin, "isTTY", originalTty);
  else delete (process.stdin as { isTTY?: unknown }).isTTY;
});

describe("无人值守参数校验 —— 别走到一半才发现问不了人", () => {
  it("三个参数全缺时一次把缺的都列出来", async () => {
    const err = (await runInit({ yes: true }).catch((e) => e as Error)) as Error;

    expect(err.message).toMatch(/无人值守模式还缺参数/);
    expect(err.message).toMatch(/--url/);
    expect(err.message).toMatch(/--provider/);
    expect(err.message).toMatch(/--model/);
    expect(err.message).toMatch(/完整写法/);
  });

  it("只缺 --model 时，缺参列表里只提 --model", async () => {
    const err = (await runInit({ ...READY, url: "postgres://u:p@h:5432/db", model: undefined }).catch(
      (e) => e as Error,
    )) as Error;

    // 只看「缺什么」那段。末尾那句「完整写法」是把所有参数都列一遍的模板，
    // 拿整条消息断言 not.toMatch(/--url/) 会永远失败。
    const gaps = err.message.split("完整写法：")[0] ?? "";
    expect(gaps).toMatch(/--model/);
    expect(gaps).not.toMatch(/--url/);
    expect(gaps).not.toMatch(/--provider/);
  });

  it("--url 与 --port 给任一个就算够（二选一）", async () => {
    await expect(
      runInit({ ...READY, url: "postgres://u:p@h:5432/db" }),
    ).resolves.toBeUndefined();
    await expect(runInit({ ...READY, port: 5544 })).resolves.toBeUndefined();
  });

  it("校验失败时什么都没建 —— 不碰数据库、不写配置", async () => {
    await runInit({ yes: true }).catch(() => {});

    expect(state.order).toEqual([]);
    expect(state.written).toHaveLength(0);
  });
});

describe("非交互终端且没给 --yes", () => {
  it("抛 NeedsInteractiveError，并给出非交互写法", async () => {
    const err = (await runInit({}).catch((e) => e as Error)) as Error;

    expect(err).toBeInstanceOf(NeedsInteractiveError);
    expect(err.message).toMatch(/需要交互式终端/);
    expect(err.message).toMatch(/--yes/);
  });

  it("此时一个 prompt 都没发、也没写配置", async () => {
    await runInit({}).catch(() => {});

    expect(select).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(state.written).toHaveLength(0);
  });
});

describe("Node 版本闸门", () => {
  it("版本太低时直接退出，绝不先写配置", async () => {
    Object.defineProperty(process.versions, "node", {
      value: "20.11.0",
      configurable: true,
      writable: true,
    });

    await runInit({ ...READY, url: "postgres://u:p@h:5432/db" });

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/需要 Node >= 22/);
    expect(state.written).toHaveLength(0);
    expect(state.order).not.toContain("prepareDatabase");
  });
});

describe("--url 路径（不走 docker）", () => {
  const URL = "postgres://u:p@127.0.0.1:5432/mydb";

  it("用给的连接串建库，完全不碰容器", async () => {
    await runInit({ ...READY, url: URL });

    expect(state.prepared).toEqual([URL]);
    expect(state.containers).toHaveLength(0);
    expect(state.order).not.toContain("ensureContainer");
  });

  it("落盘的 database.docker 是 null", async () => {
    await runInit({ ...READY, url: URL });

    expect(writtenAt(0).database).toEqual({ url: URL, migrateUrl: null, docker: null });
  });

  it("先落盘再选厂商 —— 库是「不能重来的」，选择是", async () => {
    await runInit({ ...READY, url: URL });

    const order = state.order;
    expect(order.indexOf("prepareDatabase")).toBeLessThan(order.indexOf("writeConfig"));
    expect(order.indexOf("writeConfig")).toBeLessThan(order.indexOf("chooseTarget"));
  });
});

describe("Supabase 池化串 —— 运行时走事务池，迁移走 session 池", () => {
  // 这是本轮修的那个缺陷：老代码在这条路上写死 `migrateUrl: null`，
  // 于是 migrate.ts 回退到 DATABASE_URL（正是事务池串）→ DDL 在 pgbouncer 下失败。
  const TX =
    "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";

  it("事务池串自动推出 session 池迁移串，运行时串保持不变", async () => {
    await runInit({ ...READY, url: TX });

    const db = writtenAt(0).database as unknown as { url: string; migrateUrl: string };
    expect(db.url).toBe(TX); // 网关仍连 6543
    expect(new URL(db.migrateUrl).port).toBe("5432"); // 迁移换到 5432
    expect(new URL(db.migrateUrl).hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
    // 而且这个值一路传到了 prepareDatabase —— 落盘了却没传给迁移那一步等于没修
    expect(state.migrateUrls[0]).toBe(db.migrateUrl);
  });

  it("--migrate-url 显式覆盖推导结果", async () => {
    const explicit = "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require";

    await runInit({ ...READY, url: TX, migrateUrl: explicit });

    expect((writtenAt(0).database as unknown as { migrateUrl: string }).migrateUrl).toBe(explicit);
  });

  it("直连域名在落盘前就报错，并说清为什么（不是等到迁移失败）", async () => {
    const err = (await runInit({
      ...READY,
      url: "postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    }).catch((e) => e as Error)) as Error;

    expect(err.message).toMatch(/没有 A 记录/);
    expect(err.message).toMatch(/pooler\.supabase\.com/);
    expect(state.written).toHaveLength(0);
    expect(state.order).not.toContain("prepareDatabase");
  });

  it("本机连接串不产生多余的迁移串（一条串够用）", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(state.migrateUrls[0]).toBeUndefined();
  });
});

describe("--port 路径（docker 起库）", () => {
  it("带着指定端口去 ensureContainer，连接串也反映该端口", async () => {
    await runInit({ ...READY, port: 5544 });

    expect(state.containers).toEqual([{ port: 5544 }]);
    expect(state.prepared[0]).toContain(":5544/");
    expect(writtenAt(0).database).toMatchObject({
      docker: { container: "remember-pg", port: 5544, managed: true },
    });
  });

  it("没有可用的 docker demon 时立刻报错，不静默退回手填", async () => {
    state.docker = null;

    const err = (await runInit({ ...READY, port: 5544 }).catch((e) => e as Error)) as Error;

    expect(err.message).toMatch(/没有可用的 docker daemon/);
    expect(err.message).toMatch(/--url/);
    expect(state.written).toHaveLength(0);
  });
});

describe("已有配置", () => {
  it("--yes 下原样复用：不重新生成 pepper / encryptionKey", async () => {
    const existing = existingConfig();
    state.existing = existing;

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    // pepper 变了 = 库里所有 Key 立刻 401；encryptionKey 变了 = 已存密文全解不开
    expect(writtenAt(0).secrets).toEqual(existing.secrets);
    expect(state.generated).toBeGreaterThan(0);
  });

  it("已生成过引导 Key 就不再生成第二把", async () => {
    state.existing = { ...existingConfig(), apiKey: { value: "rma_old", profileName: "remember-dev" } };

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(state.generated).toBe(0);
    expect(writtenAt(0).apiKey).toEqual({ value: "rma_old", profileName: "remember-dev" });
  });

  it("--url 能换连接串，但密钥仍旧保留", async () => {
    const existing = existingConfig();
    existing.database = { url: "postgres://old/db", migrateUrl: null, docker: null };
    state.existing = existing;

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/newdb" });

    expect(writtenAt(0).database).toMatchObject({ url: "postgres://u:p@127.0.0.1:5432/newdb" });
    expect(writtenAt(0).secrets).toEqual(existing.secrets);
  });

  it("没人选过厂商时把提示交给 chooseTarget（prefill 用上次的选择）", async () => {
    const existing = existingConfig();
    existing.selection = { provider: "deepseek", model: "old-model", baseUrl: null };
    state.existing = existing;

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(state.targetHint[0]).not.toBeNull();
  });
});

describe("写库顺序 —— 承重的那一条", () => {
  it("seedUser 必须早于 upsertProviderConfig（外键指向 users）", async () => {
    // 反了的话，全新库上 provider_configs.user_id 的外键必然失败 ——
    // 也就是每一次真正的新装都会挂。这条顺序不能靠注释守。
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    const seed = state.order.indexOf("seedUser");
    const upsert = state.order.indexOf("upsertProviderConfig");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(upsert).toBeGreaterThan(seed);
  });

  it("Profile 指向选中的厂商/模型，并写在最后", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    const target = state.order.indexOf("setProfilesTarget");
    expect(target).toBeGreaterThan(state.order.indexOf("upsertProviderConfig"));
    expect(writtenAt(state.written.length - 1).selection).toEqual(state.target);
  });
});

describe("凭据", () => {
  it("把 --key 交给 chooseKey，并原样写进 upsert", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(state.keyArgs[0]?.opts).toMatchObject({ provided: "sk-new", unattended: true });
    expect(state.upserts[0]).toMatchObject({
      provider: "deepseek",
      defaultModel: "deepseek-v4-flash",
      apiKey: "sk-test",
    });
  });

  it("没 Key 且库里也没有 → 报错点名 MockProvider，而不是安静地跑假回复", async () => {
    state.key = null;

    const err = (await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" }).catch(
      (e) => e as Error,
    )) as Error;

    expect(err.message).toMatch(/没有可用的 API Key/);
    expect(err.message).toMatch(/MockProvider/);
    // upsert 在判空之前就写了（init.ts:273 先写、:282 才报错），这里不重复要求它别写；
    // 要守的是「没把空 Key 当成真 Key 存进去」——否则重跑会以为已经有 Key 了。
    expect(state.upserts[0]).not.toHaveProperty("apiKey");
  });

  it("库里已有密文时，Key 为 null 也放行（保留旧 Key）", async () => {
    state.key = null;
    state.storedCredential = { apiKeyEncrypted: "v1:xxx" };

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(state.upserts[0]).not.toHaveProperty("apiKey");
    expect(state.keyArgs[0]?.hasStored).toBe(true);
  });
});

describe("自检", () => {
  it("--yes 下不询问、直接跑", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(confirm).not.toHaveBeenCalled();
    expect(state.order).toContain("runSmoke");
  });

  it("全绿时退出码保持干净", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(process.exitCode).toBeUndefined();
  });

  it("有红项时置退出码 1 —— 无人值守只能靠退出码说话", async () => {
    state.smoke = [{ name: "API Key 可用", ok: false, detail: "HTTP 401" }];

    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(process.exitCode).toBe(1);
  });

  it("自检自己抛错也置退出码 1，不让异常穿出去", async () => {
    state.smokeThrows = true;

    await expect(runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" })).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/自检失败：网关起不来/);
  });
});

describe("收尾输出", () => {
  it("打印三件套并给下一步命令", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    const logs = state.logs.join("\n");
    expect(logs).toMatch(/下一步：remember-api up/);
    expect(logs).toMatch(/interactive|message|success/);
  });
});

/** 数据库那一步给的选项值 */
function dbOptions(): string[] {
  const step = state.selects.find((s) => s.message === "数据库");
  return step ? step.options.map((o) => o.value) : [];
}

describe("数据库这一步的走向 —— 两个被修掉的 bug", () => {
  const OLD_URL = "postgres://u:p@127.0.0.1:5432/olddb";
  const NEW_URL = "postgres://u:p@127.0.0.1:5432/newdb";

  /** 带既有库、以交互方式跑一轮（省掉 --url，好让向导真的问数据库这一步） */
  function interactive(existingDatabase: string | null, replies: string[]): void {
    const config = existingConfig();
    state.existing = existingDatabase
      ? { ...config, database: { url: existingDatabase, migrateUrl: null, docker: null } }
      : null;
    state.selectReplies = replies;
    setInteractive(true);
  }

  it("选「沿用当前连接串」= 真的沿用：不重新问，也不把原串丢掉", async () => {
    // 修之前：`opts.url?.trim() ?? askCloudUrl()` —— 交互模式下 opts.url 永远是 undefined，
    // 于是「沿用」变成「重新问一遍」，用户随手一回车，原来那条串就没了。
    interactive(OLD_URL, ["reuse", "reuse"]);

    await runInit({ provider: "deepseek", model: "deepseek-v4-flash", key: "sk-new" });

    expect(state.prepared).toEqual([OLD_URL]);
    // 没问连接串。迁移串那句还会问一次（本机串推不出 5432 的对应关系），所以按内容断言
    const asked = vi.mocked(text).mock.calls.map((c) => String((c[0] as { message: string }).message));
    expect(asked.join("\n")).not.toMatch(/Postgres 连接串/);
    expect(asked.join("\n")).toMatch(/迁移连接串/);
  });

  it("有既有库时，「接一个 Supabase 项目」必须在选项里 —— 这是原始报障", async () => {
    // 用户原话：「这没有 supabase 的操作」。
    interactive(OLD_URL, ["reuse", "reuse"]);

    await runInit({ provider: "deepseek", model: "deepseek-v4-flash", key: "sk-new" });

    expect(dbOptions()).toContain("cloud");
  });

  it("没装 docker 时也要看得见 Supabase —— 没 docker 的人恰恰最需要它", async () => {
    // 修之前这条路直接跳到手填，云端入口在没装 docker 的机器上**根本不可见**
    state.docker = null;
    state.dockerCli = false;
    interactive(null, ["manual"]);
    vi.mocked(text)
      .mockResolvedValueOnce(NEW_URL) // 手填连接串
      .mockResolvedValueOnce(""); // 迁移串留空

    await runInit({ provider: "deepseek", model: "deepseek-v4-flash", key: "sk-new" });

    expect(dbOptions()).toContain("cloud");
    expect(state.prepared).toEqual([NEW_URL]);
  });

  it("--url 给全时不问数据库这一步（多问一句 = 无人值守挂住）", async () => {
    state.docker = null;
    state.dockerCli = false;
    setInteractive(true);

    await runInit({ ...READY, url: NEW_URL });

    expect(state.selects.map((s) => s.message)).not.toContain("数据库");
  });
});

describe("--host：以前解析了却没人读", () => {
  it("给了就写进 config.server.host，让 up 真的绑到那个地址", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb", host: "0.0.0.0" });

    expect(writtenAt(0).server).toMatchObject({ host: "0.0.0.0" });
  });

  it("没给就保持默认 127.0.0.1（不因为接线把它写没了）", async () => {
    await runInit({ ...READY, url: "postgres://u:p@127.0.0.1:5432/mydb" });

    expect(writtenAt(0).server).toMatchObject({ host: "127.0.0.1" });
  });
});
