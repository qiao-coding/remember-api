import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // 与 tsconfig 的 "@/*" 对齐，便于测试里直接用业务别名
    alias: { "@": root },
  },
  // 渲染冒烟直接编 .tsx 为 react 自动运行时。tsconfig jsx 为 preserve（Next），
  // 若不让 JSX 走自动运行时，编译会退回 classic React.createElement → 组件不 import React 全炸。
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node", // 纯逻辑单测 + renderToStaticMarkup 冒烟，都不需要 jsdom
    include: ["lib/**/*.test.ts", "components/**/__tests__/*.test.tsx"],
  },
});
