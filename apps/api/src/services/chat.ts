import { and, eq } from "drizzle-orm";
import { getDb, profiles } from "@remember/db";
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
import { recordUsage } from "./usage.js";
import {
  writeTurnMemories,
  type TurnMemoryInput,
} from "./memory-write.js";
import { maybeArchiveLongConversation } from "./memory-archive.js";

export class ProfileNotFoundError extends Error {
  constructor(name: string) {
    super(`Profile "${name}" 不存在`);
    this.name = "ProfileNotFoundError";
  }
}

/** key 已绑定某个人 model，却请求了别的 model / 指定了不支持参数 —— 隔离拒绝（403） */
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
  /** 记忆桶命名空间 = 绑定 project 的 id（薄桥只拿它当桶键，不再读 project 内容） */
  projectId: string;
  provider: ModelProvider;
  finalMessages: ChatMessage[];
  memoryTokens: number;
  skillTokens: number;
  breakdown: ContextBreakdown;
  /** 用户级 + 请求级记忆开关；false 时短窗写入与长对话归档都跳过 */
  memoryEnabled: boolean;
}

/**
 * 生态消息 → 我们能送上游的形态：
 *  - developer 角色归一为 system（DeepSeek 只认 system；prompt-cache 语义等同）
 *  - content 数组（OpenAI chat 合法多段 part：字符串 / {type:"text",text}）拼成纯文本
 *  - 空 content → ""（别把 null 塞进逐字历史/折叠块）
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string" ? p : (p as { text?: string })?.text ?? "",
      )
      .join("");
  }
  return String(content);
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    role: ((m.role as string) === "developer" ? "system" : m.role) as ChatMessage["role"],
    content: contentToText(m.content),
  }));
}

/** 合并客户端 system 消息为一段纯文本（与我们的固定内容拼进同一条 system） */
function clientSystemText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => String(m.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 薄桥核心：解析绑定个人 model + 两区拼装出站消息。
 * 只做 4 件事：认 profile、查记忆、拼 prompt、交给上游。不碰 project/skill/provider 加密/预算实体。
 */
export async function prepareChat(
  userId: string,
  req: ChatCompletionRequest,
  keyProfileId: string,
): Promise<PreparedChat> {
  // 强制隔离：key 恒绑定一个个人 model（auth 层已保证 keyProfileId 非空）。
  if (!keyProfileId) {
    throw new ProfileNotFoundError("(未绑定个人 model)");
  }

  const profile = await getDb().query.profiles.findFirst({
    where: and(eq(profiles.id, keyProfileId), eq(profiles.userId, userId)),
  });
  if (!profile) throw new ProfileNotFoundError(keyProfileId);
  // 请求其它本用户的 model（key 绑定的那个之外）→ 403 隔离
  if (req.model) {
    const requested = await getDb().query.profiles.findFirst({
      where: and(eq(profiles.userId, userId), eq(profiles.name, req.model)),
    });
    if (requested && requested.id !== profile.id) {
      throw new ProfileNotAllowedError(
        `该 key 已绑定个人 model「${profile.name}」，不可请求其它 model「${req.model}」`,
      );
    }
  }
  // 薄桥无跨桶概念：绑定 key 的记忆桶固定 = profile.projectId，不接受客户端指定
  if (req.remember?.project) {
    throw new ProfileNotAllowedError(
      `该 key 已绑定个人 model「${profile.name}」，不支持指定 remember.project`,
      "remember.project",
    );
  }

  const memoryProvider = createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
  const memoryEnabled = profile.memoryEnabled && req.remember?.memory !== false;
  const bucketId = profile.projectId; // profile 强制挂 project；id 即记忆桶

  // developer → system、content 数组 → 纯文本（Codex/生态消息），后续统一用 msgs
  const msgs = normalizeMessages(req.messages);

  const lastUser =
    [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

  let preferences: { type: MemoryType; content: string }[] = [];
  let retrieved: { type: MemoryType; content: string }[] = [];
  if (memoryEnabled) {
    try {
      // 注意：mem0 /search 对空 query 会 500 → 两类检索都必须给非空 query。
      const query = (lastUser || "我的偏好 习惯 技术栈 名字").slice(0, 200);
      const [pinnedRows, hits] = await Promise.all([
        memoryProvider.search({
          userId,
          projectId: bucketId,
          query: "身份 名字 代号 技术栈 偏好 习惯",
          limit: 8,
        }),
        memoryProvider.search({ userId, projectId: bucketId, query, limit: 16 }),
      ]);

      preferences = pinnedRows
        .filter((m) => m.type === "preference")
        .map((m) => ({ type: m.type, content: m.content }));

      const budget = req.remember?.memoryBudget ?? profile.memoryBudget ?? 1500;
      const alloc = allocateMemoryBudget(
        hits.map((m) => ({
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
          pinned: m.pinned,
          relevance: m.relevance ?? 0.5,
        })),
        budget,
      );
      retrieved = alloc.selected.map((m) => ({ type: m.type, content: m.content }));
    } catch (err) {
      // 记忆后端抖动/宕机 → 降级为无注入记忆继续（不拖垮整个 chat）
      console.warn("[chat] 记忆召回失败，本轮不注入记忆:", err);
      preferences = [];
      retrieved = [];
    }
  }

  const built = buildContext({
    clientSystem: clientSystemText(msgs),
    profileSystemPrompt: profile.systemPrompt,
    preferences,
    retrievedMemories: retrieved,
    messages: msgs,
  });

  // 上游 key：env 基建 key（providerConfigs 加密 key 不再参与 chat 路径）
  const provider = createProvider({
    provider: profile.provider as ProviderId,
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
    defaultModel: profile.model,
  });

  return {
    userId,
    profileId: profile.id,
    profileName: profile.name,
    baseModel: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    projectId: bucketId,
    provider,
    finalMessages: built.messages,
    memoryTokens:
      built.breakdown.preferenceTokens + built.breakdown.memoryTokens,
    skillTokens: built.breakdown.skillTokens,
    breakdown: built.breakdown,
    memoryEnabled,
  };
}

/** 组装写/归档共用的回合输入（fire-and-forget） */
function turnInput(
  prepared: PreparedChat,
  req: ChatCompletionRequest,
  assistantContent: string,
): TurnMemoryInput {
  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return {
    userId: prepared.userId,
    projectId: prepared.projectId,
    profileId: prepared.profileId,
    providerName: prepared.provider.id,
    userMessage: contentToText(lastUser),
    assistantContent,
    messages: normalizeMessages(req.messages),
    memoryEnabled: prepared.memoryEnabled,
  };
}

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

  const input = turnInput(prepared, req, result.content);
  void writeTurnMemories(input);
  void maybeArchiveLongConversation(input);

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
      const input = turnInput(prepared, req, finalContent);
      void writeTurnMemories(input);
      void maybeArchiveLongConversation(input);
    } catch {
      // 收尾失败不影响流
    }
  }
  yield SSE_DONE;
}
