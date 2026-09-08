import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // 工作区 packages 直接打包进产物，避免运行时依赖未构建的源文件
  noExternal: [
    "@remember/core",
    "@remember/db",
    "@remember/memory",
    "@remember/providers",
    "@remember/shared",
  ],
});
