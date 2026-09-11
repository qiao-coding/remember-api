/**
 * 构建期把 packages/db 的两个**非 JS** 资源拷进 CLI 包：
 *
 * - `drizzle/` 迁移 SQL —— esbuild 不会内联 .sql，包体积里必须自己带上；
 * - `certs/` —— client.ts 按「相对自身位置的 ../certs」找 Supabase 根 CA，
 *   打进 bundle 后这个相对路径落在 CLI 包根。
 *
 * 路径通过 pnpm 的 `node_modules/@remember/db` 符号链接解析，不硬编码仓库布局，
 * 也不含用户名绝对路径。
 */
import { cpSync, existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbRoot = realpathSync(join(pkgRoot, "node_modules", "@remember", "db"));

const assets = [
  { from: join(dbRoot, "drizzle"), to: join(pkgRoot, "drizzle") },
  { from: join(dbRoot, "certs"), to: join(pkgRoot, "certs") },
];

for (const { from, to } of assets) {
  if (!existsSync(from)) {
    console.warn(`⚠️  跳过（源不存在）: ${from}`);
    continue;
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`✅ ${from} → ${to}`);
}
