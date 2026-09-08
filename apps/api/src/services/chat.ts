import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, profiles, projects, providerConfigs, skills } from "@remember/db";
import {
  allocateMemoryBudget,
  buildContext,
  type ContextBreakdown,
} from "@remember/core";
import { createMemoryProvider } from "@remember/memory";
import {
  createProvider,
  type ChatUsage,
  type ModelProvider,
} from "@remember/providers";
import {
  SSE_DONE,
  sseChunk,
  type ChatCompletionRequest,
  type ChatMessage,
  type MemoryType,
  type ProviderId,
} from "@remember/shared";
import { env } from "../env.js";
import { decryptSecret } from "../lib/crypto.js";
import { recordUsage } from "./usage.js";
import { writeTurnMemories } from "./memory-write.js";

export class ProfileNotFoundError extends Error {
  constructor(name: string) {
    super(`Profile "${name}" 不存在`);
    this.name = "ProfileNotFoundError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(ref: string) {
    super(`Project "${ref}" 不存在或不属于当前用户`);
    this.name = "ProjectNotFoundError";
  }
}

/** key 已绑定某个人 model，却请求了别的 model / 跨桶 project —— 隔离拒绝（403） */
export class ProfileNotAllowedError extends Error {
  param: string;
  constructor(message: string, param = "model") {
    super(message);
    this.name = "ProfileNotAllowedError";
    this.param = param;
  }
}

export interface PreparedChat {
  userId: string;
  profileId: string;
  profileName: string;
  baseModel: string;
  temperature: number | null;
  maxTokens: number | null;
  projectId: string | null;
  provider: ModelProvider;
  finalMessages: ChatMessage[];
  memoryTokens: number;
  skillTokens: number;
  breakdown: ContextBreakdown;
}

