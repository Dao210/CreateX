# Fish：世界中的海洋与鱼的创作

Fish 是现有主应用中的世界功能：Web 与 Desktop 使用 `/{slug}/fish`，共享 `packages/core/fish`、`packages/views/fish` 和主 Go API 内的 `server/internal/fish`。没有独立 Fish 应用、账号、端口或部署单元。

## 产品范围

当前版本采用每个世界成员一片海洋：海洋和作品以世界 UUID、账号 UUID 隔离。海洋默认私有，主人可以改为当前世界成员可参观；仅知道海洋 ID 不授予访问权限。世界外访客与匿名分享不受支持。

作品永久保存在 PostgreSQL。投放后，海洋居民冻结作品的 ID、revision、contentHash、编译器和行为规则版本。保存改版不改变已投放居民；显式应用新版本保持居民身份。收回保留作品，重新投放复用原居民身份。归档隐藏普通作品列表中的条目，不删除仍在海洋中的鱼。

游动是客户端观赏运动：尾摆、全身波动、鳍驱动、群游、软避让和水层偏好。服务器权威保存作品和居民名单，不保存逐帧位置；关闭页面不会计算繁殖、饥饿或捕食，两位观察者的位置不要求完全一致。没有运行时 LLM 调用。

空海洋展示带有明确标识的六条示范鱼，直到投放自己的鱼。示范不创建数据库记录。Web/Desktop 的「我的创作」增加鱼筛选与海洋入口，列表不激活 Three.js 画布。3D 场景只在进入海洋或打开预览时懒加载。

## 创作协议

[规范与样例](../packages/core/fish/catalog.json)是 `fish@1` 的机器可读来源。使用整数表示身体尺寸及比例：身体长度为毫米，截面和鳍尾尺寸为体长的千分比，速度为毫米/秒，频率为毫赫兹。局部正 X 为头部朝向，身体截面从头部 `u=0` 到尾部 `u=1000` 严格递增。

身体包含 4–16 个截面，最多 8 个鳍，每个鳍为 3–12 点凸多边形，至少两个点位于 `y=0` 基座。外形不是预制模型换色：身体高度、宽度、偏移、鳍位置与轮廓、尾长/展开/分叉均参与几何编译。表面支持配色、条纹、斑点、有限发光和透明度。

Go 在保存时重新校验必填字段、未知字段、整数范围、截面顺序和鳍几何。Agent 不能提交脚本、shader 或外部资产 URL。非法描述返回具体字段错误，不替换为默认鱼。客户端编译器产生 DOM 无关的网格数组，Three.js 层负责 GPU 资源与动画。

修改规范后运行 `pnpm generate:fish-contracts`，提交 Go 的生成目录文件，并运行两端契约测试。规范/编译器/规则版本的语义变化必须升版，未知版本不得继续投放或伪装成旧版本。

## API 与 MCP

| 能力 | 地址 |
| --- | --- |
| 页面 | `/{workspaceSlug}/fish` |
| HTTP API | `/api/fish/v1` |
| MCP Streamable HTTP | `POST /api/fish/mcp` |
| MCP stdio | `auro --server-url <api> --workspace-id <uuid> --profile <profile> fish mcp` |
| Node 接入说明 | `/.well-known/fish-mcp/setup.md` |
| Node 连接器 | `/.well-known/fish-mcp/connect.mjs` |

所有接口复用现有 Auro 认证及世界成员守卫。MCP 每次请求额外执行 Fish MCP 服务/工具策略；普通 HTTP 不依赖 MCP 开放。`fish` 接入游戏开放管理，隐藏仍可直达，关闭拒绝访问并保留数据。

HTTP 资源：

- `GET catalog`；`POST validate`，正文为 `{draft}`。
- `GET fish`：只返回当前成员在当前世界的作品，包括归档标记。
- `POST fish`：`{requestId,draft,fishId?,expectedRevision?}`。
- `GET fish/{id}?revision=<n>`：精确版本或省略版本读取最新。
- `POST fish/{id}/archive`：`{requestId,archived}`。
- `GET ocean?id=<uuid>`：返回 `{ocean:...}`；不传 ID 时读取自己的海洋，尚未创建返回 `{ocean:null}`，GET 不创建海洋。
- `POST ocean`：`{requestId}`，幂等确保当前成员只有一片海洋。
- `POST ocean/settings`：`{requestId,oceanId,expectedRevision,visibility}`。
- `POST residents` 接收 `{requestId,fishId,revision,contentHash,oceanId?}`。省略 `oceanId` 时投放到当前世界中自己的海洋，首次投放会在同一事务内创建私有海洋。显式 ID 必须指向自己在当前世界的海洋。
- `POST residents/apply` 要求 `oceanId`、`residentId` 和 `expectedResidentRevision`，并提交要应用的鱼作品版本与哈希。
- `POST residents/recall`：`{requestId,residentId,expectedResidentRevision}`。

