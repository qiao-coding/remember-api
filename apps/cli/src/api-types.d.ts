/**
 * CLI 通过 `@remember/api/server` 引入网关源码，于是 `apps/api/src` 整个进了本包的类型
 * program —— 包括各路由里的 `request.user` / `request.admin`。
 *
 * 那两个属性由 `apps/api/src/types.d.ts` 的模块增强提供。它是 api 包的**根文件**
 * （tsconfig 的 `include: ["src"]` 收进来的），没有被任何 import 引用，所以不会跟着
 * import 图过来；不显式引用就会得到一屏 "Property 'user' does not exist on type
 * 'FastifyRequest'" —— 与 api 自己的 typecheck 结果矛盾（那边是 0 错误）。
 *
 * 用 reference 而不是把它加进本包 tsconfig 的 include：后者会让它成为本包的根文件，
 * 而它在本包 rootDir 之外，会触发 TS6059。
 */
/// <reference path="../../api/src/types.d.ts" />
