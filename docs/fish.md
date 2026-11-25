# Fish 鱼的创作与大海沟

Fish 是现有主应用中的世界功能：Web 与 Desktop 使用 `/{slug}/fish`，共享 `packages/core/fish`、`packages/views/fish` 和主 Go API 内的 `server/internal/fish`。没有独立 Fish 应用、账号、端口或部署单元。

## 产品范围

大海沟是全平台共享的公海。用户从自己所在世界进入同一片公海，可以看到其他世界用户明确公开投放的鱼。作品和未发布改版仍由作者管理。旧私人海洋通过历史链接访问。

公开链接使用 `/ocean?resident=<uuid>`。入口在登录后解析访问者自己的世界，首次使用时复用现有入门流程，并定位到同一条公开鱼。

作品永久保存在 PostgreSQL。投放后，海洋居民冻结作品的 ID、revision、contentHash、编译器和行为规则版本。保存改版不改变已投放居民；显式应用新版本保持居民身份。收回保留作品，重新投放复用原居民身份。归档隐藏普通作品列表中的条目，不删除仍在海洋中的鱼。

浏览器中的尾摆、全身波动、鳍驱动、群游和软避让仍是客户端观赏运动，两位观察者的画面位置不要求完全一致。主 Go 服务另外持续运行公海探索模拟，持久化作品鱼的逻辑位置和见闻，用于生成海洋来信；它不把客户端画面当作相遇证据，也不包含繁殖、饥饿、捕食或运行时 LLM 调用。

大海沟中的原生鱼群与作品鱼同游。公开数量统计全平台的活跃发布，每批展示 40 条作品鱼，并支持定位不在当前批次中的鱼。Web/Desktop 在「我的创作」集中查看、编辑和归档作品。作品链接优先定位公海居民，尚未发布的作品可在同一海景中预览和投放。

## 持续探索与海洋来信

公开投放的作品鱼在关闭页面后仍由 `server/internal/fish` 探索。服务每五秒提交一次、内部按一秒推进，依据冻结版本中的速度、水层偏好和种子移动，记录经过东西礁区、上层或较深水域，以及与另一条公开作品鱼相距不超过 2.5 个世界单位的相遇。空间分桶避免扫描所有鱼对。原生观赏鱼、私人海洋和未发布作品不参与相遇记录。

`fish_exploration_state` 保存位置、速度、最多 128 项地点/相遇记忆和 8 项待寄见闻；同一地点只记首次发现，同一对象再次实际靠近至少间隔七天才会形成新见闻。来信每次选择一条鱼的最多三项未寄见闻。主服务多实例通过事务锁选出一个 Tick 写入者；位置、记忆、时钟和来信事实在同一事务提交。首次启用只初始化已有鱼，之后开始记录；停机超过 30 秒不补演过去，重启继续已保存状态。

来信复用 `world_inbox_event` 与现有 Inbox 投递器，类型为 `fish_letter`，仅发送给来源世界中仍有成员资格的主人，显示在 `/{slug}/inbox` 的「我的创作」分类。按 Asia/Shanghai 自然日，每位用户在每个世界最多一封，多条鱼共用额度；没有新见闻不生成空信，延迟积压也不会突破实际投递日的上限。消息列出实际模拟时间、发现或相遇及当时公开的外形特征，并提供返回鱼的链接。Web/Desktop 与手机保持同一语义，手机通过已有网页入口查看鱼。

鱼的私人见闻不进入整世界摘要。发送遵循当前 Fish 开放策略与「创作动态」通知设置；关闭或静音期间被跳过的信件不补发。收回事务删除活动探索状态，待投递信件还会复核居民当前仍活跃且版本匹配；收回或改版后不投递旧版本的延迟来信。历史信件仍可读，工作区删除显式清理探索状态和消息，全球时钟保留。重新投放从新一次探索开始，保留作品与既有消息。

迁移 357–361 与新版 Go 投递器一起发布。回滚到不识别 `fish_letter` 的旧投递器前，应停用探索并妥善保留/导出该类型的 outbox 与消息；不能让旧投递器将私人见闻合入世界摘要。恢复缺失的探索表或唯一索引时，先停 API，核对迁移记录与索引有效性，再补建对象；不要清空已有探索状态来绕过错误。

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
- `GET public-ocean?cursor=<uuid>&resident=<uuid>` 读取大海沟，返回总数、公开快照、下一批游标和可选的定位结果。也可用 `fish=<uuid>` 定位已经发布的作品。旧 `GET ocean?id=<uuid>` 继续读取私人海洋。
- `POST ocean`：`{requestId}`，幂等确保当前成员只有一片海洋。
- `POST ocean/settings`：`{requestId,oceanId,expectedRevision,visibility}`。
- `POST residents` 接收 `{requestId,fishId,revision,contentHash,destination?,oceanId?}`。显式传入 `destination: "public"` 会将所选版本发布到大海沟。省略 `destination` 保留个人投放语义，`destination` 和 `oceanId` 互斥。
- `POST residents/apply` 要求 `oceanId`、`residentId` 和 `expectedResidentRevision`，并提交要应用的鱼作品版本与哈希。
- `POST residents/recall` 接收 `{requestId,residentId,expectedResidentRevision,destination?}`。收回公海作品时显式传入 `destination: "public"`。

