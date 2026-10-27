# Siege 工作区功能

Siege 与 tanks 一样是 Auro 的一级工作区功能。工坊与战役复用主项目的身份、布局、后端、构建、发布及浏览器测试；不提供独立应用或匿名运行模式。

## 入口与模块

| 位置 | 职责 |
| --- | --- |
| `apps/web/app/[workspaceSlug]/(dashboard)/siege` | 工坊、战役路由及多语言标题 |
| `apps/desktop/src/renderer/src/pages/siege-page.tsx` | 桌面按需加载的宿主入口 |
| `packages/core/siege` | schema、几何、编译、路径、选敌、经济、关卡和存档校验 |
| `packages/core/siege/queries.ts` | 显式工作区请求与账号/工作区查询键 |
| `packages/views/siege` | 身份入口、Canvas、编辑器、Rapier 和浏览器平台能力 |
| `packages/views/siege/assets` | 唯一的原画资源及 manifest，由宿主构建生成资源地址 |
| `server/internal/siege` | PostgreSQL 会话、蓝图版本、识别回执及工作区成员配额 |
| `e2e/siege` | 使用根 TestApiClient 的认证浏览器测试 |

工坊 URL 为 `/{slug}/siege`，战役为 `/{slug}/siege/campaign`。两个 Web 页面均在 Dashboard 内；桌面保留同一路径与标签系统。Mobile 尚未接入。

## 身份与存储

共享入口等待用户与工作区 UUID 解析，按 `auro:siege:{userId}:{workspaceId}` 绑定存储。身份改变重新挂载游戏；preferences 与 IndexedDB 草稿均使用该命名空间。旧的无归属本机记录不自动分配给任何账号，也不删除。

服务端沿用 `/api/siege` 的 JSON 合约，必须经过主服务的成员校验与 CSRF/Bearer 认证。请求显式绑定目标工作区；蓝图库查询键同时含工作区和用户身份。每个工作区成员最多五个会话，创建配额与幂等校验按成员串行化，不设置全站会话总数上限。工作区删除事务清理 Siege 会话与识别预算；创建使用共享行锁避免删除竞态。

星级会通过 `PUT /api/game-progress/siege` 单调合并到个人云端进度，供 `/{slug}/me` 跨设备展示；音效、速度、改装与波间断点仍保存在本机。工坊蓝图通过 `GET /api/siege/library` 跨会话列出，清空本机 sessionId 不再丢失入口。蓝图保存仍等待服务端，版本冲突保留编辑内容。已部署武器冻结编译输入，后续编辑只影响新部署。

## 加载与运行时

公共页面入口只导出工作区页面。工坊、战役、物理运行时分别按需加载；浏览其他工作区页面不应加载 Rapier。初始化失败清理缓存，允许重试。战役物理初始化和当前场景必要素材并行；工坊未开始测试时不加载战场素材。

固定 60Hz 模拟与渲染独立，保留真实 CCD 炮弹、旋转惯性与近战碰撞。路径预计算与一次遍历选敌保留原有优先级；碰撞用 handle 索引查障碍。静态战场缓存与 Path2D 原画缓存降低重复绘制。画布分辨率按显示尺寸和有界 DPR 调整。准备、暂停、结算停止持续动画；失焦、页面隐藏暂停，继续操作后再恢复模拟。

所有物理对象在页面离开时释放。断点只恢复已完成波次，不序列化进行中的物理世界。Worker 或物理库打包方式的进一步调整由主项目生产构建与目标设备测量决定。

## 开发与验证

```sh
make up C=api,web MODE=development
make status
pnpm --filter @auro/core exec vitest run siege
pnpm --filter @auro/views exec vitest run siege
pnpm --filter @auro/views typecheck
pnpm --filter @auro/web typecheck
pnpm --filter @auro/desktop typecheck:web
pnpm --filter @auro/web build
(cd server && go test ./internal/siege ./pkg/llm)
pnpm exec playwright test e2e/siege
```

Go PostgreSQL 合约测试使用已经迁移的测试数据库：设置 `SIEGE_TEST_DATABASE_URL` 后运行 `go test ./internal/siege -run PGStore -count=1`。通过 testutil 创建和清理独立账号、工作区，不建表或清空整表。

普通玩法无需识别配置。识别回归显式给主服务设置 `SIEGE_RECOGNITION_MODE=fixture`；fixture 只认识原封不动的 shipped 样例，绝不在真实模型失败时自动启用。真实模型沿用主服务环境中的 `SIEGE_LLM_*` 设置，日预算由 `SIEGE_DAILY_RECOGNITION_LIMIT` 控制。

CI 在主应用、PostgreSQL 和显式 fixture 模式下验证认证流程，保留浏览器错误 trace。仓库规则与命令参考以本流程为准。
