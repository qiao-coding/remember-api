import { defineConfig, defineDocs } from "fumadocs-mdx/config";

/** 公开 docs 内容源：apps/web/content/docs（.mdx 正文 + meta.json 排序）。 */
export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
