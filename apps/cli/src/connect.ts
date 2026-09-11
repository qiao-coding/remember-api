/**
 * 「三件套」输出 —— Base URL / API Key / Model。
 *
 * `init` 收尾、`up` 启动、`connect` 三个入口共用同一份文案：用户要填进客户端的东西
 * 只应该在一处定义，否则改了一处另一处就开始骗人。
 */
import { note } from "@clack/prompts";
import type { CliConfig } from "./config.js";

export interface Trio {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export function trioOf(config: CliConfig, port = config.server.port): Trio {
  return {
    baseUrl: `http://${config.server.host}:${port}/v1`,
    apiKey: config.apiKey?.value ?? null,
    model: config.apiKey?.profileName ?? "remember-dev",
  };
}

/** 打印可粘贴进任意 OpenAI 兼容客户端的配置 */
export function printConnect(config: CliConfig, port = config.server.port): void {
  const trio = trioOf(config, port);
  const lines = [
    `Base URL  ${trio.baseUrl}`,
    `API Key   ${trio.apiKey ?? "（未生成，运行 remember-api key new）"}`,
    `Model     ${trio.model}`,
  ];
  note(lines.join("\n"), "接进客户端（OpenAI 兼容）");
}
