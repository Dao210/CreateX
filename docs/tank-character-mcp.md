# 坦克角色 MCP：外部 Agent 创建并进入游戏

经典坦克的 `tank-defense@1` 已实现。Codex、WorkBuddy 等客户端可以通过 MCP 创建角色、保存版本、选择地图与玩法，再打开 Auro 工作区内的坦克游戏。AI 由调用方 Agent 提供：Agent 根据目录生成结构化草稿，服务端执行确定性校验与编译，不需要额外配置生成模型。

这里实现的是现有四方向坦克游戏的角色协议。自由几何、多刚体、贴图上传、固定炮塔和 MCP Apps 内嵌仍属于 [ground2d 通用设计](character-game-api.md)，不能把那份草稿发给本接口。

## 1. 接入与首次使用

Codex 从环境启动、CLI 登录、配置到实际调用验收的完整步骤见[在 Codex 中部署与接入 Createx MCP](codex-mcp-deployment.md)。

先启动 Auro，再构建带 `tanks mcp` 命令的 CLI：

```sh
make up C=api,web
cd server
go build -o bin/auro ./cmd/auro
```

打开 `/{workspaceSlug}/tanks`，点击「连接 Agent」，复制当前工作区的配置。外部 Agent 运行的机器必须能访问配置中的服务地址；本机 `localhost` 地址不能交给另一台机器上的 Agent。

开发环境中如果 PATH 中的 `auro` 仍是旧版本，将配置的 `command` 改为本项目 `server/bin/auro` 的绝对路径。不要覆盖其他项目的 CLI 链接。

使用对话框给出的独立 profile 登录**游戏页面同一环境的同一账号**。例如：

```sh
/absolute/path/to/createx/server/bin/auro \
  --server-url http://localhost:13440 \
  --profile tanks-12345678 login
```

这一步使用现有 Auro 登录流程。凭据由 CLI 配置管理；MCP 配置不包含 Token，不读取浏览器里的登录凭据，也不会自动登录另一个账号。

Codex 的项目 `.codex/config.toml` 或其 MCP 设置使用：

```toml
[mcp_servers.auro_tanks]
command = "/absolute/path/to/createx/server/bin/auro"
args = ["--server-url", "http://localhost:13440", "--workspace-id", "<workspace-uuid>", "--profile", "tanks-12345678", "tanks", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 45
```

在支持本机 stdio 的 WorkBuddy MCP 配置中使用同一命令：

```json
{
  "mcpServers": {
    "auro_tanks": {
      "command": "/absolute/path/to/createx/server/bin/auro",
      "args": ["--server-url", "http://localhost:13440", "--workspace-id", "<workspace-uuid>", "--profile", "tanks-12345678", "tanks", "mcp"]
    }
  }
}
```

若 WorkBuddy 的连接器只接受远程传输，使用下面的 Streamable HTTP 接口及客户端凭据配置。发布到 WorkBuddy 连接器目录所需的 Skill、元信息与平台审核不在本实现范围内。

配置保存后，在客户端重载 MCP 服务。新配置不会动态进入已经运行的当前聊天工具清单。可以对 Agent 说：

> 创造一辆绿色轻型坦克，采用轻装甲和速射炮、条纹涂装。先读取坦克目录，校验并保存角色，再在红砖前线创建战役对局，返回游玩地址。

Agent 打开返回的 `playUrl` 后，用户在坦克页面点击「开始守卫」，使用键盘或触屏游玩。角色库也提供创造、改装和开始新对局按钮。

## 2. 真实接口与机器可读契约

| 接口 | 地址 |
| --- | --- |
| MCP stdio | `auro --server-url <Auro地址> --workspace-id <UUID> --profile <独立配置> tanks mcp` |
| MCP Streamable HTTP | `POST {AuroOrigin}/api/tanks/mcp` |
| HTTP API | `{AuroOrigin}/api/tanks/v1` |
| 游戏页面 | `{AuroOrigin}/{workspaceSlug}/tanks?session={sessionId}` |
| OpenAPI 3.1 | [tank-character-api.openapi.json](tank-character-api.openapi.json) |
| MCP 工具 Schema | [tank-character-mcp-tools.json](tank-character-mcp-tools.json) |
| 部件、预算与草稿 Schema | [character-catalog.json](../packages/core/tank-defense/character-catalog.json) |

HTTP/MCP 请求复用 Auro 的 Bearer 认证和 `X-Workspace-ID`。CLI 自动携带当前 profile 的凭据；Auro 任务内执行时沿用服务器签发的任务凭据及其绑定工作区。客户端提交的 workspace 字段不能覆盖任务绑定。角色库可由工作区成员读取，只有角色创建者能提交改装版本；对局只供创建它的账号读取。

直接调用 MCP HTTP 时发送：

```http
Authorization: Bearer <Auro-PAT-or-session-token>
X-Workspace-ID: <workspace-uuid>
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-11-25
```

该入口使用现有 Auro 认证，没有新增 MCP OAuth 授权服务器。需要 OAuth 自动发现的客户端应使用已登录的 stdio CLI，或显式配置现有 Bearer 凭据。不要把凭据写进仓库、URL 或角色草稿。

