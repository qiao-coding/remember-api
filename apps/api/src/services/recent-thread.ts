import { and, eq } from "drizzle-orm";
import { getDb, conversationSummaries } from "@remember/db";
import { estimateTokens, truncateToTokens } from "@remember/core";
import { ProviderError } from "@remember/providers";
import { env } from "../env.js";
import { upstreamProvider } from "../lib/upstream.js";
import {
  buildTranscript,
  conversationIdOf,
  estimateConversationTokens,
} from "./memory-archive.js";
import type { TurnMemoryInput } from "./memory-write.js";

/**
 * recent 高密度会话摘要（跨会话交接块，profile 隔离）。
 *
 * 客户端无 resume（不像 Claude Code 靠 jsonl 续活上下文），跨会话的"同一人"续接
 * 由网关自己做：每 profile 在 Postgres 存"单行两槽"——
 *   - active = 当前会话滚动摘要（LLM 提炼，会话累积 ≥ RECENT_MIN_TOKENS 首产、
 *     距上次摘要增长 ≥ RECENT_GROWTH_TOKENS 才刷新，控制 LLM 调用成本）；
 *   - prev  = 上一段结束会话的冻结交接块。新会话开场 loadRecentThread 检测到
 *     active 归属别的会话 → seal（active→prev 冻结，active 重置为新会话），
 *     此后本会话 prev 恒不变 → system 前缀稳定、prompt cache 不破。
 *
 * 注入面：prepareChat → buildContext system 的 [Recent Threads] 块（≤ maxInjectTokens）。
 * 摘要只提炼为紧凑 prose（不带 verbatim 尾巴），省 token 同时保"接着上次聊"的连续感。
 */

export const RECENT_DEFAULTS = {
  minTokens: 1000,
  growthTokens: 800,
  maxTranscriptTokens: 3000,
  maxInjectTokens: 300,
} as const;

/** 交接摘要提示词：高密度紧凑正文，覆盖"进行到哪/未竟/提醒/结论" */
export const RECENT_SYSTEM_PROMPT = `你是会话交接摘要器。下面是一段对话转写。请给"下一个新会话"产出一段高密度交接摘要，让新会话不用重问就能接着干。
有则覆盖、无则略：
- 正在做什么 / 进行到哪一步（项目、话题、任务）
- 未完成、挂起的事项与下一步
- 用户明确提出的提醒 / 承诺 / 偏好 / 约束（特别是"下次提醒我…"这类要执行的指令）
- 本段达成的关键结论 / 决定 / 简短上下文
要求：1) 不超过 8 句精炼陈述句，保留专名/代号/技术名；不要用"用户说"开头转述，直接写事实。2) 只写影响后续的信息，丢寒暄与过程。3) 只输出摘要正文本身，不要任何标签、JSON 或解释。`;

/** 「该用户没配凭据」每用户只 warn 一次，避免每轮刷日志 */
const warnedNoKeyFor = new Set<string>();

export interface RecentRow {
  activeConversationId: string;
  activeSummaryText: string;
  lastSummarizedTokens: number;
}

export type RecentDecision = "skip" | "initial" | "refresh";

/**
 * 是否需要为本会话产出/刷新摘要（纯逻辑，可单测）。
 * - 会话累计 < minTokens → skip（短对话不碰 DB/LLM）；
 * - 无行或 active 空（本会话首次够长）→ initial；
 * - active 归属别的会话 → skip（交接由 loadRecentThread seal 负责，不让两处写打架）；
 * - 同会话距上次摘要增长 ≥ growthTokens → refresh。
 */
export function decideRecentSummarize(
  row: RecentRow | null,
  conversationId: string,
  currentTokens: number,
  minTokens: number,
  growthTokens: number,
): RecentDecision {
  if (currentTokens < minTokens) return "skip";
  if (!row || !row.activeConversationId) return "initial";
  if (row.activeConversationId !== conversationId) return "skip";
  if (!row.activeSummaryText) return "initial";
  if (currentTokens - row.lastSummarizedTokens >= growthTokens) return "refresh";
  return "skip";
}

function readRow(userId: string, profileId: string) {
  return getDb().query.conversationSummaries.findFirst({
    where: and(
      eq(conversationSummaries.userId, userId),
      eq(conversationSummaries.profileId, profileId),
    ),
  });
}

/** 写当前会话滚动摘要（upsert 单行）——摘要按 maxInjectTokens 截断后再落盘 */
async function upsertActive(input: {
  userId: string;
  profileId: string;
  conversationId: string;
  summaryText: string;
  summarizedTokens: number;
  maxInjectTokens: number;
}): Promise<void> {
  const text = truncateToTokens(input.summaryText.trim(), input.maxInjectTokens);
  await getDb()
    .insert(conversationSummaries)
    .values({
      userId: input.userId,
      profileId: input.profileId,
      activeConversationId: input.conversationId,
      activeSummaryText: text,
      lastSummarizedTokens: input.summarizedTokens,
    })
    .onConflictDoUpdate({
      target: [conversationSummaries.userId, conversationSummaries.profileId],
      set: {
        activeConversationId: input.conversationId,
        activeSummaryText: text,
        lastSummarizedTokens: input.summarizedTokens,
        updatedAt: new Date(),
      },
    });
}

