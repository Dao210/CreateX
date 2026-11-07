# 全站游戏管理

Web 的 `/admin` 默认进入游戏管理；`/admin/games` 和 `/admin/mcp` 分别打开游戏与 MCP 模块。Desktop 使用同一共享界面，在全局管理窗口中切换模块。

只有服务端 `AURO_ADMIN_EMAILS` 指定的人类账号拥有全站管理权限。世界 owner/admin 不获得全站权限，Agent 凭证不能调用管理接口。鉴权由 `server/internal/adminauth` 统一提供，游戏与 MCP 策略分别存储。

## 开放与显示

| 开放范围 | 规则 |
| --- | --- |
| 全部世界 | 已有和新建世界默认可用，可以禁止指定世界 |
| 指定世界 | 仅访问例外为“允许”的世界可用，新世界不自动加入 |
| 关闭 | 所有世界不可用；保留例外配置，但例外不能绕过关闭 |

入口显示独立配置。默认显示可以通过世界例外覆盖；不可用的游戏始终隐藏。

- 隐藏入口：侧栏不显示，搜索和直链仍然可用。
- 关闭游戏：侧栏和搜索移除入口，页面显示未开放，游戏 API 拒绝访问。
- 我的创作仅加载和显示有权访问的游戏内容。关闭期间作品、经验和进度仍然保留，重新开放后恢复显示。
- 游戏进度聚合接口过滤不可用游戏的数据，写入接口按具体游戏检查权限。
- 坦克 MCP 同时受游戏开放策略及 MCP 服务／工具策略约束；关闭 MCP 不影响正常开放的游戏 HTTP 接口。

Siege、坦克和海洋沿用上述开放与显示规则。文明世界 Life 的访问只要求登录和当前世界成员身份；管理设置仅控制侧栏入口显示，不能再按世界名单或游戏开关禁止访问。迁移 `356_life_shared_world` 将旧 Life 策略转为全部世界，清除访问例外并保留显式显示／隐藏设置。其他游戏策略不受影响。

服务端在下一次请求执行最新策略。Web/Desktop 在进入或切换世界、窗口重新聚焦以及活跃时每 30 秒刷新有效策略。旧版 Desktop 可能继续显示入口，但不能绕过服务端权限。关闭游戏不提供远程强制终止已在客户端运行的本地战斗的保证。

## 文明世界 Life

所有 `/{slug}/life` 入口访问同一套持续运行的模拟。当前世界成员可以查看全部居民、资源、活动、工程与历史，并使用全部已实现的居民、设计、活动和交流操作；不要求是管理员，也不要求加入最初启动模拟的世界。

首次访问时，如果系统尚无模拟，会原子创建唯一的 20 人模拟。已有模拟直接复用，不按入口世界复制或重置。实时更新对所有已连接世界发送无内容的失效通知，再通过各自成员请求刷新共享数据。

`life_world.workspace_id` 只记录最初来源；来源世界被删除时置空，模拟、居民、贡献和历史继续保留。管理界面只设置 Life 的入口显示，不提供单独访问授权或重置功能。资源条件、容量、模型配置等功能前提仍由对应功能校验。

## 接口与存储

所有管理接口都无须当前世界上下文：

| 接口 | 用途 |
| --- | --- |
| `GET /api/admin/games` | 三个游戏的策略、例外、影响数量及居民绑定 |
| `GET /api/admin/games/worlds?q=&cursor=` | 按名称或 slug 查找世界，每页最多 25 个 |
| `POST /api/admin/games/{gameID}/preview` | 计算待保存策略影响数量，不写数据 |
| `PUT /api/admin/games/{gameID}/policy` | 按 `expectedRevision` 保存策略和审计 |
| `GET /api/admin/games/{gameID}/activity?cursor=` | 按版本倒序读取变更记录，每页最多 25 条 |
| `GET /api/games` | membership gate 内返回当前世界的有效游戏策略 |

策略输入包含 `scope`、`defaultVisible`、`expectedRevision` 和 `overrides`。每个例外包含 `workspaceId`、`access`（`inherit/allow/deny`）、`visibility`（`inherit/show/hide`），最多 500 个。返回 409 表示其他管理员已更新版本，应放弃当前更改并查看最新策略，不能覆盖保存。

`game_policy`、`game_world_override`、`game_policy_audit` 使用独立并发索引，不添加外键。迁移 `327_life_game_world_selection` 将已保存的仅绑定策略转成显式世界选择，不修改模拟或历史审计内容。保存策略、替换例外和写审计在同一事务中完成，审计失败会回滚策略。世界删除会在应用事务中清理对应例外，保留历史审计快照。

配置读取失败返回服务暂不可用，不把失败伪装成游戏关闭。前端保留失败的编辑草稿，并区分权限读取错误与未开放状态。

## 验证

在仓库根目录运行：

```sh
make sqlc
make game-admin-test-db
pnpm --filter @auro/core exec vitest run api/admin.test.ts api/game-admin.test.ts
pnpm --filter @auro/views exec vitest run admin me/me-page.test.tsx search/search-command.test.tsx siege/siege-page.test.tsx tank-defense/tank-defense-page.test.tsx
```

`make game-admin-test-db` 使用当前 checkout 的托管 `DATABASE_URL`，每个测试创建独立 schema 和影子表，测试完成后删除，不修改现有世界的全站游戏策略。覆盖默认继承、指定世界、新世界、关闭、并发保存、审计回滚、管理员与成员权限、MCP/HTTP 守卫及文明世界的共享读取与入口显示。

交付还需要 Web/Desktop 的 typecheck、lint、构建和浏览器验收。不要把模块测试通过视为完整应用验收或生产部署。

全局策略的浏览器验收必须使用独立的托管环境，且 `AURO_ADMIN_EMAILS` 包含测试账号（默认 `game-admin-e2e@example.invalid`，可用 `GAME_ADMIN_E2E_EMAIL` 指定）。测试会临时修改全站策略，结束时恢复基线，通过 TestApiClient 清理所建世界：

```sh
GAME_ADMIN_E2E=1 pnpm exec playwright test e2e/admin-games.spec.ts
```

该场景默认跳过，不能针对日常共享环境或生产环境直接运行。覆盖模块路由、真实保存、世界例外、新世界继承、搜索与直链、HTTP/MCP 拒绝、管理员隔离，以及中英文和窄屏截图。