服务是无状态 Streamable HTTP：初始化协商版本，通知返回 202，普通请求返回 JSON，不创建 MCP 会话 ID。GET 返回 405，因为没有 SSE 推送流。Origin 存在时必须在主站允许列表中。

## 3. 角色草稿与确定性编译

```json
{
  "profile": "tank-defense@1",
  "name": "森林侦察者",
  "parts": {
    "chassis": "light",
    "armor": "light",
    "cannon": "rapid"
  },
  "appearance": {
    "body": "#26b36a",
    "accent": "#e5f79b",
    "pattern": "stripe"
  }
}
```

| 字段 | 可选值 / 约束 |
| --- | --- |
| profile | 必须为 `tank-defense@1` |
| name | 1–40 个 Unicode 字符，无首尾空白或控制字符 |
| parts.chassis / armor | `light`、`standard`、`heavy` |
| parts.cannon | `rapid`、`standard`、`heavy` |
| appearance.body / accent | `#RRGGBB` 六位颜色 |
| appearance.pattern | `solid`、`stripe`、`cross` |

部件总成本最多 9 点。角色尺寸与碰撞规则固定；速度、装甲、弹速和射击间隔从目录计算，拒绝 Agent 提交的额外战斗数值、脚本、贴图 URL 或未知部件。超预算返回具体字段问题，不降级成预设坦克。

上例编译结果是速度 106、装甲 1、弹速 220、射击间隔 15 帧、成本 8。渲染器读取角色颜色和涂装，战斗引擎读取编译后的 `TankBlueprint`，地图与玩法不依赖创建 Agent。

`POST /api/tanks/v1/characters/validate` 提交 `{ "draft": 上面的草稿 }`，成功校验的响应格式如下；MCP 校验工具的 `structuredContent` 使用相同格式：

```json
{
  "valid": true,
  "errors": [],
  "blueprint": {
    "id": "custom",
    "speed": 106,
    "armor": 1,
    "projectileSpeed": 220,
    "fireInterval": 15,
    "score": 0,
    "appearance": { "body": "#26b36a", "accent": "#e5f79b", "pattern": "stripe" }
  },
  "cost": 8,
  "budget": 9
}
```

不合法的草稿返回 `valid:false`、字段路径形式的 `errors` 和成本，不返回 blueprint。保存接口遇到同样问题则返回 HTTP 422 / MCP `isError:true`，不创建角色。

支持六张地图：`frontline`、`river`、`steel`、`depot`、`circuit`、`citadel`；支持 `campaign`、`blitz`、`survival` 三种玩法。未指定 mode 时为 `campaign`。

## 4. MCP 调用案例

先 `initialize`，再发送 `notifications/initialized` 和 `tools/list`。工具如下：

| 工具 | 作用 |
| --- | --- |
| `tank_get_catalog` | 获取协议、部件、预算、地图和玩法 |
| `tank_validate_character` | 校验草稿并预览参数 |
| `tank_save_character` | 新建角色或追加改装版本 |
| `tank_list_characters` | 当前工作区角色库 |
| `tank_get_character` | 当前或指定历史版本 |
| `tank_check_compatibility` | 检查角色固定版本与地图 |
| `tank_create_session` | 冻结角色、起始地图与玩法，返回可玩地址 |
| `tank_get_session` | 读取本账号的冻结对局内容 |

保存角色：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "tank_save_character",
    "arguments": {
      "requestId": "11111111-1111-4111-8111-111111111111",
      "draft": {
        "profile": "tank-defense@1",
        "name": "森林侦察者",
        "parts": { "chassis": "light", "armor": "light", "cannon": "rapid" },
        "appearance": { "body": "#26b36a", "accent": "#e5f79b", "pattern": "stripe" }
      }
    }
  }
}
```

成功 `result.structuredContent` 是完整角色包，包含 `id`、`revision`、`contentHash`、`draft`、`blueprint` 和归属信息。角色包还包含 `origin`（`manual` 或 `mcp`），用于 `/{slug}/me` 个人收藏区分 MCP 创作；`GET /api/tanks/v1/characters?mine=1` 只返回当前账号创建的角色。使用服务器实际返回的引用创建对局：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tank_create_session",
    "arguments": {
      "requestId": "22222222-2222-4222-8222-222222222222",
      "characterId": "<角色包 id>",
      "revision": 1,
      "contentHash": "<角色包 contentHash>",
      "mapId": "frontline",
      "mode": "campaign"
    }
  }
}
```

成功结果包含 `id`、`playPath`、`playUrl`、完整冻结角色、地图版本、mode 和 `expiresAt`。启动地址没有用户 Token，也不会替用户登录；打开地址的账号必须与创建对局的账号一致。

追加角色版本时，在 `tank_save_character` 中增加 `characterId` 和 `expectedRevision`，使用新的 requestId。并发提交基于同一旧版本时只有一次成功，其余返回 `revision_conflict`。读取历史版本使用 `tank_get_character({characterId, revision})`。

