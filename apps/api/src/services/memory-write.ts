import type { ChatMessage } from "@remember/shared";
import { createMemoryProvider } from "@remember/memory";
import { env } from "../env.js";

/**
 * 回合结束后的记忆写入（异步、fire-and-forget）。
 *
 * 写侧策略（薄桥，不造轮子）：
 *  - 短窗：把**最后一条 user 消息**逐字存进 mem0 —— 仅当它是"看起来耐久的事实陈述"
 *    （结构化护栏过滤疑问/请求/确认，不含任何内容信号词）。type 一律 preference、importance 0.8。
 *    去重交给 mem0 服务端（同 content hash 兜精确重复）+ 检索时 relevance 排序（不精确/改写的重复不炸桶）。
 *  - 长对话 / 跨轮脉络事实：交给 maybeArchiveLongConversation 单轮 LLM 提炼（见 memory-archive.ts）。
 *  - 不再有 8 条规则引擎、无 per-type importance 归类、无 30 行 list 归一化判重。
 */

export interface TurnMemoryInput {
  userId: string;
  projectId: string | null;
  profileId: string;
  providerName: string;
  userMessage: string;
  assistantContent: string;
  /** 原始 req.messages（供长对话归档层用，含完整累积历史） */
  messages: ChatMessage[];
  /** 用户级 + 请求级双重开关；false 时短窗写入与归档都应跳过 */
  memoryEnabled: boolean;
}

/** 逐字记忆的条长护栏 */
const MIN_FACT_CHARS = 4;
const MAX_FACT_CHARS = 160;

const QUESTION_END_RE = /[？?]\s*$/;
const SOFT_QUESTION_RE = /(吗|呢|好不好|行不行|怎么样)\s*$/;
const REQUEST_START_RE =
  /^(帮我|请帮我|帮我一下|请给我|给我|你能|你可不可以|可不可以帮我|帮我看看|帮我写|帮我改|帮我做|请用|请解释)/;
const ACK_START_RE = /^(好的|好|嗯|嗯嗯|对|对的|明白|可以|没问题|谢谢|感谢|ok|okay|知道了|收到)/i;

/** 是否为值得逐字入库的耐久陈述：非疑问/非请求/非确认、有实质字符、条长护栏内 */
export function looksLikeFact(userMessage: string): boolean {
  const t = (userMessage ?? "").trim();
  if (t.length < MIN_FACT_CHARS || t.length > MAX_FACT_CHARS) return false;
  if (QUESTION_END_RE.test(t) || SOFT_QUESTION_RE.test(t)) return false;
  if (REQUEST_START_RE.test(t)) return false;
  if (ACK_START_RE.test(t)) return false;
  // 全标点/符号（无实质内容）不入库
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return false;
  return true;
}

export async function writeTurnMemories(input: TurnMemoryInput): Promise<void> {
  const provider = createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
  // 未配置记忆后端（Db/noop mock）→ 早退，保持写操作零成本
  if (!provider.enabled) return;
  // 记忆被禁用：写与归档都跳过
  if (!input.memoryEnabled) return;
  // 只逐字存"耐久陈述"；其余交给长对话 LLM 提炼
  if (!looksLikeFact(input.userMessage)) return;

  try {
    await provider.write({
      userId: input.userId,
      projectId: input.projectId,
      type: "preference",
      content: input.userMessage.trim(),
      importance: 0.8,
      source: input.providerName,
    });
  } catch (err) {
    console.error("[memory-write] 写入失败:", err);
  }
}
