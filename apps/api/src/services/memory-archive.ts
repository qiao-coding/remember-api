import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, conversationWatermarks } from "@remember/db";
import { estimateTokens } from "@remember/core";
import { createMemoryProvider } from "@remember/memory";
import { createProvider } from "@remember/providers";
import type { ChatMessage, MemoryType } from "@remember/shared";
import { env } from "../env.js";
import type { TurnMemoryInput } from "./memory-write.js";

/**
 * 长对话 LLM 归档（产品分层"长对话归档用 LLM"）。
 *
 * 短窗规则只能抓到单轮内有信号词的陈述；跨多轮才成立的脉络、或换措辞的无信号词事实，靠这里兜：
 * 对话累计到 ARCHIVE_THRESHOLD_TOKENS 后，fire-and-forget 调 DeepSeek 把近期转写提炼成带 type 的
 * 持久事实写回同一 mem0 桶（source=archiver）。以 (user_id, project_scope) 在 Postgres 记水线，
 * 同一对话距上次归档增长 ≥ ratio×threshold 才再次归档，失败不推进（下轮重试）。
 *
 * 归档 key 用 env DEEPSEEK_API_KEY（基建级策展，非用户自身 model），避免 chat.ts↔本模块循环依赖。
 */

export interface DistilledItem {
  type: MemoryType;
  content: string;
  importance: number;
}

export const ARCHIVE_DEFAULTS = {
  thresholdTokens: 6000,
  growthRatio: 1,
  maxTranscriptTokens: 6000,
  maxItems: 12,
} as const;

/** 记忆桶内区分全局/项目：可空 projectId 归一成字符串，作复合主键一段 */
export function conversationScope(projectId: string | null): string {
  return projectId ?? "__global__";
}

/** 归档去重阈值（略低于短窗的 0.9 —— 提炼句经 LLM 改写，措辞必然与原文有出入） */
const ARCHIVE_DEDUP_RELEVANCE = 0.85;

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * 对话标识 = sha1(第一条非 system 用户消息)。
 * 在 OpenAI 式累积历史里跨轮稳定、换对话才变；不用尾 hash——尾 hash 每轮都变，会击穿高水位。
 * 假定客户端送累积历史；滑动窗口客户端送不全时可能视作新对话（文档注明）。
 */
export function conversationIdOf(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const content = first ? String(first.content ?? "").trim() : "";
  return content ? hashText(content) : "";
}

/** 累计对话 token：只数 user/assistant/tool（system 提示词不计入"对话增长"口径） */
export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) =>
      m.role === "user" || m.role === "assistant" || m.role === "tool"
        ? sum + estimateTokens(String(m.content ?? ""))
        : sum,
    0,
  );
}

/**
 * 构建喂给提炼的转写：去掉 system/tool（含我们自己注入的记忆/技能，勿归档），
 * 追加本轮 assistant 回复，超预算丢最旧（每段预算由 buildTranscript 的 maxTokens 决定）。
 */
export function buildTranscript(
  messages: ChatMessage[],
  assistantContent: string,
  maxTokens: number,
): ChatMessage[] {
  const cleaned = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => String(m.content ?? "").trim() !== "");
  cleaned.push({ role: "assistant", content: assistantContent.trim() });

  while (estimateConversationTokens(cleaned) > maxTokens && cleaned.length > 1) {
    cleaned.shift();
  }
  return cleaned;
}

export type ArchiveDecision =
  | "skip_short"
  | "skip_within_threshold"
  | "archive"
  | "archive_reset";

export interface WatermarkRowLike {
  conversationId: string;
  lastArchivedTokens: number;
}

/**
 * 归档判定。
 * - 累计 < threshold → skip_short（短对话每轮 ~0 成本，不碰 DB）；
 * - 无/异水线（首归档 / 新对话）且 ≥ threshold → archive；
 * - 同对话继续：距上次归档增长 ≥ growthRatio×threshold → archive；否则 skip_within_threshold；
 * - 同对话但累计萎缩（客户端重发更短历史 / 新对话复用同开场白致 hash 相同）→ archive_reset 重置水线。
 */
export function decideArchive(args: {
  currentTokens: number;
  thresholdTokens: number;
  growthRatio: number;
  conversationId: string;
  watermark: WatermarkRowLike | null;
}): ArchiveDecision {
  const { currentTokens, thresholdTokens, growthRatio, conversationId, watermark } = args;
  if (currentTokens < thresholdTokens) return "skip_short";
  if (!watermark || watermark.conversationId !== conversationId) return "archive";
  if (currentTokens < watermark.lastArchivedTokens) return "archive_reset";
  const growth = currentTokens - watermark.lastArchivedTokens;
  if (growth >= growthRatio * thresholdTokens) return "archive";
  return "skip_within_threshold";
}

const ALLOWED_TYPES = new Set<string>([
  "preference",
  "decision",
  "status",
  "task",
  "issue",
  "history",
]);

/** 解析模型输出的 JSON 数组：容忍 ```fence / 前导 prose / 尾随文字 / 包装，部分非法项容错丢弃 */
export function parseArchiveJson(text: string): DistilledItem[] {
  if (!text) return [];
  // 去 ```json fence 与前导/尾随 prose：取最外 [ ... ] 区间
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  const raw = text.slice(start, end + 1);
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const items: DistilledItem[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = e.type;
    const content = typeof e.content === "string" ? e.content.trim() : "";
    const importance =
      typeof e.importance === "number" && Number.isFinite(e.importance)
        ? Math.min(1, Math.max(0, e.importance))
        : 0.5;
    if (typeof type === "string" && ALLOWED_TYPES.has(type) && content) {
      items.push({ type: type as MemoryType, content, importance });
    }
  }
  return items;
}