MCP 提供 `fish_get_catalog`、`fish_validate`、`fish_save`、`fish_list`、`fish_get`、`fish_get_ocean`、`fish_get_public_ocean`、`fish_create_ocean`、`fish_release`、`fish_apply_revision` 和 `fish_recall`。工具 Schema 由 `tools/list` 返回。

Web/Desktop 通过单一「创造一条鱼」浮框提供完整创作指令。名字可选（留空由 Agent 命名，最终作品限 40 个 Unicode 码点），描述可选。「创造后放入大海沟」默认选中并显示平台用户可见的后果；取消后仅保存并返回私人预览链接。复制的 JSON 将 `creation.name`、`creation.description`、`creation.destination` 与账号/世界连接数据一起交给 Agent，不含凭据。手动设置外形在同一浮框内切换，保存后预览，投放仍需明确操作；「我的创作」继续直接编辑作品。

首次接入完成认证、客户端注册和实际 `fish_get_catalog` 验证后，Agent 继续原创作任务；仅连接请求不创建安装测试鱼。Node 连接器复用现有浏览器登录/PAT API，凭据按 API、世界及账号保存在 `~/.createx/fish-mcp/`，不写入指令、URL 或 MCP 配置。浏览器返回海洋页面不代表当前 Agent 聊天工具已重载。复制后的提示明确要求到 AI 对话粘贴并发送；完整指令可按需查看，复制失败时可手动复制。授权回跳提供「回到 AI 工具继续」和「复制继续指令」，只携带连接上下文，不能冒充已恢复的创作任务或连接成功。若需重载工具或开启新聊天，由原 AI 提供一份包含原名字、描述、公开选择和连接数据的完整可复制任务；缺少原任务时，提示用户从原对话或创作弹窗复制，不猜测创作要求。

用户要求投放到大海沟时，Agent 校验并保存后调用 `fish_release`，传入 `destination: "public"` 和精确版本。投放返回 `resident.oceanId` 和定位到该居民的 `oceanUrl`。仅创建作品时，提供 `?fish=<id>&revision=<n>` 的海景预览。

公开发布与重试回执在同一事务保存。历史独立建海工具只管理个人海洋。

## 事务、权限与同步

写操作先共享锁定世界，复核成员关系，再按世界/成员获取事务级 advisory lock，顺序与世界删除一致。作品、版本、居民以及幂等回执在同一事务写入。相同请求 ID 与相同内容返回原结果，改换内容返回 409；回执保留七天。每位成员最多保存 128 个作品，每个作品最多 50 个版本，私人海洋最多 50 位活跃居民，每位成员在当前世界可同时公开投放 50 条鱼。平台公海使用游标分批展示。

投放重试应复用原参数和 `requestId`。从省略 `oceanId` 改成显式指定也算变更，即使指向同一片海洋。HTTP 返回 409，MCP 返回 `isError`，错误码均为 `idempotency_key_reused`。

私有草稿不进入世界消息。作品变更通过已有实时基础向作者发送无作品正文的缓存失效事件；海洋与作品还定时刷新，重连/聚焦后读取权威数据。公开参观页面至多等待下一次五秒刷新看到居民变化；改变为私有后下一次读取拒绝访问。海洋来信使用现有个人消息实时与通知链路，投放操作本身不生成世界摘要或通知。

大海沟对可进入 Fish 功能的登录用户开放，发布和改版校验来源世界的成员资格与作者身份。作者可从自己有权进入的任一世界收回公开鱼。公开响应省略来源世界、创建来源和私人归档状态，只包含已投放版本。来源世界删除时同步撤下其公开作品。世界删除事务清理六张 Fish 表，不使用外键与级联。旧个人公开海洋还检查主人是否仍是成员。

海洋提供默认和高画质两档，工具栏的「高画质」按钮可切换，偏好通过宿主注入的 StorageAdapter 按世界和账号隔离。高画质将渲染像素比上限从 1.6 提高到 2，近景鱼使用更密的鱼身、鱼鳍和眼部网格，并增加鳞片、表面光泽、256 像素焦散纹理、水面细纹和 2048 像素动态阴影。阴影使用与鱼身相同的游动变形；半透明鱼不投射实体阴影。两档均保留按鱼群数量和观看距离降低渲染开销的机制。切换不重建场景、不改变视角或游动状态，也不修改作品、版本与哈希。高画质会增加显卡负担，旧低画质偏好不再读取。

首版验收见 [2026-11-03 记录](evidence/fish-2026-11-03.md)。

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
make env-exec ARGS="-- pnpm exec playwright test e2e/fish-letters.spec.ts"
# Long browser verification uses a fixed production build, without hot reload.
# FISH_SOAK=1 make env-exec ARGS="-- pnpm exec playwright test e2e/fish.spec.ts --output test-results/fish-production"
```

`make fish-test-db` 使用 checkout 的托管数据库建立一次性 schema 和影子表，验证版本、并发幂等、隐私、成员退出、容量与事务回滚，结束后删除测试 schema。浏览器测试通过 TestApiClient 创建并删除隔离世界，不使用真实 Agent CLI。真实 Codex 等客户端接入需要另行授权烟测。

性能上限、十分钟浏览器运行和真实设备兼容性应以实际验收记录为准。纯逻辑十分钟模拟测试不等于浏览器帧率或 GPU 内存验收。
