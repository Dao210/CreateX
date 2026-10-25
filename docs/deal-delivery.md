# DEAL V0.1 开发交付与验收

日期：2026-10-06。范围：[PRD](deal-prd.md)、[技术架构](deal-architecture.md)、[架构审阅](deal-architecture-review.md)。

## 已交付

独立 `/deal` 游戏：自由文字、Marco 八种姿态与动作反馈、八件物品、一次搜查机会、三类协议与失败结局。协议需明确接受。现金只抵债一次，未来承诺不变成到账。支持刷新与服务重启恢复、请求重试去重、确认重开、保留旧局及复盘文本下载。

`apps/deal` 是 React/Vite 游戏应用；`server/cmd/deal` 是独立 Go 服务；`server/internal/deal` 包含规则、模型、文件存储和匿名 HTTP。`packages/core/deal` 提供 API 契约与客户端，复用已有 UI 和 Go LLM 入口。不需要 Auro 账号、工作区、PostgreSQL 或 agent CLI。

## 本地运行

安装独立应用及其依赖：

```bash
pnpm install --filter @auro/deal...
```

明确选择规则试玩：

```bash
DEAL_MODEL_MODE=scripted make up C=deal
make status C=deal
make down C=deal
```

默认访问 `http://127.0.0.1:13106/deal/`。API 为 `127.0.0.1:18106`。数据在 `.deal/sessions/`，日志在 `.deal/logs/`；停止不会删除数据。启动只管理本项目进程，端口被占用会拒绝启动。

切换模式需要先停止再启动；已运行环境的 `make up` 只检查状态。可以使用根目录未跟踪的 `.env.deal` 保存所需配置，启动脚本不会复制或读取主 Auro 的 `.env`。

AI 模式使用 `.env.example` 中的 `DEAL_MODEL_MODE=llm`、`DEAL_LLM_API_KEY`、`DEAL_LLM_BASE_URL`、`DEAL_LLM_MODEL`。也可以显式导出已有 `AURO_LLM_*` 配置；DEAL 配置优先。密钥不写入文档、代码或前端。未配置时显示不可用，不自动进入规则模式。

AI 请求发送玩家输入和最近四个公开回合给配置的模型服务；秘密状态、心理与所有权凭证排除。文字回合最多两次模型调用，12 秒总预算、零自动传输重试。物品和等待动作不调用模型。

## 同源正式构建

```bash
pnpm --filter @auro/deal build
```

本地 managed 环境的 Go 服务已使用 `apps/deal/dist`，可以在 `http://127.0.0.1:18106/deal/` 验证正式构建。独立部署配置 `DEAL_ASSETS_DIR`、`DEAL_DATA_DIR` 和 `DEAL_LISTEN_ADDR`；HTTPS 代理必须保留原 Host，并设置 `DEAL_SECURE_COOKIES=true`。数据目录只允许一个服务进程，不支持多副本共享文件写入。

## 实际检查

| 检查 | 结果与范围 |
| --- | --- |
| `pnpm --filter @auro/deal typecheck` | 通过；正式构建也再次执行类型检查 |
| `pnpm --filter @auro/deal lint` | 通过 |
| `pnpm --filter @auro/deal test` | 2 项通过；未配置入口与规则模式标识 |
| `pnpm --filter @auro/deal build` | 通过；JS gzip 约 131 KB、CSS gzip 约 10.4 KB |
| `pnpm --filter @auro/core exec vitest run deal/index.test.ts` | 4 项通过；畸形响应、枚举兼容、请求与错误契约 |
| `pnpm --filter @auro/core exec eslint deal/index.ts deal/index.test.ts` | 通过 |
| `go test -race ./internal/deal ./cmd/deal ./pkg/llm`（server 内） | 通过；cmd 编译通过，领域、HTTP、SDK 模拟、存档恢复、幂等、并发与模型边界测试 |
| `go vet ./internal/deal ./cmd/deal ./pkg/llm`（server 内） | 通过 |
| 独立 Playwright 浏览器验收 | 6 项通过；Go 同源正式构建、已安装 Chrome、显式规则模式 |
| `make down/up/status C=deal` | 停止与启动成功，原局刷新恢复至 07:40 且保留原对话 |
| 浏览器视觉检查 | 桌面房间和首页、390×844 窄屏；无横向溢出，键盘提交有效 |
| 文档引用与格式 | 本轮文件引用存在，尾随空白检查通过 |

独立浏览器测试命令（需要显式规则环境已启动）：

```bash
# 标准 Playwright Chromium 已安装时
pnpm exec playwright test --config apps/deal/playwright.config.ts

# 使用已安装 Chrome，验收 Go 同源正式构建
DEAL_TEST_BROWSER_CHANNEL=chrome DEAL_TEST_URL=http://127.0.0.1:18106 \
  pnpm exec playwright test --config apps/deal/playwright.config.ts
```

六项流程为延期与刷新/下载、证据杠杆、合作、红线失败与取消/确认重开、提交成功但响应丢失后的同 ID 重试、窄屏与键盘。测试使用独立 TestApiClient，不登录 Auro、不访问其数据库。截图与失败 trace 写入 `test-results/deal/`，该目录不纳入源码。

## 尚未验证

未调用真实模型，也未执行用户安装的 agent CLI。模型结构与 SDK 调用使用本地模拟服务验证，正式模型语义、时延、成本和攻击语料需配置后测量。陌生玩家可理解性、重玩率及公开托管没有验收；语音属于下一期。

没有运行全仓库 Auro Web/Desktop/Mobile、数据库或 `make check` 检查。本轮检查覆盖独立 DEAL 与涉及的 core/LLM 契约。当前目录没有 `.git`，无法生成 Git diff、提交、推送或创建 PR；没有部署到外部环境。
