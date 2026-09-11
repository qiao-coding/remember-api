/**
 * `up` / `model` / `key` / `connect` / `doctor` 的分支行为。
 *
 * 这些命令的共同点是**用退出码与 stderr 说话**（脚本与 agent 靠它判断成败），
 * 而它们的失败路径几乎都没被跑过。判错的后果：
 *   - `runUp` 的端口占用判定失灵 → 两个网关抢同一个端口，第二个静默失败
 *   - `runModelUse` 的用法校验失灵 → 切模型时写进一个没有端点的 provider
 *   - `requireConfig` 漏了退出码 → 脚本认为「没配置」是成功
 *
 * 端口占用这一条用**真 socket** 测（`node:net`），不 mock —— 这正是它容易出错的地方。
 */
import { type AddressInfo, createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  order: [] as string[],
  existing: null as Record<string, unknown> | null,
  written: [] as Record<string, never>[],
  /** probe / containerState / dockerVersion */
  probeResult: { ok: true } as { ok: boolean; error?: string },
  /** @remember/db 侧 */
  providerRow: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
  profiles: [] as { id: string; name: string; provider: string; model: string }[],
  apiKeys: [] as Record<string, unknown>[],
  createdKeys: [] as Record<string, unknown>[],
  profilesChanged: 1,
  /** smoke 侧 */
  smokeThrows: false,
  smoke: [{ name: "网关可启动", ok: true, detail: "ok" }],
  /** @remember/api/server */
  startServerCalls: 0,
  serverUrl: "http://127.0.0.1:4000",
  /** applyEnv 收到的 overrides */
  envOverrides: [] as Record<string, string>[],
  generated: 0,
  logs: [] as string[],
}));

vi.mock("@clack/prompts", () => {
  const log = Object.assign((m: string) => state.logs.push(`message:${m}`), {
    error: (m: string) => state.logs.push(`error:${m}`),
    warn: (m: string) => state.logs.push(`warn:${m}`),
    success: (m: string) => state.logs.push(`success:${m}`),
    info: (m: string) => state.logs.push(`info:${m}`),
    message: (m: string) => state.logs.push(`message:${m}`),
  });
  return {
    log,
    note: (body: string, title?: string) => state.logs.push(`note:${title}\n${body}`),
    spinner: () => ({
      start: () => {},
      message: () => {},
      stop: (m: string) => state.logs.push(`spin.stop:${m}`),
      error: (m: string) => state.logs.push(`spin.error:${m}`),
    }),
    select: vi.fn(async () => "reuse"),
    confirm: vi.fn(async () => true),
    text: vi.fn(async () => ""),
    password: vi.fn(async () => ""),
    autocomplete: vi.fn(async () => ""),
  };
});

vi.mock("./db.js", () => ({
  probe: async () => state.probeResult,
  dockerVersion: async () => "29.7.2",
  containerState: async () => "running",
}));

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
  chooseTarget: async () => {
    throw new Error("本文件走非交互分支，不该调用 chooseTarget");
  },
  chooseKey: async () => null,
}));

vi.mock("./smoke.js", () => ({
  applyEnv: (_config: unknown, overrides: Record<string, string> = {}) => {
    state.order.push("applyEnv");
    state.envOverrides.push(overrides);
  },
  reportSmoke: (checks: { ok: boolean }[]) => checks.every((c) => c.ok),
  runSmoke: async () => {
    state.order.push("runSmoke");
    if (state.smokeThrows) throw new Error("网关起不来");
    return state.smoke;
  },
}));

vi.mock("./catalog.js", () => ({
  getProvider: (id: string) =>
    id === "deepseek" ? { id, name: "DeepSeek", api: "https://api.deepseek.com" } : undefined,
}));

vi.mock("@remember/shared", () => ({
  generateApiKey: () => {
    state.generated += 1;
    return "rma_brand_new";
  },
}));

vi.mock("@remember/api/server", () => ({
  startServer: async () => {
    state.startServerCalls += 1;
    return { url: state.serverUrl };
  },
}));

vi.mock("@remember/db", () => ({
  findProviderConfig: async () => state.providerRow,
  upsertProviderConfig: async (row: Record<string, unknown>) => {
    state.order.push("upsertProviderConfig");
    state.upserts.push(row);
  },
  setProfilesTarget: async () => {
    state.order.push("setProfilesTarget");
    return state.profilesChanged;
  },
  listProfiles: async () => state.profiles,
  listProviderConfigs: async () => [],
  listApiKeys: async () => state.apiKeys,
  createApiKey: async (row: Record<string, unknown>) => {
    state.order.push("createApiKey");
    state.createdKeys.push(row);
  },
  getDb: () => ({ execute: async () => [{ migrated: true }] }),
}));

