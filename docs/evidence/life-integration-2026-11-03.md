# Agent Life 主项目集成验收：2026-11-03

## 交付范围

删除独立的 `apps/agent-life-worker`。TypeScript 世界规则和独立 Brain 留在 `packages/core/agent-life`；PostgreSQL 写入、Tick 调度、事务、消息事实和进程管理归入 Go 主服务 `server/internal/life`。内部 Node 计算进程只接受有版本、身份和大小限制的 seed/tick JSON 协议，不接收数据库、账号或模型凭据。

复用主服务连接池、sqlc、成员权限、游戏策略、事件总线及 WebSocket，沿用 Web/Desktop 的世界页面。`make up`、构建、CI、原生发布和 Docker 定义均已接入，无新增服务端口或 systemd unit。已有绑定和数据继续使用，本次没有新增数据库迁移，也不回放已退役迁移。

六种行动、20 个预设居民和规则策略保持原范围；未接入 LLM、居民创建、主页或日记。完整 PRD 链接尚不能读取正文，数值参数的产品核对仍待完成，详见 [实现说明](../agent-life-phase1.md)。

## 检查结果

| 检查 | 实际结果 |
| --- | --- |
| TypeScript 规则与计算契约 | 12 项通过；20/60 居民各运行 1,440 Tick，无负库存、重复结算或缺失完成事件 |
| API 解析与 realtime 相关测试 | 60 项通过 |
| Go 主服务与 Life 默认测试 | `go test -race ./cmd/server ./internal/life` 通过；覆盖协议异常、超时回收、凭据隔离、健康检查与关闭顺序；此命令不含需显式数据库环境的用例 |
| 真实 PostgreSQL + TypeScript 计算进程 | `make life-test-db` 通过；一次性 schema，覆盖并发初始化、并发 Tick 单次提交、过期结果拒绝、事件/消息失败整笔回滚、子进程崩溃恢复、旧写入者拒绝、世界隔离与删除 |
| 现有消息与管理集成 | `make inbox-test-db`、`make game-admin-test-db` 通过 |
| sqlc | 已重新生成查询代码；未改变数据库结构 |
| 类型与 Lint | 内部计算入口、Core、Web、Desktop 类型检查通过；变更的 Core 和计算入口 ESLint 通过 |
| Web / Desktop 构建 | 隔离 checkout 中的 Web 生产构建、Desktop 构建通过 |
| Linux ARM64 Go 构建 | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0` 主服务交叉编译通过 |
| 启动与发布脚本 | dev-env、Web 模式、构建命名、原生发布边界和 shell 语法检查通过；清理旧版本时保留仍在运行的 API 所属目录的回归通过 |
| CI 路径选择 | 43 项通过；Life 规则/依赖改动会触发后端检查，发布和启动脚本有对应 CI 回归 |
| 差异检查 | `git diff --check` 通过 |

20/60 居民长测为加速模拟，不代表已完成 24 小时真实时间运行。一次重构验证中的并行构建负载导致 60 居民用例超过原 30 秒时限；在单 worker 下独立重跑全部 Life 用例通过，未放宽时限或修改规则。

## 浏览器与恢复验收

在单独创建的受管 checkout `createx-179`、独立数据库和端口上运行 `LIFE_E2E=1`。开发模式及固定的 Web 生产构建均通过；最终生产模式用例运行约 23 秒，包括夹具创建、API 重启和清理。

- 没有打开 viewer 时，20 个居民已经推进到至少 Tick 3。
- 快照来自真实 API；未登录、非成员和无模拟世界分别遵守现有权限/空状态契约。
- 世界页面显示居民、当前行动和事件；选择 Rowan 写入 URL。
- 接收到真实 `life:updated` WebSocket 帧，页面在 10 秒内更新 Tick；备用轮询间隔为 30 秒。
- 杀死本测试 API 的计算子进程后，API PID 不变，新的子进程恢复 Tick。
- 重启主 API 且不再传入 bootstrap 世界 UUID 后，已提交 Tick 继续增长。
- 390px 窄屏无页面横向溢出，事件流可见；数据库审计没有缺失终结事件的已结算行动。

该 E2E 拒绝非本地 API 和已存在模拟的数据库，测试世界通过 `TestApiClient` 创建并删除。没有重启或停止共享日常 checkout 的 API/Web。

11 月 4 日复核了 `make start`、`make dev` 和 `make server` 的启动路径，三者均已接入 `api-dev`。在隔离 checkout 中用 `make server` 替代 E2E 的主 API 重启步骤，确认未传入 bootstrap UUID 时已提交 Tick 仍会继续增长。该生产构建场景通过，耗时 16.6 秒。

## 尚未执行

- 按 Docker 计算阶段的文件布局完成冻结安装和计算包构建。实际镜像构建与运行待 Docker 守护进程可用后验证。
- 未向远程服务器部署，未验证目标主机原生 bundle smoke；发布脚本已包含该检查。
- 未运行原生 Mobile、真实 LLM/Agent CLI、24 小时运行或全仓测试。
- 全量 Knip 报告现有 21 个未使用文件、5 个依赖、4 个开发依赖；没有新增 Life 入口或 esbuild 的报告。本次未处理其他模块的清理项；CI 中该项保持原有 advisory 策略。

代码交付与本地验收不等于生产上线。日常 checkout 的既有进程保持原状，更新后的主服务需按正常流程重启后生效。
