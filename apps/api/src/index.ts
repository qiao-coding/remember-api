import { startServer } from "./server.js";

// 薄壳：真正的启动逻辑在 server.ts（CLI 同进程起网关时 import 的是那里）
void startServer().catch((err: unknown) => {
  console.error("[boot] 网关启动失败:", err);
  process.exit(1);
});