import { emptyConfig } from "./config.js";
import {
  portInUse,
  requireConfig,
  runConnect,
  runDoctor,
  runKey,
  runModelUse,
  runUp,
} from "./commands.js";
import { NeedsInteractiveError } from "./prompt.js";

function cfg(over: Record<string, unknown> = {}): Record<string, never> {
  return { ...(JSON.parse(JSON.stringify(emptyConfig())) as object), ...over } as Record<
    string,
    never
  >;
}

/** 真占一个端口，返回端口号与释放函数 */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const port = (srv.address() as AddressInfo).port;
  return {
    port,
    release: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

/** 借一个当前空闲的端口号（借完立刻还，只留号码） */
async function freePort(): Promise<number> {
  const { port, release } = await occupyPort();
  await release();
  return port;
}

const originalExitCode = process.exitCode;
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
}

beforeEach(() => {
  state.order = [];
  state.existing = null;
  state.written = [];
  state.probeResult = { ok: true };
  state.providerRow = null;
  state.upserts = [];
  state.profiles = [];
  state.apiKeys = [];
  state.createdKeys = [];
  state.profilesChanged = 1;
  state.smokeThrows = false;
  state.smoke = [{ name: "网关可启动", ok: true, detail: "ok" }];
  state.startServerCalls = 0;
  state.envOverrides = [];
  state.generated = 0;
  state.logs = [];
  process.exitCode = undefined;
  setInteractive(false);
});

afterEach(() => {
  process.exitCode = originalExitCode;
  if (originalTty) Object.defineProperty(process.stdin, "isTTY", originalTty);
  else delete (process.stdin as { isTTY?: unknown }).isTTY;
});

describe("portInUse —— 真 socket，不 mock", () => {
  it("没人占 → false", async () => {
    expect(await portInUse("127.0.0.1", await freePort())).toBe(false);
  });

  it("被占着 → true", async () => {
    const { port, release } = await occupyPort();
    try {
      expect(await portInUse("127.0.0.1", port)).toBe(true);
    } finally {
      await release();
    }
  });
});

describe("requireConfig", () => {
  it("没有配置 → 返回 null 并置退出码 1（脚本必须能看出来）", async () => {
    const config = await requireConfig();

    expect(config).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/还没有配置.*remember-api init/s);
  });

  it("有配置时原样返回，不动退出码", async () => {
    const existing = cfg({ database: { url: "postgres://x", migrateUrl: null, docker: null } });
    state.existing = existing;

    expect(await requireConfig()).toBe(existing);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runUp", () => {
  it("数据库连不上 → 退出码 1，且不启动网关", async () => {
    state.probeResult = { ok: false, error: "ECONNREFUSED 127.0.0.1:5432" };

    await runUp(cfg() as never);

    expect(process.exitCode).toBe(1);
    expect(state.startServerCalls).toBe(0);
    expect(state.logs.join("\n")).toMatch(/数据库连不上.*ECONNREFUSED/s);
  });

  it("端口被占 → 退出码 1，且不启动网关（两个实例抢端口会更难查）", async () => {
    const { port, release } = await occupyPort();
    try {
      await runUp(cfg() as never, { port });

      expect(process.exitCode).toBe(1);
      expect(state.startServerCalls).toBe(0);
      expect(state.logs.join("\n")).toMatch(new RegExp(`端口 ${port} 已被占用`));
    } finally {
      await release();
    }
  });

  it("正常启动：把端口/主机交给网关，并打印三件套", async () => {
    const port = await freePort();
    state.serverUrl = `http://127.0.0.1:${port}`;

    await runUp(cfg() as never, { port });

    expect(process.exitCode).toBeUndefined();
    expect(state.startServerCalls).toBe(1);
    // 端口是靠 applyEnv 传进子模块的（@remember/api/env.ts 读 process.env）。
    // 漏了这一步，网关会监听自己默认的 4000，而 CLI 打印的是另一个端口。
    expect(state.envOverrides[0]).toMatchObject({ PORT: String(port), HOST: "127.0.0.1" });

    const logs = state.logs.join("\n");
    expect(logs).toContain(`http://127.0.0.1:${port}/v1`);
    expect(logs).toMatch(/网关已就绪/);
  });

  it("--port 覆盖配置里的端口", async () => {
    const port = await freePort();

    await runUp(cfg() as never, { port });

    expect(state.envOverrides[0]).toMatchObject({ PORT: String(port) });
  });
});

describe("runModelUse", () => {
  it("不带参数且非交互 → NeedsInteractiveError，而不是卡住", async () => {
    await expect(runModelUse(cfg() as never)).rejects.toThrow(NeedsInteractiveError);
  });

  it("用法写错（缺斜杠）→ 退出码 1", async () => {
    await runModelUse(cfg() as never, "deepseek");

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/用法：remember-api model use/);
  });

  it("该厂商还没 Key → 退出码 1，指向 model add", async () => {
    state.providerRow = null;

    await runModelUse(cfg() as never, "deepseek/deepseek-v4-flash");

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/还没有 Key/);
    expect(state.upserts).toHaveLength(0);
  });

  it("端点查不到（目录没有 + 库里没记）→ 退出码 1，不写一个没有端点的 provider", async () => {
    state.providerRow = { provider: "mystery", apiKeyEncrypted: "v1:x", baseUrl: null };

    await runModelUse(cfg() as never, "mystery/some-model");

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/没有已知端点/);
    expect(state.upserts).toHaveLength(0);
    expect(state.written).toHaveLength(0);
  });

  it("切成功：凭据端点/模型、Profile、config.selection 三处一起改", async () => {
    state.providerRow = { provider: "deepseek", apiKeyEncrypted: "v1:x", baseUrl: null };
    state.profilesChanged = 1;
    state.profiles = [
      { id: "p1", name: "remember-dev", provider: "deepseek", model: "deepseek-v4-flash" },
    ];

    await runModelUse(cfg() as never, "deepseek/deepseek-v4-flash");

    expect(process.exitCode).toBeUndefined();
    expect(state.upserts[0]).toMatchObject({
      provider: "deepseek",
      defaultModel: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", // 库里没记就用目录给的
    });
    expect(state.order).toContain("setProfilesTarget");
    expect(state.written.at(-1)?.selection).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
    });
    // 没给新 Key 就不该覆盖已存的密文
    expect(state.upserts[0]).not.toHaveProperty("apiKey");
  });
});

