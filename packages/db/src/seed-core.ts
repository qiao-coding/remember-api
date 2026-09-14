/**
 * 种子逻辑（可复用）——`seed.ts` 是它的 CLI 壳，`apps/cli` 的本地向导直接调这里。
 *
 * 拆出来的原因：`seed.ts` 在模块顶层读 env、`process.exit`、import 即执行，
 * CLI 一旦 import 就会把进程带走。两端共用同一份数据定义，避免样例数据漂移。
 */
import { hashApiKey, maskApiKey, newId, PROVIDER_IDS } from "@remember/shared";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "./client.js";
import { apiKeys, profiles, projects, requestUsage, users } from "./schema.js";

export interface SeedUserOptions {
  userId: string;
  email?: string;
  name?: string;
  provider: string;
  model: string;
  /** API Key 哈希用的 pepper（与网关运行时必须是同一个） */
  pepper: string;
  /** 引导 Key 明文；只在建库那一次写进 api_keys（存的是哈希） */
  bootstrapApiKey: string;
}

export interface SeedUserResult {
  /** false = 该用户已有样例项目，本次只补了 bootstrap key */
  createdDemoData: boolean;
  /** bootstrap key 绑定的 Profile；null = 该用户还没有 Profile，key 跳过 */
  bootstrapProfileId: string | null;
}

/**
 * 不在精选短名单里不是错误：登记表是 models.dev 目录（200+ 家），
 * `PROVIDER_IDS` 只是控制台下拉/文档示例用的短名单。返回提示串供调用方打印。
 */
export function seedProviderWarning(provider: string): string | null {
  if (PROVIDER_IDS.includes(provider)) return null;
  return `SEED_PROVIDER=${provider} 不在精选短名单（${PROVIDER_IDS.join(" | ")}）内，按原样写入。`;
}

export async function seedUser(
  opts: SeedUserOptions,
  db: Db = getDb(),
): Promise<SeedUserResult> {
  const userId = opts.userId;
  const email = opts.email ?? "admin@remember.local";
  const name = opts.name ?? "Admin";

  // users 父行（幂等：已存在则跳过）
  await db
    .insert(users)
    .values({ id: userId, email, name })
    .onConflictDoNothing({ target: users.id });

  // 该用户已有样例项目 → 幂等跳过样例数据
  // ⚠️ projects 是这条幂等判定的哨兵：整块样例数据（含 profile）靠它判断"种过没有"。
  // 删掉这些样例项目，重跑种子会再插一个同名 profile（/v1/models 按名字查）。
  const userProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .limit(1);
  let createdDemoData = false;

  if (userProjects.length === 0) {
    await db.transaction(async (tx) => {
      const rememberProject = newId("proj");
      const citizenProject = newId("proj");

      await tx.insert(projects).values([
        {
          id: rememberProject,
          userId,
          name: "remember-api",
          description: "Stateful Personal AI API：跨 AI Harness 共享记忆",
          summary:
            "Fastify + PostgreSQL + Drizzle 的 OpenAI 兼容网关，记忆后端走 Mem0（Hermes 同款 provider）",
          architecture:
            "Monorepo（pnpm + turbo）：apps/api(Fastify) + apps/web(Next.js) + packages/*",
          status: "MVP 开发中：OpenAI 网关已规划，Mem0 记忆后端接入待联调",
          decisions: [
            "使用 Fastify 而非 NestJS：API 网关结构简单，不需要额外复杂度",
            "记忆/模型均通过 Adapter 抽象，避免被具体实现锁死",
          ],
          knownIssues: [],
          memoryNamespace: `ns_${rememberProject}`,
        },
        {
          id: citizenProject,
          userId,
          name: "citizen-zero",
          description: "AI 驱动 Galgame 项目",
          summary: "WebGAL + Express 架构，DeepSeek Flash 驱动",
          architecture: "水位式句子栈，[标记]格式输出",
          status: "章节管线已跑通，优化立绘表现",
          decisions: ["采用水位式句子栈控制对白节奏"],
          knownIssues: ["立绘表情 AI 生成方案待定"],
          memoryNamespace: `ns_${citizenProject}`,
        },
      ]);

      const profileId = newId("prof");
      await tx.insert(profiles).values({
        id: profileId,
        userId,
        name: "remember-dev",
        provider: opts.provider,
        model: opts.model,
        projectId: rememberProject,
        systemPrompt: `你是这位用户的私人 ai api的助理，你的底层调用并不是一个普通的agent，而是一个针对于用户的个人 ai api，你的底层调用类似大模型厂商的ai api一样，但是你是一个有拥有自己记忆的api。

这层身份并不覆盖你现在客户端的角色——你仍然是当前客户端里的你。

以下是来自用户来自api对话的过去的会话记录，可能包含用户在当前会话或者跨客户端的记忆：

- [User Preferences] — 他长期的习惯与偏好
- [Recent Threads] — 你们上次聊到哪、有什么没收尾
- [Relevant Memory] — 这一轮检索出来的相关记忆`,
        memoryEnabled: true,
        memoryBudget: 1500,
        skillIds: [],
      });

      // 不写样例记忆：记忆必须由用户自己长出来。替用户预设事实（"用户偏好 X"）
      // 会跟着每一轮注入进 prompt，而每个用户的使用场景都不一样。

      await tx.insert(requestUsage).values({
        id: newId("usage"),
        userId,
        profileId,
        projectId: rememberProject,
        provider: opts.provider,
        model: opts.model,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        memoryTokens: 0,
        skillTokens: 0,
        latencyMs: 0,
        estimatedCost: 0,
      });
    });
    createdDemoData = true;
  }

  // 确保 bootstrap API key 存在（幂等）。新约束：key 必须绑定一个个人 model。
  const { prefix, last4 } = maskApiKey(opts.bootstrapApiKey);
  const bootstrapProfile = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .orderBy(profiles.createdAt)
    .limit(1);
  const bootstrapProfileId = bootstrapProfile[0]?.id ?? null;
  if (bootstrapProfileId) {
    await db
      .insert(apiKeys)
      .values({
        id: newId("key"),
        userId,
        name: "bootstrap",
        profileId: bootstrapProfileId,
        prefix,
        last4,
        hash: hashApiKey(opts.bootstrapApiKey, opts.pepper),
      })
      .onConflictDoNothing({ target: apiKeys.hash });
  }

  return { createdDemoData, bootstrapProfileId };
}
