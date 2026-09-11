import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, profiles } from "@remember/db";
import { ProviderError } from "@remember/providers";
import type { ChatCompletion, ChatCompletionRequest } from "@remember/shared";
import { apiKeyAuthHook } from "../plugins/api-key-auth.js";
import {
  prepareChat,
  ProfileNotAllowedError,
  ProfileNotFoundError,
  runChat,
  streamChat,
} from "../services/chat.js";

// content 容忍 OpenAI chat 两种合法形态：字符串 或 多段 part 数组（{type:"text",text}），
// chat.ts 统一归一为纯文本再送上游（DeepSeek 不收数组）。
const ChatContentSchema = z
  .union([
    z.string(),
    z.array(z.union([z.string(), z.object({ text: z.string().optional() })])),
    z.null(),
  ])
  .optional();

const ChatMessageSchema = z.object({
  // 容忍 developer 角色（Codex/部分客户端经 CC-Switch 桥接会带）；chat.ts 归一为 system 送上游。
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: ChatContentSchema,
});

const ChatBodySchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  remember: z
    .object({
      project: z.string().optional(),
      memory: z.boolean().optional(),
      memoryBudget: z.number().int().min(0).max(100000).optional(),
    })
    .optional(),
});

/** OpenAI-compatible 网关：/v1/*（API Key 鉴权） */
export async function openAiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", apiKeyAuthHook);

  app.get("/models", async (req) => {
    // 每个 key 绑定一个个人 model（子 agent），仅暴露它绑的那一个。
    const rows = await getDb().query.profiles.findMany({
      where: and(eq(profiles.userId, req.user!.id), eq(profiles.id, req.user!.keyProfileId)),
    });
    return {
      object: "list",
      data: rows.map((r) => ({ id: r.name, object: "model", owned_by: r.provider })),
    };
  });

  app.post("/chat/completions", async (req, reply) => {
    let body: ChatCompletionRequest;
    try {
      body = ChatBodySchema.parse(req.body) as ChatCompletionRequest;
    } catch (err) {
      // 实锤：CC-Switch/Codex 桥的 400 往往卡在入站 schema——把被拒的原始体打出来定位
      console.error(
        "[v1] 入站体被 schema 拒绝:",
        JSON.stringify(req.body)?.slice(0, 2000),
        "\n  原因:",
        (err as Error).message,
      );
      throw err;
    }
    const userId = req.user!.id;

    let prepared;
    try {
      prepared = await prepareChat(userId, body, req.user!.keyProfileId);
    } catch (err) {
      if (err instanceof ProfileNotAllowedError) {
        return reply.code(403).send({
          error: {
            message: err.message,
            type: "profile_not_allowed",
            code: "profile_not_allowed",
            param: err.param,
          },
        });
      }
      if (err instanceof ProfileNotFoundError) {
        return reply.code(404).send({
          error: {
            message: err.message,
            type: "model_not_found",
            code: "model_not_found",
            param: "model",
          },
        });
      }
      // 上游没配好（如 custom Profile 但 UPSTREAM_BASE_URL 为空）→ 400 原样透给客户端，
      // 否则这里会变成一句没有信息量的 500。
      if (err instanceof ProviderError) {
        return reply.code(400).send({
          error: {
            message: err.message,
            type: "invalid_request_error",
            code: "provider_not_configured",
            param: "model",
          },
        });
      }
      throw err;
    }

    // ── 非流式 ──
    if (!body.stream) {
      const result = await runChat(prepared, body);
      const resp: ChatCompletion = {
        id: "chatcmpl-" + crypto.randomUUID(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.content },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.promptTokens + result.usage.completionTokens,
          prompt_tokens_details: { cached_tokens: result.usage.cachedTokens },
        },
      };
      return resp;
    }

    // ── SSE 流式 ──
    reply.header("Content-Type", "text/event-stream; charset=utf-8");
    reply.header("Cache-Control", "no-cache, no-transform");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");
    return reply.send(Readable.from(streamChat(prepared, body)));
  });
}