describe("runKey", () => {
  it("未知子命令 → 退出码 1 并列出可用值", async () => {
    await runKey(cfg() as never, ["nope"]);

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/未知子命令：key nope.*list \| new/s);
  });

  it("库里没有 Profile 时拒绝造 Key（Key 必须绑 Profile）", async () => {
    state.profiles = [];

    await runKey(cfg() as never, ["new"]);

    expect(process.exitCode).toBe(1);
    expect(state.logs.join("\n")).toMatch(/必须绑定一个 Profile/);
    expect(state.createdKeys).toHaveLength(0);
  });

  it("造 Key：入库、落盘、并把明文打印唯一一次", async () => {
    state.profiles = [
      { id: "p1", name: "remember-dev", provider: "deepseek", model: "deepseek-v4-flash" },
    ];

    await runKey(cfg() as never, ["new", "笔记本"]);

    expect(state.createdKeys[0]).toMatchObject({ profileId: "p1", name: "笔记本", plaintext: "rma_brand_new" });
    expect(state.written.at(-1)?.apiKey).toEqual({ value: "rma_brand_new", profileName: "remember-dev" });

    const logs = state.logs.join("\n");
    expect(logs).toContain("rma_brand_new");
    expect(logs).toMatch(/只显示这一次/);
  });
});

describe("runConnect", () => {
  it("把配置原样交给 printConnect（三件套只有一处定义）", async () => {
    const config = cfg({
      apiKey: { value: "rma_x", profileName: "remember-dev" },
      server: { host: "127.0.0.1", port: 4321 },
    });

    await runConnect(config as never);

    const logs = state.logs.join("\n");
    expect(logs).toContain("http://127.0.0.1:4321/v1");
    expect(logs).toContain("rma_x");
    expect(logs).toContain("remember-dev");
  });
});

describe("runDoctor", () => {
  it("全绿时报通过", async () => {
    await runDoctor(cfg() as never);

    expect(state.order).toContain("runSmoke");
    expect(state.logs.join("\n")).toMatch(/自检通过/);
  });

  it("有红项时报未全绿，并把每一项都打出来", async () => {
    state.smoke = [
      { name: "网关可启动", ok: true, detail: "ok" },
      { name: "API Key 可用", ok: false, detail: "HTTP 401" },
    ];

    await runDoctor(cfg() as never);

    expect(state.logs.join("\n")).toMatch(/自检未全绿/);
  });

  it("自检抛错时不把异常穿出去，只报失败", async () => {
    state.smokeThrows = true;

    await expect(runDoctor(cfg() as never)).resolves.toBeUndefined();
    expect(state.logs.join("\n")).toMatch(/自检失败：网关起不来/);
  });
});
