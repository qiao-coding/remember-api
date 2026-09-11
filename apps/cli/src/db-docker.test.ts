/**
 * `db.ts` 里靠 `docker` 子进程与真实连接那一半。
 *
 * 纯函数测试（db.test.ts）证明不了这些行为，而它们的判错后果很不对称：
 *
 * - `dockerVersion` 判错 → 向导推荐 Docker 路径，然后在 `docker run` 上失败
 * - `ensureContainer` 判错 → **重建容器 = 删库**。用户跑第二遍 `init` 时数据全没，
 *   而且没有任何报错——`docker run` 成功返回，只是跑的是一条全新命令。
 *
 * 所以这里把 `node:child_process` 与 `@remember/db` 整个换掉，只看
 * **到底发出了哪些命令**，以及**哪条命令绝不能出现**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Resp {
  stdout?: string;
  stderr?: string;
  /** 设了就模拟「命令失败」 */
  fail?: string;
}

const state = vi.hoisted(() => ({
  /** 每条被调用的命令，记成 [file, ...args] */
  calls: [] as string[][],
  /** docker 子命令（args[0]）→ 返回值 */
  responses: new Map<string, Resp>(),
  fallback: {} as Resp,
  /** waitForServer 用：模拟的客户端行为 */
  connectAttempts: 0,
  /** 前 N 次连接失败，之后成功 */
  failFirst: 0,
  /** 每次连接失败时报什么 */
  connectError: "connection refused",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: (Error & { stderr?: string }) | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    state.calls.push([file, ...args]);
    const r = state.responses.get(args[0] ?? "") ?? state.fallback;
    if (r.fail !== undefined) {
      cb(Object.assign(new Error(r.fail), { stderr: r.stderr ?? "" }));
      return;
    }
    cb(null, { stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  },
}));

vi.mock("@remember/db", () => {
  const makeClient = () => {
    const client = async () => {
      state.connectAttempts += 1;
      if (state.connectAttempts <= state.failFirst) throw new Error(state.connectError);
      return [{ ok: 1 }];
    };
    client.unsafe = async () => [];
    client.end = async () => {};
    return client;
  };
  return { createClient: () => makeClient(), runMigrations: async () => {} };
});

const { containerState, dockerCliInstalled, dockerVersion, ensureContainer, waitForServer } =
  await import("./db.js");

/** 每次调用都重新读 map，避免用例之间串味 */
function respond(map: Record<string, Resp>, fallback: Resp = {}): void {
  state.responses = new Map(Object.entries(map));
  state.fallback = fallback;
}

function dockerCalls(): string[][] {
  return state.calls.filter((c) => c[0] === "docker").map((c) => c.slice(1));
}

const sent = (sub: string): string[][] => dockerCalls().filter((args) => args[0] === sub);

const PLAN = {
  container: "remember-pg",
  image: "postgres:16",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "remember_api",
};

beforeEach(() => {
  state.calls = [];
  state.responses = new Map();
  state.fallback = {};
  state.connectAttempts = 0;
  state.failFirst = 0;
  state.connectError = "connection refused";
});

describe("dockerVersion —— 判的是 daemon，不是 CLI", () => {
  it("daemon 可用时返回版本串", async () => {
    respond({ info: { stdout: "29.7.2" } });

    expect(await dockerVersion()).toBe("29.7.2");
    expect(sent("info")[0]).toContain("{{.ServerVersion}}");
  });

  it("装了 Docker Desktop 但没启动：返回 null，且不去问 docker --version", async () => {
    // 这条是重点。--version 在 daemon 没起时照样有输出，拿它当判据会让向导
    // 推荐 Docker 路径，然后在 docker run 上失败——用户看到的是莫名奇妙的报错。
    respond({ info: { fail: "Cannot connect to the Docker daemon" }, "--version": { stdout: "29.7.2" } });

    expect(await dockerVersion()).toBeNull();
  });

  it("命令成功但没有输出时返回 null（不是空串）", async () => {
    respond({ info: { stdout: "" } });

    expect(await dockerVersion()).toBeNull();
  });
});

describe("dockerCliInstalled", () => {
  it("CLI 在 → true", async () => {
    respond({ "--version": { stdout: "Docker version 29.7.2" } });

    expect(await dockerCliInstalled()).toBe(true);
  });

  it("CLI 不在 → false", async () => {
    respond({ "--version": { fail: "command not found" } });

    expect(await dockerCliInstalled()).toBe(false);
  });
});

describe("containerState", () => {
  it("容器存在时返回状态串", async () => {
    respond({ inspect: { stdout: "running" } });

    expect(await containerState("remember-pg")).toBe("running");
  });

  it("容器不存在（inspect 非零退出）→ null", async () => {
    respond({ inspect: { fail: "No such container", stderr: "Error: No such container: remember-pg" } });

    expect(await containerState("remember-pg")).toBeNull();
  });
});

describe("ensureContainer —— 三分支，重点是「绝不重建」", () => {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  beforeEach(() => {
    logs.length = 0;
  });

  it("已在运行 → reused，且不发 start、更不发 run", async () => {
    respond({ inspect: { stdout: "running" } });

    expect(await ensureContainer(PLAN, log)).toEqual({ action: "reused" });
    expect(sent("start")).toHaveLength(0);
    // 「重建等于删库」——这条只要发出去了，用户的数据就没了
    expect(sent("run")).toHaveLength(0);
  });

  it("存在但停了 → started，复用原容器（数据保留）", async () => {
    respond({ inspect: { stdout: "exited" }, start: { stdout: "remember-pg" } });

    expect(await ensureContainer(PLAN, log)).toEqual({ action: "started" });
    expect(sent("start")).toHaveLength(1);
    expect(sent("start")[0]).toContain("remember-pg");
    expect(sent("run")).toHaveLength(0);
    expect(logs.join("\n")).toContain("原有数据保留");
  });

  it("不存在 → created，run 的参数把库名/密码/端口都带上", async () => {
    respond({ inspect: { fail: "No such container" }, run: { stdout: "sha256:abc" } });

    expect(await ensureContainer(PLAN, log)).toEqual({ action: "created" });

    const args = sent("run")[0] ?? [];
    expect(args).toEqual([
      "run",
      "-d",
      "--name",
      "remember-pg",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      "5432:5432",
      "postgres:16",
    ]);
  });

  it("start 失败 → 抛错并带上 stderr，不悄悄退化成 run", async () => {
    respond({ inspect: { stdout: "exited" }, start: { fail: "boom", stderr: "Error: boom" } });

    await expect(ensureContainer(PLAN, log)).rejects.toThrow(/启动已有容器失败.*boom/s);
    expect(sent("run")).toHaveLength(0);
  });

  it("run 失败 → 抛错，并提示「端口被占用可改用已有实例」", async () => {
    respond({ inspect: { fail: "No such container" }, run: { fail: "port is already allocated" } });

    const err = (await ensureContainer(PLAN, log).catch((e) => e as Error)) as Error;
    expect(err.message).toMatch(/创建容器失败/);
    expect(err.message).toMatch(/端口 5432/);
  });
});

describe("waitForServer", () => {
  it("一次就连上时不重试", async () => {
    await waitForServer("postgres://u:p@127.0.0.1:5432/db", 1000);

    expect(state.connectAttempts).toBe(1);
  });

  it("连不上就重试，直到连上为止", async () => {
    state.failFirst = 2;

    await waitForServer("postgres://u:p@127.0.0.1:5432/db", 5000);

    expect(state.connectAttempts).toBe(3);
  });

  it("超时抛错，并把最后一次的真实报错带出来", async () => {
    state.failFirst = Number.MAX_SAFE_INTEGER;
    state.connectError = "ECONNREFUSED 127.0.0.1:5432";

    // 只跑一次、拿错误对象断言两次：再跑一遍要多花一整个超时窗口
    const err = (await waitForServer("postgres://u:p@127.0.0.1:5432/db", 1000).catch(
      (e) => e as Error,
    )) as Error;
    expect(err.message).toMatch(/等待 Postgres 就绪超时/);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });
});
