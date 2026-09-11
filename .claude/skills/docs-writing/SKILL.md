---
name: docs-writing
description: 改 apps/web 的文档内容（content/docs）或文档页外壳（app/[locale]/docs、components 里的顶栏与切换器）时使用。约束篇幅、语气与 Diátaxis 分类，去掉啰嗦和 AI 味，并按本仓的 smoke.test 硬断言改。
---

# 文档写作

## 先定分类，一页只当一类写

判断标准：这页是「帮我做完一件事」还是「帮我搞懂一个东西」。

| 分类 | 本仓页面 | 写法 |
|---|---|---|
| 教程 | `get-started` | 一条直线，照做跑通。不解释为什么，不列备选 |
| 操作指南 | `install-*` | 步骤 + 命令 + 预期输出。不铺垫，不在结尾复述全文 |
| 参考 | `api-*` | 表格、签名、字段。不写教程 |
| 解释 | `concepts` | 讲清为什么。不塞步骤 |

混类就拆，别在一页里既教又讲。

## 删掉这些

| 别写 | 改成 |
|---|---|
| 值得注意的是、需要注意的是、值得一提的是 | 直接说那件事 |
| 不仅…而且…、既…又… | 拆成两句 |
| 为了…、In order to | 要…、To |
| 确保、保证、实现…能力 | 直接写那个动作 |
| 简单来说、换句话说、也就是说 | 删，直接说那一句 |
| 总的来说、综上 | 删 |
| 实际上、其实 | 删 |

促销词全删：无缝、强大、全面、优雅、灵活、一站式、开箱即用、革命性、seamless、robust、comprehensive、powerful、effortless、elegant。

空 `-ing` 尾巴全删：确保可靠性、展示能力、提升体验、highlighting capabilities、ensuring reliability。

形容词换成数：写「响应 802ms」，不写「很快」。

## 篇幅

- 句子 <25 词，段落 ≤3 句
- 第一句说清「做完能拿到什么」，不说「这是什么」
- 安装页可能是几百行，长度来自命令块而不是文字——**别按行数判断啰嗦，按段落判断**
- 要砍时按这个顺序：结尾的「下一步」→ 开头的铺垫 → 与上方表格重复的段落 → 用 Callout 复述正文的话

## 格式

- **加粗只给一页里最该被看到的一两处**。全篇加粗等于没加粗
- 列表只放真正并列的项。一句话能说清就别拆 bullet
- 别用 bullet 写散文：每条要么是命令，要么是短事实
- `Callout` 每页 ≤2 个，只放踩坑警告。用它复述正文是纯浪费

## 硬约束

`apps/web/content/docs/content.smoke.test.ts` 逐页断言了内容，改坏会红。**改前读它。**

```bash
pnpm --dir D:/coding/remember-api --filter @remember/web test
```

- 双语成对改。`zh/` 与 `en/` 的页面集合、数组长度、`meta.json` 分组名逐项对应
- 内链前缀跟语言走：zh 用 `/docs/...`，en 用 `/en/docs/...`
- frontmatter 的 `title`/`description` 值里不能有裸冒号（`:` 后跟空格），YAML 解析失败只有 build 才发现；值里要用冒号就整串加引号
- 每页 `title` 与 `description` 必填
- `install-cli` 与 `start/get-started` 走的是 npx 路线，两页都不能出现 `git clone` 和 `UPSTREAM_API_KEY`；两页是否挂「尚未发布到 npm」警告也必须一致（口径不一致会红）
- Supabase 全流程的 15 个字符串（`6543`、`5432`、`SEED_USER_ID`、`UPSTREAM_API_KEY` 等）钉在 `install-supabase`
- 全部页面禁止出现 `/dashboard`、`/login`、`进入控制台`、`live connection`
- `<Steps>`/`<Step>` 已在 `mdx-components.tsx` 全局注册，直接用。`<Step>` 只收 children、没有 `title`，步骤标题在内部写 `###`
- `<Step>` 里包 `###`、代码块、列表、表格时，JSX 标签前后必须留空行——否则被当行内内容解析，只有 build 报「Expected a closing tag」
- 安装页必须保留页顶的 `<InstallSwitcher current="..." locale="..." />`；`quickstart` 保留 `<InstallSwitcher locale="..." />`
- 各页必须保留的命令字符串（`npx remember-api init`、`pnpm db:migrate`、`docker compose build` 等）见 smoke.test 的 `stepsByMethod`

改完必须 build——MDX 的 YAML/JSX 问题测试跑不到：

```bash
pnpm --dir D:/coding/remember-api --filter @remember/web build
```

## 本仓结构

- `apps/web/content/docs/{zh,en}/<组>/<页>.mdx` — 三组 × 4 页 × 2 语言，外加语言根部的 `index.mdx`
- 组是**真子目录**：`start/` `install/` `api/`，URL 就是 `/docs/<组>/<页>`
- 根 `meta.json` 的 `pages` = `["index", "start", "install", "api"]`；各组自己的 `meta.json` 用 `title` 定侧边栏组名、`pages` 定组内顺序
- 侧边栏靠真子目录 + 子目录 meta 才有可折叠组。根 meta 里写 `"---名称---"` 只渲染成一条静态分割线，组内永远展开——要折叠组就只能建子目录
- 增删页或改组名，同步改 `content.smoke.test.ts` 的 `SLUGS`/`GROUP_PAGES`/`GROUP_TITLES` 与 `components/__tests__/install-switcher.test.tsx` 的分组断言
- `InstallSwitcher` 的 `METHODS[].slug` 带分组段（`install/install-cli`）

## 文档页的 className

文档页比别的路由多加载一张 fumadocs 自带样式表，它整表排在 app 样式表之后；跨表同特异性 (0,1,0) 时后表赢。

- 写 `flex max-md:hidden`，不写 `hidden md:flex`
- 写 `max-xl:hidden`，不写 `hidden xl:inline`
- 别用「基础隐藏 + 断点显示」：那张表里有裸 `.hidden`，没有 `.md\:flex` 来还手
- `lib/docs-css-guard.test.ts` 扫 `components/` 与 `app/` 的字符串字面量拦这条

## 文档页的固定元素偏移

fumadocs 的浮动控件用 `calc(banner + nav + tocnav)` 算 `top`，加自建固定顶栏时容易漏 `--fd-nav-height`。

- 顶栏高度只由 `components/site-header.tsx` 的一个 `h-*` 类决定，改高度必须同步改 `app/globals.css` 的 `:root:has(#site-header){--fd-nav-height:…}`（`lib/docs-chrome-offset.test.ts` 断言两者相等）
- 收起侧边栏那颗悬浮按钮的内联 `top` 不含 `--fd-nav-height`，靠 `globals.css` 里针对 `#nd-docs-layout > div:has(> button[aria-label="Collapse Sidebar"])` 的 `!important` 规则补上。漏了它，收起后再也展不开
- 侧边栏三组的默认展开态由 `app/[locale]/docs/layout.tsx` 的 `sidebar={{ defaultOpenLevel: 1 }}` 定，0 等于没写、三组全收起（`lib/docs-sidebar-groups.test.ts`）
