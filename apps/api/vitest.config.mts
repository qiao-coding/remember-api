import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // 对齐 tsconfig（api 内部多用相对导入，别名备用）
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // env.ts 在 import 时 EnvSchema.parse —— setupFiles 先喂最小假 env，避免静态导入即抛
    setupFiles: ["src/test-setup.ts"],
  },
});
