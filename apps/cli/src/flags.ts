/**
 * 命令行参数解析 —— 单独一层，因为 `cli.ts` 在模块末尾就 `void main(...)`：
 * 从那里 import 任何东西都会把整个 CLI 跑起来，测试没法碰。
 *
 * 语义统一为「给了就用，没给就问」：解析只负责把参数收成对象，不问、不猜、不校验业务含义
 * （取值合法性只在明显写错时 warn 一句，剩下的交给下游报错 —— 下游的报错带上下文）。
 */
import { log } from "@clack/prompts";
import type { InitOptions } from "./init.js";

/** 取 `--flag value` / `--flag=value`；返回下一个待处理的索引（没消耗就不前进） */
function flagValue(args: string[]) {
  return (i: number, inline: string): { value?: string; i: number } => {
    if (inline) return { value: inline.trim(), i };
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) return { value: undefined, i };
    return { value: next.trim(), i: i + 1 };
  };
}

/** `--flag=value` → ["--flag", "value"]；`--flag` → ["--flag", ""] */
export function splitFlag(arg: string): [string, string] {
  const eq = arg.indexOf("=");
  return eq < 0 ? [arg, ""] : [arg.slice(0, eq), arg.slice(eq + 1)];
}

export function parseInitFlags(args: string[]): InitOptions {
  const opts: InitOptions = {};
  const take = flagValue(args);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const [flag, inline = ""] = splitFlag(arg);

    if (flag === "--yes" || flag === "-y") {
      opts.yes = true;
      continue;
    }

    const { value, i: next } = take(i, inline);
    i = next;
    if (value === undefined) {
      log.warn(flag.startsWith("-") ? `${flag} 没给值，忽略` : `init 不认识这个参数，忽略：${flag}`);
      continue;
    }

    switch (flag) {
      case "--url":
        opts.url = value;
        break;
      case "--migrate-url":
        opts.migrateUrl = value;
        break;
      case "--port": {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0 || n >= 65536) log.warn(`--port 值不合法，忽略：${value}`);
        else opts.port = n;
        break;
      }
      case "--host":
        opts.host = value;
        break;
      case "--provider":
        opts.provider = value;
        break;
      case "--model":
        opts.model = value;
        break;
      case "--base-url":
        opts.baseUrl = value;
        break;
      case "--key":
        opts.key = value;
        break;
      default:
        log.warn(`init 不认识这个参数，忽略：${flag}`);
    }
  }
  return opts;
}

export function parseUpFlags(args: string[]): { port?: number; host?: string } {
  const opts: { port?: number; host?: string } = {};
  const take = flagValue(args);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const [flag, inline = ""] = splitFlag(arg);

    if (flag !== "--port" && flag !== "--host") {
      log.warn(`up 不认识这个参数，忽略：${arg}`);
      continue;
    }

    const { value, i: next } = take(i, inline);
    i = next;
    if (value === undefined) {
      log.warn(`${flag} 没给值，忽略`);
      continue;
    }
    if (flag === "--host") {
      opts.host = value;
      continue;
    }
    const n = Number(value);
    if (Number.isInteger(n) && n > 0 && n < 65536) opts.port = n;
    else log.warn(`--port 值不合法，忽略：${value}`);
  }
  return opts;
}
