import { and, eq } from "drizzle-orm";
import { getDb, profiles } from "@remember/db";
import {
  allocateMemoryBudget,
  buildContext,
  type ContextBreakdown,
} from "@remember/core";
import { createMemoryProvider } from "@remember/memory";
import {
  sumUsage,
  type ChatResult,
  type ChatUsage,
  type ModelProvider,
  type ToolCall,
} from "@remember/providers";
import {
  SSE_DONE,
  sseChunk,
  type ChatCompletionRequest,
  type ChatMessage,
  type MemoryType,
} from "@remember/shared";
import { env } from "../env.js";
import { upstreamProvider } from "../lib/upstream.js";
import { recordUsage } from "./usage.js";
import {
  writeTurnMemories,
  type TurnMemoryInput,
} from "./memory-write.js";
import {
  conversationIdOf,
  maybeArchiveLongConversation,
} from "./memory-archive.js";
import { RECALL_MEMORY_TOOL, RECALL_TOOL_HINT, runRecall } from "./memory-tool.js";
import {
  loadRecentThread,
  maybeUpdateRecentThread,
} from "./recent-thread.js";
import {
  DEFAULT_MAX_TOOL_ROUNDS,
  executeToolTurn,
  isToolUnsupportedError,
  runChatWithTools,
  type ToolExecutor,
} from "./tool-loop.js";

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
  /** 工具型自主 recall：memoryEnabled && env.RECALL_TOOLS !== false（工具由网关内 loop 执行） */
  recallEnabled: boolean;
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

  // 工具型自主 recall 开关（recallEnabled 同时给 buildContext 注 [Memory] 提示 + run/stream 挂 tools）
  const recallEnabled = memoryEnabled && env.RECALL_TOOLS !== false;

  // recent 交接块：换会话时 seal 上一会话摘要进 prev 并注入 system [Recent Threads]。
  // 只在新会话/够长才读行，且 DB 失败静默降级空——不因交接块拖垮 chat。
  let recentThreadText: string | null = null;
  if (memoryEnabled) {
    try {
      recentThreadText = await loadRecentThread({
        userId,
        profileId: profile.id,
        currentConversationId: conversationIdOf(msgs),
      });
    } catch (err) {
      console.warn("[chat] recent 交接块注入失败（降级无注入）:", err);
      recentThreadText = null;
    }
  }

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
    recentThreadText,
    toolUseHint: recallEnabled ? RECALL_TOOL_HINT : undefined,
    messages: msgs,
  });

  // 上游凭据：该用户的 provider_configs 行优先，env 兜底（见 lib/upstream.ts）
  const provider = await upstreamProvider(userId, profile.provider);

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
      built.breakdown.preferenceTokens +
      built.breakdown.memoryTokens +
      built.breakdown.recentThreadTokens +
      built.breakdown.toolHintTokens,
    skillTokens: built.breakdown.skillTokens,
    breakdown: built.breakdown,
    memoryEnabled,
    recallEnabled,
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

/** recall_memories 工具的执行器：绑定当前用户/记忆桶，网关内跑，结果喂回模型 */
function recallExecutor(prepared: PreparedChat): ToolExecutor {
  return (name, input) =>
    runRecall(
      { userId: prepared.userId, projectId: prepared.projectId },
      input as { query?: unknown; limit?: unknown },
    );
}

/** 非流式：recall 开时走网关内 agentic loop；上游不支持 tools → 去工具降级重发一次（仅日志） */
export async function runChat(
  prepared: PreparedChat,
  req: ChatCompletionRequest,
): Promise<ChatResult> {
  const started = Date.now();
  const base = {
    model: prepared.baseModel,
    temperature: req.temperature ?? prepared.temperature ?? undefined,
    max_tokens: req.max_tokens ?? prepared.maxTokens ?? undefined,
    top_p: req.top_p ?? undefined,
  };

  const result = await (async (): Promise<ChatResult> => {
    if (!prepared.recallEnabled) {
      return prepared.provider.chat({ ...base, messages: prepared.finalMessages });
    }
    try {
      const r = await runChatWithTools(
        prepared.provider,
        { ...base, messages: prepared.finalMessages },
        { tools: [RECALL_MEMORY_TOOL], exec: recallExecutor(prepared) },
      );
      return {
        id: "chatcmpl-" + crypto.randomUUID(),
        model: prepared.baseModel,
        content: r.content,
        finishReason: r.finishReason,
        usage: r.usage,
      };
    } catch (err) {
      if (isToolUnsupportedError(err)) {
        console.warn("[chat] 上游不支持 tools，降级为无工具重发");
        return prepared.provider.chat({ ...base, messages: prepared.finalMessages });
      }
      throw err;
    }
  })();

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
  void maybeUpdateRecentThread(input);

  return result;
}

