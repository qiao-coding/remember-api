/**
 * remember-api CLI 入口。
 *
 * 形态：一个 npm 包（bin = dist/cli.js），网关作为**同进程**起在这里 —— 不做子进程编排，
 * 于是只有一个产物、一份 bundle，没有 cwd / `process.loadEnvFile()` 的路径地雷。
 *
 * ⚠️ 本文件（及 commands / init / smoke）不得静态 import `@remember/api/*`：
 * 那边 env.ts 在模块加载时就 parse `process.env`，静态引用会让「还没配置」的
 * `npx remember-api --help` 直接崩在 DATABASE_URL 缺失上。一律动态 import。
 */
import { log } from "@clack/prompts";
import { requireConfig, runConnect, runDoctor, runKey, runModelAdd, runModelList, runModelUse, runStatus, runUp } from "./commands.js";
import { readConfig } from "./config.js";
import { CancelledError, NeedsInteractiveError } from "./prompt.js";
import { type InitOptions, runInit } from "./init.js";
import { parseInitFlags, parseUpFlags } from "./flags.js";

const HELP = `remember-api —— 本机 OpenAI 兼容网关（带跨客户端记忆）

用法：
  remember-api init              向导：建库 → 选厂商/模型 → 录 Key → 自检
  remember-api up [--port N]     起网关（前台运行，Ctrl-C 停止）
  remember-api status            doctor：配置 / 数据库 / 凭据 / 端口
  remember-api connect           打印 Base URL + API Key + Model（贴进任意客户端）

  remember-api model             列出已配置的厂商与当前指向
  remember-api model use [p/m]   切模型（不给参数则交互选择，即刻生效、不重启）
  remember-api model add         新增一个厂商的 Key（交互）

  remember-api key               列出 API Key
  remember-api key new [名字]    新建一把（明文只显示一次）

  remember-api doctor            起个临时网关自检 Key 与 Profile 是否对得上
  remember-api --help            本帮助

init 的无人值守写法（脚本 / CI；也是非 TTY 下唯一可行的写法）：
  remember-api init --yes --url <连接串> --provider deepseek --model deepseek-v4-flash --key <API Key>
    --url <连接串>      Postgres 连接串（不给 --port 时必填）
    --port N            用 docker 起一个 postgres:16 并映射到 N（需要 docker daemon）
    --migrate-url <连接串>  迁移/建表单独走一条（Supabase 的池化串会自动推，一般不用给）
    --provider/--model  厂商与模型 id（见 models.dev 目录）
    --base-url <URL>    目录里没有端点的厂商（openai / anthropic …）需要显式给
    --key <API Key>     该厂商的 Key；不给则沿用库里已存的，再看该厂商约定的环境变量

环境变量：
  REMEMBER_API_HOME              配置目录（默认 ~/.remember-api）`;

/**
 * @returns 该命令是不是「长驻」的（`up` 要留着进程服务请求，其余都是一次性）
 */
export async function main(argv: string[]): Promise<void> {
  const keepAlive = await dispatch(argv);
  if (keepAlive) return;

  // 一次性命令必须断开连接池，否则池的 keep-alive 让事件循环永不空闲：
  // 命令跑完了、输出也打了，但 node 不退出，用户看到的是一个不回来的光标。
  const { closeDb } = await import("@remember/db");
  await closeDb();
}

async function dispatch(argv: string[]): Promise<boolean> {
  const [cmd = "up", ...rest] = argv;

  switch (cmd) {
    case "--help":
    case "-h":
    case "help":
      console.log(HELP);
      return false;

    case "--version":
    case "-v":
      console.log(await version());
      return false;

    case "init":
      await runInit(parseInitFlags(rest));
      return false;

    case "up": {
      const config = await requireConfig();
      if (!config) return false;
      await runUp(config, parseUpFlags(rest));
      return true; // 网关要留着进程服务请求
    }

    case "status": {
      const config = await requireConfig();
      if (!config) return false;
      await runStatus(config);
      return false;
    }

    case "connect": {
      const config = await requireConfig();
      if (!config) return false;
      await runConnect(config);
      return false;
    }

    case "doctor": {
      const config = await requireConfig();
      if (!config) return false;
      await runDoctor(config);
      return false;
    }

    case "model": {
      const config = await requireConfig();
      if (!config) return false;
      const sub = rest[0];
      if (!sub || sub === "list") await runModelList(config);
      else if (sub === "use") await runModelUse(config, rest[1]);
      else if (sub === "add") await runModelAdd(config);
      else {
        log.error(`未知子命令：model ${sub}（可用：list | use | add）`);
        process.exitCode = 1;
      }
      return false;
    }

    case "key": {
      const config = await requireConfig();
      if (!config) return false;
      await runKey(config, rest);
      return false;
    }

    default:
      // 裸命令：没配置过就走向导，配好了就起网关
      if (cmd.startsWith("-")) {
        log.error(`未知选项：${cmd}`);
        console.log(HELP);
        process.exitCode = 1;
        return false;
      }
      if (await readConfig()) {
        const config = await requireConfig();
        if (!config) return false;
        await runUp(config);
        return true;
      }
      await runInit();
      return false;
  }
}

/** 从自身 package.json 读版本，不额外维护常量 */
async function version(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(join(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

void main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CancelledError) {
    console.log("\n已取消（已完成的步骤都已写入配置，重跑可接着走）");
    process.exit(130);
  }
  if (err instanceof NeedsInteractiveError) {
    console.error(`[cli] ${err.message}`);
    process.exit(1);
  }
  console.error("[cli] 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
