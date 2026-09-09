/**
 * recall_memories 工具单测 —— mock @remember/memory 注入 fake provider（仿 memory-write.test.ts）。
 * 验证：正常检索纯文本列表、query 截断/limit 钳制、空/未配置/异常一律友好降级不 throw。不触 DB/网络。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRecall } from "./memory-tool.js";

interface MemHit {
  type: string;
  content: string;
}

interface SearchInput {
  userId: string;
  projectId: string | null;
  query: string;
  limit?: number;
}

const fakeProvider = {
  name: "fake",
  enabled: true,
  search: vi.fn(async (_input: SearchInput): Promise<MemHit[]> => []),
};

vi.mock("@remember/memory", () => ({ createMemoryProvider: () => fakeProvider }));

const deps = { userId: "usr_1", projectId: "proj_1" };

function lastSearchInput(): SearchInput {
  const call = fakeProvider.search.mock.calls.at(-1);
  if (!call) throw new Error("search 未被调用");
  return call[0];
}

describe("runRecall", () => {
  beforeEach(() => {
    fakeProvider.enabled = true;
    fakeProvider.search.mockReset();
    fakeProvider.search.mockImplementation(async () => []);
  });

  it("正常：search 绑定桶 → 纯文本编号列表", async () => {
    fakeProvider.search.mockResolvedValue([
      { type: "preference", content: "数据库统一用 PostgreSQL" },
      { type: "project", content: "remember-api 未 push 的改动在 3434d22" },
    ]);
    const text = await runRecall(deps, { query: "数据库用什么" });
    expect(text).toContain("1. (preference) 数据库统一用 PostgreSQL");
    expect(text).toContain("2. (project) remember-api");
    expect(lastSearchInput()).toEqual({
      userId: "usr_1",
      projectId: "proj_1",
      query: "数据库用什么",
      limit: 5,
    });
  });

  it("query 超长截 200、limit 钳 1..10（缺省 5）", async () => {
    await runRecall(deps, { query: "长".repeat(500), limit: 99 });
    expect(lastSearchInput().query.length).toBe(200);
    expect(lastSearchInput().limit).toBe(10);

    await runRecall(deps, { query: "x", limit: 0 });
    expect(lastSearchInput().limit).toBe(1);

    await runRecall(deps, { query: "x" });
    expect(lastSearchInput().limit).toBe(5);
  });

  it("空结果 → 未检索到，不 throw", async () => {
    fakeProvider.search.mockResolvedValue([]);
    await expect(runRecall(deps, { query: "没人记得的事" })).resolves.toBe(
      "（未检索到相关记忆）",
    );
  });

  it("记忆后端未配置（enabled=false）→ 友好降级，不 search", async () => {
    fakeProvider.enabled = false;
    await expect(runRecall(deps, { query: "x" })).resolves.toBe(
      "（记忆后端未配置：本次未检索）",
    );
    expect(fakeProvider.search).not.toHaveBeenCalled();
  });

  it("query 缺失/空 → 不 search，提示需提供 query", async () => {
    await expect(runRecall(deps, {})).resolves.toBe(
      "（检索词为空：请提供 query）",
    );
    await expect(runRecall(deps, { query: "   " })).resolves.toBe(
      "（检索词为空：请提供 query）",
    );
    expect(fakeProvider.search).not.toHaveBeenCalled();
  });

  it("search 抛错 → 吞成降级文本不 throw（工具轮不能拖垮整轮）", async () => {
    fakeProvider.search.mockRejectedValue(new Error("mem0 挂了"));
    await expect(runRecall(deps, { query: "x" })).resolves.toBe(
      "（记忆检索失败，请基于已知信息回答）",
    );
  });
});