/** 流式：产出 OpenAI 兼容的 SSE 行。recall 开时多轮——工具轮 text-delta 照推、
 * finish 按住不 yield；模型不再要工具（或超轮）才补发该轮 finish 退出。 */
export async function* streamChat(
  prepared: PreparedChat,
  req: ChatCompletionRequest,
): AsyncGenerator<string> {
  const started = Date.now();
  const id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let usage: ChatUsage | null = null;
  let finalContent = "";
  const exec = prepared.recallEnabled ? recallExecutor(prepared) : null;

  const sse = (
    delta: { content?: string | null },
    finish_reason: string | null,
  ) =>
    sseChunk({
      id,
      object: "chat.completion.chunk",
      created,
      model: req.model,
      choices: [{ index: 0, delta, finish_reason }],
    });

  try {
    let tools = prepared.recallEnabled ? [RECALL_MEMORY_TOOL] : undefined;
    let retried = false;
    let toolRounds = 0;
    let messages = prepared.finalMessages;
    const base = {
      temperature: req.temperature ?? prepared.temperature ?? undefined,
      max_tokens: req.max_tokens ?? prepared.maxTokens ?? undefined,
      top_p: req.top_p ?? undefined,
    };

    while (true) {
      const roundCalls: ToolCall[] = [];
      let roundFinish: string | null = null;
      let roundText = "";
      let sentDelta = false; // 本圆是否已向客户端吐过字（决定 tools 降级可否安全整圆重跑）

      try {
        for await (const chunk of prepared.provider.stream({
          model: prepared.baseModel,
          ...base,
          messages,
          ...(tools?.length ? { tools } : {}),
        })) {
          if (chunk.usage) usage = sumUsage(usage, chunk.usage);
          if (chunk.delta.content) {
            finalContent += chunk.delta.content;
            roundText += chunk.delta.content;
            sentDelta = true;
            yield sse({ content: chunk.delta.content }, null);
          }
          if (chunk.toolCalls?.length) roundCalls.push(...chunk.toolCalls);
          if (chunk.finishReason) roundFinish = chunk.finishReason;
        }
      } catch (err) {
        // 上游不支持 tools 且本圆一字未发 → 去工具整圆重跑（客户端无感知）
        if (
          tools?.length &&
          !retried &&
          !sentDelta &&
          isToolUnsupportedError(err)
        ) {
          console.warn("[chat] 上游不支持 tools，流式降级为无工具重发");
          retried = true;
          tools = undefined;
          continue;
        }
        throw err;
      }

      // 模型要工具且未超轮 → 执行并续轮（追加 assistant(tool_calls)+tool 结果）
      if (roundCalls.length && toolRounds < DEFAULT_MAX_TOOL_ROUNDS && exec) {
        messages = await executeToolTurn(messages, roundText, roundCalls, exec);
        toolRounds++;
        continue;
      }

      // 终止轮：补发 finish（text delta 已逐个发；超轮强制终止也照发原 reason）
      yield sse({}, roundFinish ?? (roundCalls.length ? "tool-calls" : "stop"));
      break;
    }
  } catch (err) {
    console.warn("[chat] stream 错误:", err);
    yield sse({}, "error");
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
      void maybeUpdateRecentThread(input);
    } catch {
      // 收尾失败不影响流
    }
  }
  yield SSE_DONE;
}
