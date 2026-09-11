/**
 * 「三件套」输出 —— Base URL / API Key / Model。
 *
 * 这三个值是用户**唯一会照抄**进自己客户端的东西（`init` 收尾、`up` 启动、`connect`
 * 三处都打印）。判错的后果不是本地报错，而是用户在别的工具里拿到 401 且完全不知道
 * 为什么——他不会怀疑是我们的文案错了。
 *
 * 钉两件事：
 *   1. 取值规则：没 Key 时打印什么、port 覆盖走不走得通、model 回落是什么
 *   2. `printConnect` 与 `trioOf` **同源**：它只能打印 trioOf 算出来的值，
 *      不许自己再拼一份。拼两份的那天起，改一处就会开始骗人。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({ note: vi.fn() }));

import { note } from "@clack/prompts";
import { DEFAULT_PROFILE_NAME, emptyConfig, type CliConfig } from "./config.js";
import { printConnect, trioOf } from "./connect.js";

/** 用 emptyConfig() 打底，只覆盖本用例关心的字段 */
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { ...emptyConfig(), ...over };
}

/** 取上一次 note 的正文与标题；没调用过就炸（否则「什么都没打印」会静默通过） */
function lastNote(): { body: string; title: string } {
  const call = vi.mocked(note).mock.calls.at(-1);
  if (!call) throw new Error("printConnect 没有调用 note —— 用户什么也看不到");
  return { body: String(call[0]), title: String(call[1]) };
}

beforeEach(() => {
  vi.mocked(note).mockClear();
});

describe("trioOf", () => {
  it("有 Key：baseUrl 用 host + port，model 用 profileName", () => {
    const config = cfg({
      apiKey: { value: "rma_abc", profileName: "my-profile" },
      server: { host: "127.0.0.1", port: 4100 },
    });

    expect(trioOf(config)).toEqual({
      baseUrl: "http://127.0.0.1:4100/v1",
      apiKey: "rma_abc",
      model: "my-profile",
    });
  });

  it("没 Key：apiKey 是 null（不是空串），model 回落到 remember-dev", () => {
    const trio = trioOf(cfg({ apiKey: null }));

    expect(trio.apiKey).toBeNull();
    expect(trio.baseUrl).toBe("http://127.0.0.1:4000/v1");
    // 断言的是「回落值 == 那个唯一的默认名」，不是硬写一遍 "remember-dev"：
    // connect.ts 里是字面量、config.ts 里是 DEFAULT_PROFILE_NAME，改了一个不改
    // 另一个，用户拿到的 Model 就与网关实际注册的 profile 对不上。
    expect(trio.model).toBe(DEFAULT_PROFILE_NAME);
  });

  it("显式 port 覆盖 config.server.port（up 用它打印实际监听端口）", () => {
    const config = cfg({ server: { host: "0.0.0.0", port: 4000 } });

    expect(trioOf(config).baseUrl).toBe("http://0.0.0.0:4000/v1");
    expect(trioOf(config, 4999).baseUrl).toBe("http://0.0.0.0:4999/v1");
  });
});

describe("printConnect", () => {
  it("打印的三件套与 trioOf 完全一致（同源，不许各拼一份）", () => {
    const config = cfg({ apiKey: { value: "rma_abc", profileName: "p1" } });
    const trio = trioOf(config);

    printConnect(config);
    const { body } = lastNote();

    expect(body).toContain(trio.baseUrl);
    expect(body).toContain(String(trio.apiKey));
    expect(body).toContain(trio.model);
  });

  it("没 Key 时打印「未生成」提示，且正文里不出现 null / undefined", () => {
    printConnect(cfg({ apiKey: null }));
    const { body } = lastNote();

    expect(body).toContain("（未生成，运行 remember-api key new）");
    expect(body).not.toContain("null");
    expect(body).not.toContain("undefined");
  });

  it("port 覆盖体现在 Base URL 上", () => {
    printConnect(cfg(), 4999);

    expect(lastNote().body).toContain("http://127.0.0.1:4999/v1");
  });
});
