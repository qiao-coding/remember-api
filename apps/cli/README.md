# remember-api

本机起一个**带记忆的 OpenAI 兼容网关**，一条命令装完，不用克隆仓库。

> ⚠️ **尚未发布到 npm。** `npm view remember-api` 目前是 404，所以下面的 `npx` 一律拉不到包——
> 发布之前请走源码：`git clone` 仓库、`pnpm install`，再 `pnpm --filter remember-api build`
> 打出 CLI，之后用 `node apps/cli/dist/index.js` 或 `npx --no-install remember-api` 跑同样的子命令。

```bash
npx remember-api init   # 向导：建库 → 选厂商与模型 → 录 Key → 自检
npx remember-api up     # 起网关，打印 Base URL / API Key / Model 三件套
```

然后把这三项填进任意支持自定义 Base URL 的客户端（Codex、Claude Code、Cursor、Cherry Studio、Open WebUI…），就连上了自己的个人 AI。

## 它解决什么

- **不克隆仓库**：`npx` 只下一个包，网关作为本地进程跑在 `127.0.0.1:4000`。
- **不手写 `.env`**：向导会建库、补本地 PostgreSQL 缺的 `auth.uid()` 桩、跑迁移、写样例数据。
- **凭据管一次**：每家厂商的 Key 加密存在数据库里（`provider_configs`，AES-256-GCM）。
  之后换模型只切一行，**不用重启、不用改文件**：

  ```bash
  npx remember-api model use deepseek/deepseek-v4-pro
  ```

- **厂商不限**：模型清单来自内置的 models.dev 快照（200+ 家，离线不联网查）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `remember-api` | 没配置过就走向导，配置过就起网关 |
| `remember-api init` | 向导：建库 → 选厂商/模型 → 录 Key → 自检 |
| `remember-api up [--port N]` | 起网关（前台，`Ctrl-C` 停止） |
| `remember-api status` | 配置文件 / 数据库可达 / 已迁移 / 已配厂商 / Profile / 端口 / 当前模型 |
| `remember-api connect` | 再打印一次三件套 |
| `remember-api model [list \| use <厂商>/<模型> \| add]` | 看已配厂商、切模型、加厂商 |
| `remember-api key [list \| new [名字]]` | 管理本机 API Key（明文只显示一次） |
| `remember-api doctor` | 起个临时网关自检 Key 与 Profile 是否对得上 |

## 脚本与 CI

交互问答需要真正的终端。在管道、重定向或 CI 里没有终端，向导会直接报错退出——不会静默跳过，也不会假装成功。这种场景把参数一次给全：

```bash
npx remember-api init --yes \
  --url postgres://postgres:postgres@127.0.0.1:5432/remember_api \
  --provider deepseek --model deepseek-v4-flash --key sk-xxxx
```

完整参数（`--port` / `--base-url` 等）见 `npx remember-api --help`。

> ⚠️ `--key` 会进入 shell 历史与进程列表。共用机器上优先用交互式向导，或改设该厂商约定的环境变量（如 `DEEPSEEK_API_KEY`）。

## 前置要求

- Node.js >= 22
- 一个 PostgreSQL（已有的实例，或让向导用 Docker 起一个 `postgres:16`）
- 一个上游模型 Key（任意 OpenAI 兼容厂商）

## 配置存在哪

- `~/.remember-api/config.json`：数据库地址、两个本地密钥、默认选择。**里面没有厂商 Key**。
- 厂商 Key 加密存在数据库的 `provider_configs` 表里，每厂商每用户一行。
- `REMEMBER_API_HOME` 可以改配置目录（多实例与测试用）。

## 文档

安装、概念与接口契约：<https://github.com/qiao-coding/remember-api>

## License

MIT。见 [LICENSE](./LICENSE)。
