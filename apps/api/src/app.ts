import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { apiKeyAuthHook } from "./plugins/api-key-auth.js";
import { openAiRoutes } from "./routes/openai.js";
import { managerRoutes } from "./routes/manager/index.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
  });

  app.register(cors, {
    origin: true, // MVP 单用户，放开；生产应限定域名
  });

  // 健康检查
  app.get("/health", async () => ({ ok: true, service: "remember-api" }));

  // OpenAI-compatible 网关（API Key 鉴权）
  app.register(openAiRoutes, { prefix: "/v1" });

  // 管理后台（Supabase JWT 鉴权）——auth 模块与网关解耦：
  // SUPABASE_URL 为空 = 网关-only 模式（只跑 /v1 + /health，不挂 /api），api 网关可独立部署。
  if (env.SUPABASE_URL) {
    app.register(managerRoutes, { prefix: "/api" });
  } else {
    app.log.warn(
      "SUPABASE_URL 未配置：/api 管理路由未挂载（网关-only 模式，仅 /v1 + /health）",
    );
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    // OpenAI 兼容错误格式（对 /v1 请求）
    if (req.url.startsWith("/v1")) {
      const status = err.statusCode ?? 500;
      void reply.status(status).send({
        error: {
          message: err.message,
          type: err.name,
          code:
            status === 401
              ? "invalid_api_key"
              : status === 404
                ? "model_not_found"
                : "api_error",
          param: null,
        },
      });
      return;
    }
    app.log.error(err);
    void reply.status(err.statusCode ?? 500).send({ error: err.message });
  });

  return app;
}
