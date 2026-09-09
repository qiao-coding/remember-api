import type { FunctionTool } from "@remember/providers";
import { createMemoryProvider } from "@remember/memory";
import { env } from "../env.js";

/**
 * 内置记忆检索工具 —— 声明给上游 LLM，由网关内 agentic loop 执行。
 * 客户端零感知：它发普通 chat，tools/执行都在网关内部。
 */

export const RECALL_MEMORY_TOOL: FunctionTool = {
  type: "function",
  name: "recall_memories",
  description:
    "从长期记忆库检索与 query 相关的历史记忆（用户偏好、决定、项目状态、未竟任务等），返回若干条纯文本。当用户问及“上次说过/定过/偏好/正在做的事/提醒”，或需要跨会话上下文时调用。",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "自然语言检索词，聚焦想找回的信息（如：技术栈、代号、偏好）",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "最多返回条数，默认 5",
      },
    },
    required: ["query"],
  },
};

/** system 区 [Memory] 提示：告诉模型它手里有这工具（约 30 token，值得） */
export const RECALL_TOOL_HINT =
  "你有长期记忆：需要用户偏好/决定/上次会话上下文时，调用 recall_memories(query) 按需检索。";

export interface RecallDeps {
  userId: string;
  projectId: string | null;
}

function memoryProvider() {
  return createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
}

function clampLimit(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * 内部执行 recall_memories：search 绑定桶 → 纯文本列表。
 * 任何失败都返回友好降级文本（不 throw）——工具轮不能拖垮整轮对话。
 */
export async function runRecall(
  deps: RecallDeps,
  input: { query?: unknown; limit?: unknown },
): Promise<string> {
  const provider = memoryProvider();
  if (!provider.enabled) return "（记忆后端未配置：本次未检索）";
  const query =
    typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
  if (!query) return "（检索词为空：请提供 query）";
  try {
    const hits = await provider.search({
      userId: deps.userId,
      projectId: deps.projectId,
      query,
      limit: clampLimit(input.limit) ?? 5,
    });
    if (!hits.length) return "（未检索到相关记忆）";
    return hits
      .map((m, i) => `${i + 1}. (${m.type}) ${m.content.trim()}`)
      .join("\n");
  } catch (err) {
    console.warn("[memory-tool] recall 失败:", err);
    return "（记忆检索失败，请基于已知信息回答）";
  }
}