/** 新会话接棒：active 冻结成 prev，active 重置为跟踪新会话（此后 prev 恒不变 → cache 稳定） */
async function sealToPrev(
  userId: string,
  profileId: string,
  row: RecentRow,
  nextConversationId: string,
  maxInjectTokens: number,
): Promise<void> {
  const text = truncateToTokens(row.activeSummaryText.trim(), maxInjectTokens);
  await getDb()
    .insert(conversationSummaries)
    .values({
      userId,
      profileId,
      prevConversationId: row.activeConversationId,
      prevSummaryText: text,
      prevSummaryTokens: row.lastSummarizedTokens,
      activeConversationId: nextConversationId,
    })
    .onConflictDoUpdate({
      target: [conversationSummaries.userId, conversationSummaries.profileId],
      set: {
        prevConversationId: row.activeConversationId,
        prevSummaryText: text,
        prevSummaryTokens: row.lastSummarizedTokens,
        activeConversationId: nextConversationId,
        activeSummaryText: "",
        lastSummarizedTokens: 0,
        updatedAt: new Date(),
      },
    });
}

/**
 * 会话开场读交接块（prepareChat 每轮调）。返回要在 system [Recent Threads] 注入的文本。
 * 首次进新会话 → seal 并返回上一会话摘要；继续原会话 → 返回已冻结的 prev（稳定）。
 * 任何 DB 失败静默降级空（不拖垮 chat）。
 */
export async function loadRecentThread(args: {
  userId: string;
  profileId: string;
  currentConversationId: string;
}): Promise<string> {
  const { userId, profileId, currentConversationId } = args;
  if (!currentConversationId) return "";
  const row = await readRow(userId, profileId).catch((err) => {
    console.warn("[recent-thread] 读交接块失败，本轮不注入:", err);
    return undefined;
  });
  if (!row) return "";
  const maxInject = env.RECENT_MAX_INJECT_TOKENS;
  // 新会话且上一会话已产过摘要 → 冻结成 prev，把上一会话的收尾交给新会话
  if (
    row.activeConversationId &&
    row.activeConversationId !== currentConversationId &&
    row.activeSummaryText
  ) {
    await sealToPrev(userId, profileId, row, currentConversationId, maxInject);
    return truncateToTokens(row.activeSummaryText, maxInject);
  }
  return truncateToTokens(row.prevSummaryText, maxInject);
}

/**
 * 回合结束后滚动刷新 active 摘要（fire-and-forget、吞错；与 maybeArchiveLongConversation 并列）。
 * 输入与写/归档同源（TurnMemoryInput）；会话累计 ≥ minTokens 才碰 DB，够长才调 ARCHIVE_PROVIDER 提炼。
 */
export async function maybeUpdateRecentThread(
  input: TurnMemoryInput,
): Promise<void> {
  if (!input.memoryEnabled) return;
  // 凭据可以只存在于 provider_configs（CLI 录入）→ 不能用 env 为空当门槛（同 memory-archive）

  const conversationId = conversationIdOf(input.messages);
  if (!conversationId) return;
  // 本地廉价门：短于阈值不碰 DB（每轮 ~0 成本）
  const currentTokens =
    estimateConversationTokens(input.messages) + estimateTokens(input.assistantContent);
  const minTokens = env.RECENT_MIN_TOKENS;
  if (currentTokens < minTokens) return;

  const row = (await readRow(input.userId, input.profileId).catch(() => null)) ?? null;
  const decision = decideRecentSummarize(
    row,
    conversationId,
    currentTokens,
    minTokens,
    env.RECENT_GROWTH_TOKENS,
  );
  if (decision === "skip") return;

  try {
    const transcript = buildTranscript(
      input.messages,
      input.assistantContent,
      env.RECENT_MAX_TRANSCRIPT_TOKENS,
    );
    if (!transcript.length) return;
    const model = await upstreamProvider(input.userId, env.ARCHIVE_PROVIDER);
    const result = await model.chat({
      model: env.ARCHIVE_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: RECENT_SYSTEM_PROMPT },
        ...transcript,
        { role: "user", content: "请产出交接摘要：" },
      ],
    });
    await upsertActive({
      userId: input.userId,
      profileId: input.profileId,
      conversationId,
      summaryText: result.content,
      summarizedTokens: currentTokens,
      maxInjectTokens: env.RECENT_MAX_INJECT_TOKENS,
    });
  } catch (err) {
    // 没配凭据是常见配置态（不是故障）→ warn 一次；其余错误才是真故障
    if (err instanceof ProviderError) {
      if (!warnedNoKeyFor.has(input.userId)) {
        warnedNoKeyFor.add(input.userId);
        console.warn("[recent-thread] 未配置提炼凭据，recent 摘要跳过：", err.message);
      }
      return;
    }
    console.error("[recent-thread] 摘要失败（下轮重试）:", err);
  }
}
