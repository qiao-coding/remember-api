/**
 * @clack/prompts 的薄封装：把「用户取消」变成可捕获的异常，让每一步都能统一收尾。
 *
 * Ctrl-C / Esc 在 clack 里返回一个 symbol 而不是抛错；不 unwrap 就会一路带着
 * symbol 往下走，最后在某个 JSON.stringify 或 DB 写入处才炸，且报错完全看不懂。
 */
import { isCancel } from "@clack/prompts";

export class CancelledError extends Error {
  constructor() {
    super("已取消");
    this.name = "CancelledError";
  }
}

/**
 * 需要交互但拿不到终端。
 *
 * @clack/prompts 只在 **TTY** 上工作：stdin 是管道/重定向时它收不到「回车」，
 * 于是第一个 prompt 永不 resolve，事件循环空了，node 以 0 退出 ——
 * 用户看到的是「命令跑完了、什么都没发生、退出码还是成功」。宁可报错。
 */
export class NeedsInteractiveError extends Error {
  constructor(command: string, hint: string) {
    super(
      `${command} 需要交互式终端，而当前 stdin 不是终端（管道 / 重定向 / CI）。\n` +
        `非交互写法：${hint}`,
    );
    this.name = "NeedsInteractiveError";
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) throw new CancelledError();
  return value as T;
}

/**
 * 必填文本。
 * 入参带 `| undefined`：clack 的 `Validate<string>` 就是这么声明的（空输入给 undefined），
 * 收窄成 `string` 会让所有调用点都编不过。
 */
export function required(label: string) {
  return (value: string | undefined): string | undefined =>
    value?.trim() ? undefined : `${label}不能为空`;
}

/** 校验一个 http(s) 端点 */
export function validateUrl(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return "端点不能为空";
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "端点必须是 http(s) 开头";
    }
    return undefined;
  } catch {
    return "不是合法的 URL（示例：https://api.deepseek.com）";
  }
}

/** 单行展示：把可能很长的 key 截断到中间 */
export function shorten(value: string, keep = 6): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