每次有意保存或创建对局都生成新的 UUID requestId。网络结果未知时，保持同一 requestId 和完全相同的参数重试；7 天内返回原结果。复用同一 requestId 提交不同内容返回 `idempotency_key_reused`，不会额外创建角色或对局。

工具业务错误使用 `isError:true`，文字内容是 `{ "error": { "code": "...", "message": "...", "issues": [...] } }`，没有成功的 structuredContent。草稿校验工具以 `valid:false` 返回字段问题，这是校验报告，不代表角色已保存。未知工具、未知方法和非法 JSON-RPC 信封返回协议错误。

## 5. HTTP 对应格式

| 方法 / 路径 | 请求体 / 查询 |
| --- | --- |
| GET `/catalog` | 无 |
| POST `/characters/validate` | `{draft}` |
| GET `/characters` | 无；返回 `{characters: [...]}` |
| POST `/characters` | `{requestId, draft, characterId?, expectedRevision?}` |
| GET `/characters/{id}?revision=1` | revision 省略时取最新版 |
| POST `/compatibility` | `{characterId, revision, contentHash, mapId, mode?}` |
| POST `/sessions` | `{requestId, characterId, revision, contentHash, mapId, mode?}` |
| GET `/sessions/{id}` | 无 |

路径均加 `/api/tanks/v1` 前缀。响应模型和字段范围见生成的 OpenAPI。HTTP 错误是 `{requestId, error:{code,message,issues?}}`，主要状态为 400/401/403/404/409/410/413/415/422/429/503。请求体最多 64 KiB；重复 JSON 键、额外字段和非法资源引用会被拒绝。

## 6. 冻结语义与当前范围

角色及其不可变版本保存在服务端，独立于聊天和浏览器。每个工作区最多 128 个角色，每个角色最多 50 个版本；每个账号和工作区最多 100 个有效对局。对局有效期 24 小时，已加载的本地战斗不依赖 Agent 持续在线。

对局固定角色版本、内容哈希、起始地图、规则版本与玩法。角色库后续改装不会改变当前战斗；战役按固定规则继续后续关卡。对局页的地图和玩法切换被锁定，需要通过角色库「开始新对局」更换。客户端会重新编译并比对角色参数；不支持的版本或错误包明确报错，不替换成经典坦克。

刷新对局地址会用原角色重新开始该对局，**没有保存进行中的物理世界或战斗进度**。分数和解锁仍是按账号、工作区隔离的本机记录，不是可信排名。MCP 不逐帧操纵坦克，`tank_get_session` 也不是实时战况 API。

此实现没有生成服务器、任意武器脚本、图片资源上传、免登录启动票据、MCP Apps 内嵌、多人权威结算或 WorkBuddy 商店发布包。

## 7. 维护与验证

部件数值和输入 Schema 的单一来源是 core 的 `character-catalog.json`。运行 `pnpm generate:tank-contracts` 同步 Go 嵌入文件、MCP 工具 JSON 和 OpenAPI。Go/TypeScript 使用同一份角色样例校验编译结果；修改地图集合时也要同步目录与版本。

```sh
pnpm generate:tank-contracts
pnpm --filter @auro/core exec vitest run tank-defense api/tanks.test.ts
pnpm --filter @auro/views exec vitest run tank-defense locales/parity.test.ts
pnpm --filter @auro/views typecheck
pnpm --filter @auro/web typecheck
pnpm --filter @auro/desktop typecheck:web
cd server && go test ./internal/tanks ./internal/cli -run 'Test(Tank|Strict)' -count=1
```

数据库集成测试使用 `TANKS_TEST_DATABASE_URL` 指向已完成迁移的测试环境，通过 testutil 创建和清理隔离工作区，不清空共享表。主站运行后，从仓库根目录执行 `pnpm exec playwright test e2e/tanks.spec.ts e2e/tanks-mcp.spec.ts`；stdio 用例使用上面构建的 `server/bin/auro`。

已验证的是 MCP 协议、真实 HTTP/stdio 调用、数据库版本/幂等/隔离，以及浏览器内的角色装配与驾驶。Codex/WorkBuddy 的实际模型执行、原生 Mobile、真实手机、桌面安装包和线上部署需要另行验收。

2026-10-24 本地验收：core 及 API/路径测试 139 项、views 及导航/语言测试 375 项通过；Go 坦克/stdio 测试和两项真实 PostgreSQL 集成测试通过；主站两个 Playwright 套件共 9 项通过，覆盖认证与工作区隔离、HTTP/stdio 创建角色、真实移动与射击、颜色渲染、固定角色版本、手机端创造与原有玩法。Web/Desktop 类型检查、相关 ESLint 和 Web 生产构建通过。构建仍有既有 `::highlight` CSS 提示与下载页 GitHub release 404 日志，构建退出成功。

## 官方连接参考

- [OpenAI Docs：Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)：stdio / HTTP、项目配置和服务重载。
- [WorkBuddy 连接器](https://open.workbuddy.cn/docs/connector)：MCP 接入和凭据管理；不同客户端入口的传输能力需单独确认。
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) 与 [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：协议行为。
