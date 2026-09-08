import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, profiles } from "@remember/db";
import type { ChatCompletion, ChatCompletionRequest } from "@remember/shared";
import { apiKeyAuthHook } from "../plugins/api-key-auth.js";
import {
  prepareChat,
  ProfileNotAllowedError,
  ProfileNotFoundError,
  ProjectNotFoundError,
  runChat,
  streamChat,
} from "../services/chat.js";

const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
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
    const body = ChatBodySchema.parse(req.body) as ChatCompletionRequest;
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
      if (err instanceof ProjectNotFoundError) {
        return reply.code(404).send({
          error: {
            message: err.message,
            type: "invalid_request_error",
            code: "project_not_found",
            param: "remember.project",
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
