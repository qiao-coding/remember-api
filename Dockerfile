# syntax=docker/dockerfile:1
# remember-api 网关（Fastify）生产镜像。
#
# 结构：
#   builder —— 全量工作区（含 devDeps），负责 build + `pnpm deploy` 产出薄运行目录；
#              同时被 docker-compose 的 db-init 服务复用（`--profile init` 跑迁移/种子）。
#   runtime —— 只拷 deploy 产物（self-contained node_modules + dist），无 dev 工具、无源码工作区。
#
# 运行时仅剩外部依赖（fastify/@fastify-cors/drizzle-orm/jose/zod/@supabase/supabase-js/@opencode-ai/models），
# @remember/* 与 postgres/ai 已被 tsup noExternal 内联进 dist，见 apps/api/tsup.config.ts。

########## builder ##########
FROM node:22-slim AS builder
ENV CI=1
# 钉与仓库 packageManager: pnpm@11.22.0 一致的 pnpm（corepack 从 npm registry 拉包，国内构建请走 registry 镜像）
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /repo

# 一次性 COPY 全仓（.dockerignore 已剔除 node_modules/.git/产物/各 .env）。
# 未做逐清单缓存层：部署镜像低频构建，优先正确性。
COPY . .

# esbuild 等 postinstall 已由 pnpm-workspace.yaml 的 allowBuilds 放行
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @remember/api build

# pnpm>=10 对非 inject-workspace 需要 --legacy；产物自包含（/out/node_modules/.pnpm 即其虚拟存储）
RUN pnpm --filter @remember/api deploy --legacy /out

# deploy --legacy 会连带 api 的 devDependencies（tsup/tsx/vitest/typescript/turbo/esbuild/@types/node 等）
# 装入 /out。运行时不编译，按固定 devDeps 名单删掉顶层入口 + store 目录，缩小 runtime 层。
# 名单随 apps/api/package.json devDependencies 漂移时最多是多删/少删几个无用包，不影响正确性。
RUN cd /out/node_modules \
  && rm -rf tsup tsx typescript vitest turbo vite esbuild \
  && find .pnpm -maxdepth 1 -type d \( \
       -name 'tsup@*' -o -name 'tsx@*' -o -name 'vitest@*' -o -name 'vite@*' \
       -o -name 'vite-node@*' -o -name 'typescript@*' -o -name 'turbo@*' \
       -o -name 'esbuild@*' -o -name '@types+node@*' -o -name '@vitest@*' \
       -o -name '@esbuild+*' -o -name 'rollup@*' -o -name '@rollup+*' \
     \) -exec rm -rf {} +

########## runtime ##########
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# 无状态服务：不挂任何持久卷；CA 与数据库连接都走 env（见 docker-compose）
COPY --from=builder --chown=node:node /out/ /app/
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
