/**
 * /v1 key→个人 model 隔离语义测试。
 * 覆盖（service 层 prepareChat + 路由 403 映射）：
 *  - 绑定 key 请求本用户其它 profile → ProfileNotAllowedError（路由映射 403）
 *  - 绑定 key 携带 remember.project → ProfileNotAllowedError
 *  - 绑定 key 请求非本用户 profile 名（上游别名，如 deepseek-chat）→ 容忍，用绑定 profile
 * 真实 DB 过滤（/v1/models 只列绑定 model、user 级列全量）走 E2E（见验证配方）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { getDb } from "@remember/db";
import type { ChatCompletionRequest } from "@remember/shared";
import {
  prepareChat,
  ProfileNotAllowedError,
  ProfileNotFoundError,
  type PreparedChat,
} from "../services/chat.js";
import { openAiRoutes } from "./openai.js";

const getDbMock = vi.fn();
vi.mock("@remember/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@remember/db")>();
  return { ...actual, getDb: () => getDbMock() };
});
vi.mock("@remember/memory", () => ({
  createMemoryProvider: () => ({ search: vi.fn(async () => []) }),
}));
// 让 openai 路由跳过真实 api-key 鉴权：req.user 由测试注入
const authState: { user?: { id: string; apiKeyId: string; keyProfileId: string | null } } = {};
vi.mock("../plugins/api-key-auth.js", () => ({
  apiKeyAuthHook: vi.fn(async (req: { user?: unknown }) => {
    req.user = authState.user;
  }),
}));

const profA = {
  id: "prof_a",
  name: "agentA",
  userId: "user_a",
  provider: "deepseek",
  model: "deepseek-chat",
  projectId: "proj_a",
  systemPrompt: null,
  memoryEnabled: false,
  memoryBudget: 1500,
  skillIds: [],
  temperature: null,
  maxTokens: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const profB = { ...profA, id: "prof_b", name: "agentB" };
const projA = {
  id: "proj_a",
  userId: "user_a",
  name: "proj_a",
  memoryNamespace: "ns_proj_a",
  decisions: [],
  knownIssues: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeDb() {
  const profiles = { findFirst: vi.fn(), findMany: vi.fn() };
  const projects = { findFirst: vi.fn() };
  const providerConfigs = { findFirst: vi.fn() };
  const db = { query: { profiles, projects, providerConfigs } };
  return { db, profiles, projects, providerConfigs };
}

function chatBody(
  model: string,
  extra: Record<string, unknown> = {},
): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: "user", content: "hi" }],
    ...extra,
  } as ChatCompletionRequest;
}

describe("/v1 绑定 key 隔离语义", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    authState.user = undefined;
  });

  it("绑定 key + 请求本用户其它 model → ProfileNotAllowedError", async () => {
    const { db, profiles } = makeDb();
    getDbMock.mockReturnValue(db);
    // 第一次 findFirst = 载入绑定 profile(prof_a)；第二次 = 校验 req.model 指向(prof_b)
    profiles.findFirst.mockResolvedValueOnce(profA).mockResolvedValueOnce(profB);

    await expect(
      prepareChat("user_a", chatBody("agentB"), "prof_a"),
    ).rejects.toBeInstanceOf(ProfileNotAllowedError);
  });

  it("绑定 key + remember.project → ProfileNotAllowedError(param=remember.project)", async () => {
    const { db, profiles } = makeDb();
    getDbMock.mockReturnValue(db);
    profiles.findFirst.mockResolvedValue(profA);

    await expect(
      prepareChat("user_a", chatBody("agentA", { remember: { project: "proj_b" } }), "prof_a"),
    ).rejects.toMatchObject({ name: "ProfileNotAllowedError", param: "remember.project" });
  });

  it("绑定 key + 上游别名(非本用户 profile 名) → 容忍，用绑定 profile", async () => {
    const { db, profiles, projects, providerConfigs } = makeDb();
    getDbMock.mockReturnValue(db);
    profiles.findFirst
      .mockResolvedValueOnce(profA) // 载入绑定
      .mockResolvedValueOnce(undefined); // 别名不命中任何 profile
    projects.findFirst.mockResolvedValue(projA);
    providerConfigs.findFirst.mockResolvedValue(undefined); // 走 env 兜底

    const prepared: PreparedChat = await prepareChat(
      "user_a",
      chatBody("deepseek-chat"),
      "prof_a",
    );
    expect(prepared.profileName).toBe("agentA");
    expect(prepared.projectId).toBe("proj_a");
    // 绑定路径下 prepareChat 第二段 findFirst 查的是"是否为本用户另一 profile"
    expect(profiles.findFirst).toHaveBeenCalledTimes(2);
  });

  it("keyProfileId 为空 → 抛错（回收全量按 model 名解析旧行为）", async () => {
    const { db } = makeDb();
    getDbMock.mockReturnValue(db);
    await expect(
      prepareChat("user_a", chatBody("agentA"), ""),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});

describe("POST /chat/completions 隔离 403 映射", () => {
  async function injectChat(payload: object) {
    const app = Fastify({ logger: false });
    await openAiRoutes(app);
    return app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  }

  it("绑定 key 请求其它 model → 403 profile_not_allowed(param=model)", async () => {
    const { db, profiles } = makeDb();
    getDbMock.mockReturnValue(db);
    profiles.findFirst.mockResolvedValueOnce(profA).mockResolvedValueOnce(profB);
    authState.user = { id: "user_a", apiKeyId: "key_a", keyProfileId: "prof_a" };

    const res = await injectChat(chatBody("agentB"));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("profile_not_allowed");
    expect(res.json().error.param).toBe("model");
  });

  it("绑定 key 携带 remember.project → 403(param=remember.project)", async () => {
    const { db, profiles } = makeDb();
    getDbMock.mockReturnValue(db);
    profiles.findFirst.mockResolvedValueOnce(profA).mockResolvedValueOnce(profA); // requested=绑定本身
    authState.user = { id: "user_a", apiKeyId: "key_a", keyProfileId: "prof_a" };

    const res = await injectChat(
      chatBody("agentA", { remember: { project: "proj_b" } }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("profile_not_allowed");
    expect(res.json().error.param).toBe("remember.project");
  });
});
