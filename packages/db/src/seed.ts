/**
 * 种子数据：给指定的 Supabase 用户（SEED_USER_ID）灌样例项目/Profile/记忆 + 引导 API Key。
 * 用户不再由种子创建（用户来自 Supabase Auth），只需把 seed 指向其 auth uid。
 * 运行前需确保已执行迁移且 DATABASE_URL 可用。
 *
 * 用法：SEED_USER_ID=<supabase-uid> pnpm db:seed
 */
import { hashApiKey, maskApiKey, newId } from "@remember/shared";
import { eq } from "drizzle-orm";
import { getDb } from "./index.js";
import { apiKeys, memories, profiles, projects, requestUsage, users } from "./schema.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ ${name} 未设置`);
    process.exit(1);
  }
  return value;
}

const DB_URL = requireEnv("DATABASE_URL");
const SEED_USER_ID = requireEnv("SEED_USER_ID");
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? "admin@remember.local";
const SEED_USER_NAME = process.env.SEED_USER_NAME ?? "Admin";
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_API_KEY ?? "rma_bootstrap_local";
const PEPPER = process.env.API_KEY_PEPPER ?? "change-me-in-production";

async function main() {
  const db = getDb();

  // users 父行（幂等：已存在则跳过）
  await db
    .insert(users)
    .values({ id: SEED_USER_ID, email: SEED_USER_EMAIL, name: SEED_USER_NAME })
    .onConflictDoNothing({ target: users.id });

  // 该用户已有样例项目 → 幂等跳过样例数据
  const userProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, SEED_USER_ID))
    .limit(1);
  if (userProjects.length > 0) {
    console.log("ℹ️  该用户已有样例项目，跳过样例数据（仅确保 bootstrap key 存在）");
  } else {
    await db.transaction(async (tx) => {
      const rememberProject = newId("proj");
      const citizenProject = newId("proj");

      await tx.insert(projects).values([
        {
          id: rememberProject,
          userId: SEED_USER_ID,
          name: "remember-api",
          description: "Stateful Personal AI API：跨 AI Harness 共享记忆",
          summary: "Fastify + PostgreSQL + Drizzle 的 OpenAI 兼容网关，记忆后端走 Mem0（Hermes 同款 provider）",
          architecture: "Monorepo（pnpm + turbo）：apps/api(Fastify) + apps/web(Next.js) + packages/*",
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
          userId: SEED_USER_ID,
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
        userId: SEED_USER_ID,
        name: "remember-dev",
        provider: "deepseek",
        model: "deepseek-chat",
        projectId: rememberProject,
        systemPrompt: "你是 remember-api 的核心开发者，代码风格：简洁、类型安全、避免过度抽象。",
        memoryEnabled: true,
        memoryBudget: 1500,
        skillIds: [],
      });

      await tx.insert(memories).values([
        {
          id: newId("mem"),
          userId: SEED_USER_ID,
          projectId: rememberProject,
          type: "decision",
          content: "remember-api 使用 Fastify 作为 API Server，而非 NestJS",
          importance: 0.9,
          pinned: true,
          source: "seed",
        },
        {
          id: newId("mem"),
          userId: SEED_USER_ID,
          projectId: rememberProject,
          type: "preference",
          content: "用户偏好 TypeScript，倾向简单实现而不是过度抽象",
          importance: 0.8,
          pinned: true,
          source: "seed",
        },
        {
          id: newId("mem"),
          userId: SEED_USER_ID,
          projectId: rememberProject,
          type: "status",
          content: "MVP：OpenAI 兼容网关 + Profile/Project/Memory 链路搭建中",
          importance: 0.7,
          pinned: false,
          source: "seed",
        },
        {
          id: newId("mem"),
          userId: SEED_USER_ID,
          projectId: null,
          type: "preference",
          content: "用户主要使用 TypeScript，偏好 React 函数组件",
          importance: 0.8,
          pinned: true,
          source: "seed",
        },
      ]);

      await tx.insert(requestUsage).values({
        id: newId("usage"),
        userId: SEED_USER_ID,
        profileId,
        projectId: rememberProject,
        provider: "deepseek",
        model: "deepseek-chat",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        memoryTokens: 0,
        skillTokens: 0,
        latencyMs: 0,
        estimatedCost: 0,
      });
    });
    console.log("✅ 样例数据写入完成");
  }

  // 确保 bootstrap API key 存在（幂等）。新约束：key 必须绑定一个个人 model。
  const { prefix, last4 } = maskApiKey(BOOTSTRAP_KEY);
  // 找该用户已有的 remember-dev profile（seed 在下方/else 分支里创建），绑定之。
  const bootstrapProfile = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, SEED_USER_ID))
    .orderBy(profiles.createdAt)
    .limit(1);
  const bindProfileId = bootstrapProfile[0]?.id ?? null;
  if (!bindProfileId) {
    console.warn("⚠️  未找到该用户的 profile，bootstrap key 无法绑定个人 model，将跳过");
  } else {
    await db
      .insert(apiKeys)
      .values({
        id: newId("key"),
        userId: SEED_USER_ID,
        name: "bootstrap",
        profileId: bindProfileId,
        prefix,
        last4,
        hash: hashApiKey(BOOTSTRAP_KEY, PEPPER),
      })
      .onConflictDoNothing({ target: apiKeys.hash });
  }

  console.log(`   用户: ${SEED_USER_EMAIL} (${SEED_USER_ID})`);
  console.log(`   引导 API Key: ${BOOTSTRAP_KEY}`);
  process.exit(0); // 一次性 CLI：显式退出，避免连接池 keep-alive 挂住进程
}

main().catch((err) => {
  console.error("❌ 种子失败:", err);
  process.exit(1);
});