MCP 提供 `fish_get_catalog`、`fish_validate`、`fish_save`、`fish_list`、`fish_get`、`fish_get_ocean`、`fish_create_ocean`、`fish_release`、`fish_apply_revision` 和 `fish_recall`。工具 Schema 由 `tools/list` 返回。

首次接入只完成认证与只读目录验收，不创建鱼。Node 连接器复用现有浏览器登录/PAT API，凭据按 API、世界及账号保存在 `~/.createx/fish-mcp/`，不写入指令、URL 或 MCP 配置。浏览器返回海洋页面不代表当前 Agent 聊天工具已重载，必须在实际客户端成功调用 `fish_get_catalog`。

用户明确要求「创造并放进海洋」时，Agent 校验并保存后直接调用 `fish_release`。投放返回实际的 `resident.oceanId` 和定位到该居民的 `oceanUrl`。只要求创造时提供 `?fish=<id>&revision=<n>` 的动态预览。

启用 `fish_release` 即允许它在首次投放时创建个人海洋。关闭 `fish_create_ocean` 只关闭独立建海工具。

## 事务、权限与同步

写操作先共享锁定世界，复核成员关系，再按世界/成员获取事务级 advisory lock，顺序与世界删除一致。作品、版本、居民以及幂等回执在同一事务写入。相同请求 ID 与相同内容返回原结果，改换内容返回 409；回执保留七天。每位成员最多保存 128 个作品，每个作品最多 50 个版本，每片海洋最多 50 位活跃居民。容量与投放在同一锁内检查。

投放重试应复用原参数和 `requestId`。从省略 `oceanId` 改成显式指定也算变更，即使指向同一片海洋。HTTP 返回 409，MCP 返回 `isError`，错误码均为 `idempotency_key_reused`。

私有草稿不进入世界消息。当前变更通过已有实时基础向作者发送无作品正文的缓存失效事件；海洋与作品还定时刷新，重连/聚焦后读取权威数据。公开参观页面至多等待下一次五秒刷新看到居民变化；改变为私有后下一次读取拒绝访问。当前没有投放事件摘要和 OS 通知。

成员退出失去访问；公开海洋还检查海洋主人是否仍是成员。世界删除事务清理五张 Fish 表，不使用外键与级联。画质偏好通过宿主注入的 StorageAdapter 按世界和账号隔离。

最新本地验收见 [2026-11-03 记录](evidence/fish-2026-11-03.md)。

## 本地运行与验证

使用主项目托管环境：`make up MODE=development C=api,web`，不另起 Fish 服务。API 已运行时，修改 Go 后需要重启 API；Web 开发模式热更新。

```sh
pnpm generate:fish-contracts
make sqlc
make fish-test-db
make game-admin-test-db
pnpm --filter @auro/core exec vitest run fish api/fish.test.ts paths
pnpm --filter @auro/views exec vitest run me/me-page.test.tsx layout/app-sidebar.test.tsx search/search-command.test.tsx admin/game-manager.test.tsx
pnpm --filter @auro/web exec vitest run test/fish-mcp-connector.test.ts
pnpm typecheck
make env-exec ARGS="-- pnpm exec playwright test e2e/fish.spec.ts"
# Long browser verification uses a fixed production build, without hot reload.
# FISH_SOAK=1 make env-exec ARGS="-- pnpm exec playwright test e2e/fish.spec.ts --output test-results/fish-production"
```

`make fish-test-db` 使用 checkout 的托管数据库建立一次性 schema 和影子表，验证版本、并发幂等、隐私、成员退出、容量与事务回滚，结束后删除测试 schema。浏览器测试通过 TestApiClient 创建并删除隔离世界，不使用真实 Agent CLI。真实 Codex 等客户端接入需要另行授权烟测。

性能上限、十分钟浏览器运行和真实设备兼容性应以实际验收记录为准。纯逻辑十分钟模拟测试不等于浏览器帧率或 GPU 内存验收。
