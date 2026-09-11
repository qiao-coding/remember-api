import type { FastifyInstance } from "fastify";
import { hasAnyProviderCredential } from "@remember/db";
import { buildApp } from "./app.js";
import { env } from "./env.js";

/**
 * 启动网关。
 *
 * 抽成函数（而不是写在 index.ts 的模块体里）是为了让 CLI 能在**同进程**里起网关：
 * CLI import 本模块即可，不会因为 import 就自启。`src/index.ts` 退化成一行薄壳，
 * 于是 `pnpm dev` / Docker 的行为完全不变。
 */
export async function startServer(): Promise<{ app: FastifyInstance; url: string }> {
  const app = buildApp();

  // 成对性体检：ARCHIVE_PROVIDER 换了但 ARCHIVE_MODEL 没换，归档会把 deepseek-chat
  // 这个模型名发到别家端点上，每轮 400
  if (env.ARCHIVE_PROVIDER !== "deepseek" && env.ARCHIVE_MODEL === "deepseek-chat") {
    app.log.warn(
      `ARCHIVE_PROVIDER=${env.ARCHIVE_PROVIDER} 但 ARCHIVE_MODEL 仍是 deepseek-chat，` +
        "归档/recent 摘要会拿这个模型名去问别家端点，多半每轮 400。请成对设置这两个变量。",
    );
  }

  const url = await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`remember-api listening on ${url}`);

  void warnIfNoCredential(app);
  return { app, url };
}

/**
 * 凭据现在既可能在 provider_configs（CLI 录入），也可能在 env —— 两处都空才是「哑」。
 *
 * fire-and-forget 且吞错：DB 不可达时进程仍须起来服务 /health，真实错误留给请求期。
 */
async function warnIfNoCredential(app: FastifyInstance): Promise<void> {
  try {
    if (env.UPSTREAM_API_KEY.trim() || (await hasAnyProviderCredential())) return;
    app.log.warn(
      "[boot] 没有任何 provider 凭据（provider_configs 与 UPSTREAM_API_KEY 均空）：" +
        "上游走 MockProvider，回复是本地假数据，不会真的调用模型。",
    );
  } catch {
    // DB 不可达：静默，请求期会给出真实错误
  }
}