export async function prepareChat(
  userId: string,
  req: ChatCompletionRequest,
  keyProfileId: string,
): Promise<PreparedChat> {
  const db = getDb();

  // 强制隔离：key 恒绑定一个个人 model（auth 层已保证 keyProfileId 非空）。
  // 若为空则属防御性路径（理论上不会发生），直接抛错，回收"全量按 model 名解析"旧行为。
  if (!keyProfileId) {
    throw new ProfileNotFoundError("(未绑定个人 model)");
  }
  // ── 选 profile ──
  const profile = await db.query.profiles.findFirst({
    where: and(eq(profiles.id, keyProfileId), eq(profiles.userId, userId)),
  });
  if (!profile) throw new ProfileNotFoundError(keyProfileId);
  if (req.model) {
    const requested = await db.query.profiles.findFirst({
      where: and(eq(profiles.userId, userId), eq(profiles.name, req.model)),
    });
    if (requested && requested.id !== profile.id) {
      throw new ProfileNotAllowedError(
        `该 key 已绑定个人 model「${profile.name}」，不可请求其它 model「${req.model}」`,
      );
    }
  }

  // ── 选 project / 记忆桶 ──
  let project = null;
  // 绑定 key 恒用绑定 profile 自己的 project；拒绝 remember.project 跨桶（防记忆外泄/串桶）
  if (req.remember?.project) {
    throw new ProfileNotAllowedError(
      `该 key 已绑定个人 model「${profile.name}」，不支持指定 remember.project`,
      "remember.project",
    );
  }
  project = profile.projectId
    ? await resolveProject(userId, profile.projectId)
    : null;

  const memoryProvider = createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
  const memoryEnabled = profile.memoryEnabled && req.remember?.memory !== false;

  let preferences: { type: MemoryType; content: string }[] = [];
  let retrieved: { type: MemoryType; content: string }[] = [];

  if (memoryEnabled) {
    const lastUser =
      [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const [prefs, globalMemories, projectMemories] = await Promise.all([
      memoryProvider.search({
        userId,
        projectId: null,
        pinnedOnly: true,
        limit: 8,
        query: "偏好 习惯 技术栈 风格",
      }),
      memoryProvider.search({
        userId,
        projectId: null,
        query: lastUser.slice(0, 200),
        limit: 8,
      }),
      project
        ? memoryProvider.search({
            userId,
            projectId: project.id,
            query: lastUser.slice(0, 200),
            limit: 16,
          })
        : Promise.resolve([]),
    ]);

    preferences = prefs
      .filter((p) => p.type === "preference" && p.projectId === null)
      .map((p) => ({ type: p.type, content: p.content }));
    const budget = req.remember?.memoryBudget ?? profile.memoryBudget ?? 1500;
    const cands = uniqueMemories([...projectMemories, ...globalMemories]);
    const alloc = allocateMemoryBudget(
      cands.map((c) => ({
        id: c.id,
        content: c.content,
        type: c.type,
        importance: c.importance,
        pinned: c.pinned,
        relevance: c.relevance ?? 0.5,
      })),
      budget,
    );
    retrieved = alloc.selected.map((m) => ({ type: m.type, content: m.content }));
  }

  const skillRows = profile.skillIds.length
    ? await db
        .select()
        .from(skills)
        .where(and(eq(skills.userId, userId), inArray(skills.id, profile.skillIds)))
    : [];

  const built = buildContext({
    profileSystemPrompt: profile.systemPrompt,
    preferences,
    project: project
      ? {
          name: project.name,
          summary: project.summary,
          architecture: project.architecture,
          status: project.status,
          decisions: project.decisions,
          knownIssues: project.knownIssues,
        }
      : null,
    retrievedMemories: retrieved,
    skills: skillRows.map((s) => ({ name: s.name, content: s.content })),
    messages: req.messages,
  });

  const providerName = profile.provider as ProviderId;
  const providerConfig = await resolveProviderConfig(userId, providerName);
  const provider = createProvider({
    provider: providerName,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    defaultModel: profile.model,
  });

  return {
    userId,
    profileId: profile.id,
    profileName: profile.name,
    baseModel: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    projectId: project?.id ?? null,
    provider,
    finalMessages: built.messages,
    memoryTokens:
      built.breakdown.preferenceTokens + built.breakdown.memoryTokens,
    skillTokens: built.breakdown.skillTokens,
    breakdown: built.breakdown,
  };
}

async function resolveProject(userId: string, ref: string) {
  const row = await getDb().query.projects.findFirst({
    where: and(
      eq(projects.userId, userId),
      or(eq(projects.id, ref), eq(projects.name, ref)),
    ),
  });
  if (!row) throw new ProjectNotFoundError(ref);
  return row;
}

function uniqueMemories<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/**
 * 解析 Provider 真实调用配置。
 * 用户保存的 providerConfigs（加密 key + baseUrl）优先；
 * 其次环境变量兜底（目前仅 deepseek 提供 DEEPSEEK_API_KEY）；
 * 都没有 → 空 apiKey（工厂回退 MockProvider 离线链路）。
 */
async function resolveProviderConfig(
  userId: string,
  provider: ProviderId,
): Promise<{ apiKey: string; baseUrl?: string }> {
  const cfg = await getDb().query.providerConfigs.findFirst({
    where: and(
      eq(providerConfigs.userId, userId),
      eq(providerConfigs.provider, provider),
    ),
  });

  if (cfg?.apiKeyEncrypted && env.ENCRYPTION_KEY) {
    try {
      return {
        apiKey: decryptSecret(cfg.apiKeyEncrypted, env.ENCRYPTION_KEY),
        baseUrl: cfg.baseUrl ?? envBaseUrl(provider),
      };
    } catch {
      // 解密失败回退环境变量
    }
  }
  return { apiKey: envApiKey(provider), baseUrl: envBaseUrl(provider) };
}

const envApiKey = (provider: ProviderId): string =>
  provider === "deepseek" ? env.DEEPSEEK_API_KEY : "";
const envBaseUrl = (provider: ProviderId): string | undefined =>
  provider === "deepseek" && env.DEEPSEEK_BASE_URL
    ? env.DEEPSEEK_BASE_URL
    : undefined;

/** 非流式 */
export async function runChat(prepared: PreparedChat, req: ChatCompletionRequest) {
  const started = Date.now();
  const result = await prepared.provider.chat({
    model: prepared.baseModel,
    messages: prepared.finalMessages,
    temperature: req.temperature ?? prepared.temperature ?? undefined,
    max_tokens: req.max_tokens ?? prepared.maxTokens ?? undefined,
    top_p: req.top_p ?? undefined,
  });
  const latencyMs = Date.now() - started;

  await recordUsage({
    userId: prepared.userId,
    profileId: prepared.profileId,
    projectId: prepared.projectId,
    provider: prepared.provider.id,
    model: prepared.baseModel,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
    cachedTokens: result.usage.cachedTokens,
    memoryTokens: prepared.memoryTokens,
    skillTokens: prepared.skillTokens,
    latencyMs,
  });

  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  void writeTurnMemories({
    userId: prepared.userId,
    projectId: prepared.projectId,
    userMessage: lastUser,
    assistantContent: result.content,
    providerName: prepared.provider.id,
  });

  return result;
}

/** 流式：产出 OpenAI 兼容的 SSE 行 */
export async function* streamChat(
  prepared: PreparedChat,
  req: ChatCompletionRequest,
): AsyncGenerator<string> {
  const started = Date.now();
  const id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let usage: ChatUsage | null = null;
  let finalContent = "";

  try {
    for await (const chunk of prepared.provider.stream({
      model: prepared.baseModel,
      messages: prepared.finalMessages,
      temperature: req.temperature ?? prepared.temperature ?? undefined,
      max_tokens: req.max_tokens ?? prepared.maxTokens ?? undefined,
      top_p: req.top_p ?? undefined,
    })) {
      if (chunk.usage) usage = chunk.usage;
      if (chunk.delta.content) finalContent += chunk.delta.content;
      yield sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model: req.model,
        choices: [
          {
            index: 0,
            delta: { content: chunk.delta.content ?? undefined },
            finish_reason: chunk.finishReason,
          },
        ],
      });
    }
  } catch (err) {
    yield sseChunk({
      id,
      object: "chat.completion.chunk",
      created,
      model: req.model,
      choices: [{ index: 0, delta: {}, finish_reason: "error" }],
    });
  } finally {
    try {
      const latencyMs = Date.now() - started;
      if (usage) {
        await recordUsage({
          userId: prepared.userId,
          profileId: prepared.profileId,
          projectId: prepared.projectId,
          provider: prepared.provider.id,
          model: prepared.baseModel,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          cachedTokens: usage.cachedTokens,
          memoryTokens: prepared.memoryTokens,
          skillTokens: prepared.skillTokens,
          latencyMs,
        });
      }
      const lastUser =
        [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      void writeTurnMemories({
        userId: prepared.userId,
        projectId: prepared.projectId,
        userMessage: lastUser,
        assistantContent: finalContent,
        providerName: prepared.provider.id,
      });
    } catch {
      // 收尾失败不影响流
    }
  }
  yield SSE_DONE;
}