/** 蒸馏提示词：严格输出 JSON 数组；[] = 没有值得保存的内容 */
export const ARCHIVE_SYSTEM_PROMPT = `你是长期记忆归档器。下面是一段可能很长的用户与助手对话。请提炼出值得长期保存的"持久事实"。
要求：
1) 只保留跨越多轮才成立、或单轮中不易被规则捕获的实质信息：用户身份/命名、技术栈与选型、偏好、已做的决定、当前状态、失败尝试、待办任务。
2) 一条记忆只含一个事实；内容用精炼、具体、可检索的陈述句，保留专名/代号/技术名；禁止"用户说/助手回答/对话中提到"这类转述。
3) 忽略寒暄、一次性操作步骤、与用户长期画像无关的内容。
4) type 只能取 preference|decision|status|task|issue|history；importance 取 0~1，越高越不可遗漏。
5) 只输出严格 JSON 数组，例如 [{"type":"decision","content":"项目代号定为 ALPHA-7","importance":0.8}]；没有值得保存的内容时输出 []。不要输出 JSON 之外的文字。`;

let warnedNoKey = false;

/** 逐项写前去重：只留一次语义 search ≥0.85（不造 list+归一化轮子，mem0 服务端兜精确重复） */
async function isAlreadyStored(
  provider: ReturnType<typeof createMemoryProvider>,
  item: DistilledItem,
  userId: string,
  projectId: string | null,
): Promise<boolean> {
  const similar = await provider.search({
    userId,
    projectId,
    query: item.content.slice(0, 60),
    limit: 1,
  });
  return !!similar[0] && (similar[0].relevance ?? 0) >= ARCHIVE_DEDUP_RELEVANCE;
}

async function putWatermark(input: {
  userId: string;
  projectId: string | null;
  conversationId: string;
  lastArchivedTokens: number;
}): Promise<void> {
  const scope = conversationScope(input.projectId);
  await getDb()
    .insert(conversationWatermarks)
    .values({
      userId: input.userId,
      projectScope: scope,
      conversationId: input.conversationId,
      lastArchivedTokens: input.lastArchivedTokens,
    })
    .onConflictDoUpdate({
      target: [conversationWatermarks.userId, conversationWatermarks.projectScope],
      set: {
        conversationId: input.conversationId,
        lastArchivedTokens: input.lastArchivedTokens,
        updatedAt: new Date(),
      },
    });
}

async function readWatermark(userId: string, scope: string) {
  return getDb().query.conversationWatermarks.findFirst({
    where: and(
      eq(conversationWatermarks.userId, userId),
      eq(conversationWatermarks.projectScope, scope),
    ),
  });
}

/**
 * 归档编排（fire-and-forget、吞错）。输入与 writeTurnMemories 同源（TurnMemoryInput）。
 */
export async function maybeArchiveLongConversation(input: TurnMemoryInput): Promise<void> {
  // 记忆被禁用 → 写入与归档都跳过
  if (!input.memoryEnabled) return;
  // 无提炼 key → 归档不可用（warn 一次即可，避免每轮刷日志）
  if (!env.DEEPSEEK_API_KEY) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn("[memory-archive] 未配置 DEEPSEEK_API_KEY，长对话归档跳过");
    }
    return;
  }

  const provider = createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
  if (!provider.enabled) return;

  // 1) 本地廉价门：短于阈值不碰 DB（短对话每轮 ~0 成本）
  const currentTokens = estimateConversationTokens(input.messages) + estimateTokens(input.assistantContent);
  const thresholdTokens = env.ARCHIVE_THRESHOLD_TOKENS;
  if (currentTokens < thresholdTokens) return;

  // 2) 读水线 + 判定
  const scope = conversationScope(input.projectId);
  const watermark = (await readWatermark(input.userId, scope).catch(() => null)) ?? null;
  const conversationId = conversationIdOf(input.messages);
  const decision = decideArchive({
    currentTokens,
    thresholdTokens,
    growthRatio: env.ARCHIVE_GROWTH_RATIO,
    conversationId,
    watermark,
  });
  if (decision === "skip_short" || decision === "skip_within_threshold") return;

  // 3) DeepSeek 提炼（转写按 maxTranscriptTokens 丢最旧）
  try {
    const transcript = buildTranscript(
      input.messages,
      input.assistantContent,
      env.ARCHIVE_MAX_TRANSCRIPT_TOKENS,
    );
    if (!transcript.length) return;
    const model = createProvider({
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      defaultModel: env.ARCHIVE_MODEL,
    });
    const result = await model.chat({
      model: env.ARCHIVE_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: ARCHIVE_SYSTEM_PROMPT },
        ...transcript,
        { role: "user", content: "请输出上述对话的长期记忆 JSON 数组（仅数组）：" },
      ],
    });

    // 4) 解析（容忍 fence/前导 prose；空/损坏 → [] 仍写水线，防对无事实长对话反复重试）
    const items = parseArchiveJson(result.content)
      .slice(0, env.ARCHIVE_MAX_ITEMS)
      .filter((item) => item.content.length <= 500);

    // 5) 逐项去重后写回同一 mem0 桶（source=archiver）
    for (const item of items) {
      const dup = await isAlreadyStored(provider, item, input.userId, input.projectId);
      if (dup) continue;
      await provider.write({
        userId: input.userId,
        projectId: input.projectId,
        type: item.type,
        content: item.content,
        importance: item.importance,
        source: "archiver",
      });
    }

    // 6) 提炼 + 写入全部成功才推进水线；失败不推进，下轮重试
    await putWatermark({
      userId: input.userId,
      projectId: input.projectId,
      conversationId,
      lastArchivedTokens: currentTokens,
    });
  } catch (err) {
    console.error("[memory-archive] 归档失败（水线不推进，下轮重试）:", err);
  }
}
