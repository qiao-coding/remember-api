import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";

/** docs 数据出口：pageTree（侧栏）/ getPage / generateParams，挂载在 /docs 子路径。 */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
