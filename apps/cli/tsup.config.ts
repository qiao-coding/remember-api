import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  /**
   * 必需，两段都不能删：
   *
   * 1) `createRequire` 版 require —— fastify 是 CJS，内联进 ESM 产物后它的
   *    `require("events")` 会落到 esbuild 的 `__require` 兜底上（该兜底在初始化时
   *    探测 `typeof require`，没有就抛 "Dynamic require of \"events\" is not supported"）。
   *    第一版漏了这段，网关在启动瞬间就崩。
   * 2) `shims: true` —— 给 CJS 依赖补 `__dirname`/`__filename`。
   */
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __rememberCreateRequire } from "node:module";',
      "const require = __rememberCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  shims: true,
  /**
   * 全部内联 → `dist/cli.js` 单文件自包含，`npx remember-api` 只下一个文件。
   *
   * 工作区包（@remember/*）也在内联范围内：它们在 registry 上不存在，产物里若留成
   * `import "@remember/db"` 就是必然 404。
   *
   * ⚠️ 已知雷区（改动前先读）：fastify → pino → thread-stream 在 4.x 里按 `__dirname`
   * 拼路径去起 worker（`join(__dirname, "lib", "worker.js")`）。esbuild 看不见这种动态拼接，
   * **只在配置了 pino `transport` 时**才会在运行期 ENOENT。网关的 logger 至今只给
   * `{ level }`、没有 transport，所以内联是安全的 —— 但**不要**给网关 logger 加 transport，
   * 加了就必须把 pino 系（pino / thread-stream / sonic-boom / pino-pretty）从内联里摘出去
   * 并写进 dependencies。
   */
  noExternal: [/.*/],
});
