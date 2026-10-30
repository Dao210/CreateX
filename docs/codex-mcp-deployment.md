# 在 Codex 中部署与接入 Createx MCP

Createx 当前已实现经典坦克角色协议 `tank-defense@1`。Codex 可以通过 MCP 读取目录、校验和保存角色，再创建工作区内的坦克对局。模型由 Codex 提供，服务端负责确定性校验、编译和持久化，不需要额外配置生成模型。

已有可访问的站点时，优先在坦克页面点击「连接 Agent」→「复制连接指令」，粘贴给 Codex 完成安装和配置；首次连接按提示在浏览器登录。该流程使用站点自带的 Node 连接器，无需编译 Auro CLI。以下步骤用于本项目开发环境的部署与高级手动配置。

本机使用推荐 stdio：Codex 启动本项目的 `auro tanks mcp`，CLI 使用独立 profile 的凭据访问 Createx API。API、Web 和 PostgreSQL 由项目环境单独运行，Codex 不负责启动主站。已有远程主站时，也可以使用第 6 节的 HTTP 配置。

角色协议、工具字段与限制见[坦克角色 MCP](tank-character-mcp.md)。`ground2d@1` 通用自由拼装角色仍是设计稿，不适用于本接口。

## 1. 准备环境并确认地址

准备 Go、符合根目录 `package.json` 要求的 Node.js 和 pnpm，以及可连接的 PostgreSQL 与 PostgreSQL 客户端工具。本地默认直接使用 `DATABASE_URL`，不要求 Docker。首次安装或依赖检查提示安装过期时，在仓库根目录执行 `pnpm install --frozen-lockfile`。

下面的路径和端口仅为示例，替换为自己的 checkout 和 `make status` 输出。后续 shell 命令在同一终端执行：

```sh
CREATEX_ROOT="/absolute/path/to/createx"
CREATEX_API_URL="http://localhost:18520"
CREATEX_APP_URL="http://localhost:13440"
CREATEX_PROFILE="createx-tanks"

cd "$CREATEX_ROOT"
make status
make up C=api,web MODE=production
make status
```

日常本地使用采用 `MODE=production`；开发热更新采用 `MODE=development`。启动脚本会检查数据库连接、按规则创建缺失的本地数据库并执行迁移；远程数据库需要预先存在。

| 参数 | 来源与用途 |
| --- | --- |
| `CREATEX_ROOT` | 当前仓库的绝对路径 |
| `CREATEX_API_URL` | `make status` 中 api 的 HTTP 地址，传给 CLI 的 `--server-url` |
| `CREATEX_APP_URL` | `make status` 中 web 的地址，用于浏览器登录和游玩 |
| `CREATEX_PROFILE` | 当前环境的独立 CLI 配置名；登录与 MCP 配置必须一致 |
| 工作区 UUID | 从游戏页面的「连接 Agent」配置或第 3 节命令获取；不使用工作区 slug 或 UUID 短前缀 |

确认 api、web 处于 `running`，数据库可连接。若显示 `mismatch`，先核对端口所属环境并解决冲突，不要把其他 checkout 的监听进程当作本环境。工作树的数据库与端口交给现有环境脚本和 `.env.worktree` 管理，不复制其他 checkout 的 `.env`。

## 2. 编译提供 MCP 的 CLI

```sh
cd "$CREATEX_ROOT/server"
go build -o bin/auro ./cmd/auro
"$CREATEX_ROOT/server/bin/auro" tanks mcp --help
```

后续使用这个二进制的绝对路径，避免 PATH 中的旧版 `auro` 缺少 `tanks mcp` 命令，也不需要覆盖其他项目的 CLI 链接。stdio 进程由 Codex 按需启动，不需要手动常驻运行；单独运行该命令后等待输入属于正常行为。

## 3. 登录并获取工作区 UUID

在本机终端中执行：

```sh
AURO_APP_URL="$CREATEX_APP_URL" \
  "$CREATEX_ROOT/server/bin/auro" \
  --server-url "$CREATEX_API_URL" \
  --profile "$CREATEX_PROFILE" \
  login
```

浏览器中使用**实际游戏页面同一环境、同一账号**完成登录。显式传入 `AURO_APP_URL`，使新的 profile 能找到 Web 登录页；`--server-url` 则指向 API。

```sh
"$CREATEX_ROOT/server/bin/auro" \
  --server-url "$CREATEX_API_URL" \
  --profile "$CREATEX_PROFILE" \
  auth status

"$CREATEX_ROOT/server/bin/auro" \
  --server-url "$CREATEX_API_URL" \
  --profile "$CREATEX_PROFILE" \
  workspace list --full-id
```

记录目标工作区的完整 UUID 和 slug。也可以打开 Web 的 `/{workspaceSlug}/tanks`，点击「连接 Agent」并展开「手动配置」，选择 Codex 并填写 CLI 绝对路径，复制页面生成的配置与登录命令。页面生成的 profile 通常为 `tanks-<UUID前8位>`；若采用该配置，登录时也使用它，不要混用本例的 `createx-tanks`。

CLI 将凭据存入 `~/.auro/profiles/<profile>/config.json`。本机 stdio 的 Codex 配置无需填写 Token，也不会读取浏览器登录凭据。

## 4. 配置 Codex

推荐合并到项目根目录的 `.codex/config.toml`；需要在其他项目中使用时，合并到用户级 `~/.codex/config.toml`。同一服务选择一处配置，项目配置需要项目已受信任。相关配置范围与字段见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

```toml
[mcp_servers.createx_tanks]
command = "/absolute/path/to/createx/server/bin/auro"
args = [
  "--server-url", "http://localhost:18520",
  "--workspace-id", "<工作区完整UUID>",
  "--profile", "createx-tanks",
  "tanks", "mcp"
]
startup_timeout_sec = 20
tool_timeout_sec = 45
```

将二进制路径、API 地址、UUID 和 profile 替换为前面确认的值。TOML 中填写实际字符串，不会自动展开前面的 shell 变量。已有配置文件应合并对应表，不覆盖其他设置，也不提交个人绝对路径配置或凭据。

如使用 Codex 的 MCP 设置界面，新增名为 `createx_tanks` 的 STDIO 服务，填写相同的 command 和 args。若选择通过 CLI 登记用户级配置，可执行以下命令；它与上面的配置文件方式选一即可：

```sh
codex mcp add createx_tanks -- \
  "$CREATEX_ROOT/server/bin/auro" \
  --server-url "$CREATEX_API_URL" \
  --workspace-id "<工作区完整UUID>" \
  --profile "$CREATEX_PROFILE" \
  tanks mcp
```

保存后重载 MCP 服务或重启 Codex，并在新聊天中验收。查看配置登记情况可以运行 `codex mcp list`；CLI 会话中也可用 `/mcp` 查看连接状态。新增配置需要客户端重新加载，不能只凭文件已保存就认定当前聊天已有工具。[OpenAI 官方连接说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

## 5. 验收连接与完整调用

### 5.1 先进行只读验收

对 Codex 发送：

> 调用 createx_tanks 的 tank_get_catalog，列出可用部件、预算、地图和玩法，暂不保存角色。

成功响应应包含 `profile: tank-defense@1`、预算 9 点、三类部件、六张地图，以及 `campaign`、`blitz`、`survival` 三种玩法。`codex mcp list` 只证明配置已登记，实际工具调用成功才证明凭据、工作区和服务链路可用。

### 5.2 创建角色和对局

确认要写入角色库后，对 Codex 发送：

> 创造一辆绿色轻型坦克，轻装甲、速射炮、条纹涂装。读取目录，校验并保存角色，在 frontline 地图创建 campaign 对局，返回 playUrl。

正常顺序为：

```text
tank_get_catalog
  → tank_validate_character
  → tank_save_character
  → tank_check_compatibility
  → tank_create_session
  → 返回并打开 playUrl
```

绿色轻型坦克可使用以下草稿，成本为 8/9：

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
    "body": "#26B36A",
    "accent": "#E5F79B",
    "pattern": "stripe"
  }
}
```

保存后使用服务端返回的 `id`、`revision` 和 `contentHash` 进行兼容检查和创建对局，不自行构造角色引用。每次有意保存或创建对局生成新的 UUID `requestId`；网络结果未知时，复用原 `requestId` 和完全相同的参数重试。

成功的 `playUrl` 形式为 `{WebOrigin}/{workspaceSlug}/tanks?session={sessionId}`。浏览器使用创建对局的同一账号登录，点击「开始守卫」，再以键盘或触屏游玩。对局固定角色版本，有效期 24 小时；刷新会重新开始，不恢复进行中的战斗。MCP 不逐帧操纵坦克。

2026-10-25 已在 Codex 中实际通过目录读取、上述草稿校验、角色保存、`frontline` 地图兼容检查和 `campaign` 对局创建，并取得 `playUrl`。这证明 MCP 创建链路可用；浏览器内移动、射击和战斗应另外验收。这里不保留会过期的对局链接。

## 6. 已有远程主站时使用 HTTP

需要跨机器使用时，先部署可持续运行的 Createx API、Web 和 PostgreSQL，并配置 HTTPS、API 路由与正确的 Web 地址，使返回的 `playUrl` 可从玩家机器访问。本地 `make up MODE=production` 的含义是本地 Web 生产模式，不等于完成公网发布。

Codex 可直接使用已有 HTTP MCP 入口，无需在客户端启动 CLI：

```toml
[mcp_servers.createx_tanks]
url = "https://createx.example.com/api/tanks/mcp"
bearer_token_env_var = "CREATEX_TOKEN"
http_headers = { "X-Workspace-ID" = "<工作区完整UUID>" }
startup_timeout_sec = 20
tool_timeout_sec = 45
```

示例域名需要替换为实际可访问的地址，并用该配置替换 stdio 配置。`CREATEX_TOKEN` 使用目标环境中有工作区访问权的 Auro PAT，放入启动 Codex 的进程环境，不写入仓库或 URL。桌面应用从 Dock 启动时不一定继承终端环境，应确认它能读取该变量。HTTP 的 Bearer 和请求头字段见 [OpenAI 官方配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

本服务使用现有 Auro 认证，没有 MCP OAuth 授权入口，不能用 `codex mcp login createx_tanks` 代替 PAT 或 CLI profile 登录。另一种接法是在 Codex 所在机器运行本机 stdio CLI，将 `--server-url` 指向远程 API，登录时将 `AURO_APP_URL` 指向远程 Web。

远程 HTTP 接入后，仍按第 5 节先验收只读调用，再创建角色和对局。

## 7. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 主站启动失败、数据库不可连接 | 检查 `DATABASE_URL` 和 PostgreSQL 服务；按 `make status` 定位环境，不另建一个假定实例 |
| Web 或 API 显示 `mismatch` | 核对端口所属环境，解决冲突后再启动当前 checkout |
| `unknown command "tanks"` | 重新编译本项目 CLI，并将 command 指向其绝对路径 |
| `No app URL configured` | 登录时传入正确的 `AURO_APP_URL`，或为同一 profile 配置 `app_url` |
| 提示先登录、HTTP 401 | 核对 profile 和目标 API 环境；凭据失效时重新执行同一 profile 的登录命令 |
| HTTP 403 或工作区不可访问 | 使用完整 UUID，确认账号是工作区成员；核对是否继承了其他环境的 `AURO_TOKEN`，带 Origin 的 HTTP 请求还需符合主站允许列表 |
| 服务已登记，聊天没有工具 | 核对配置范围和项目受信任状态，重载 MCP 或重启客户端，并开新聊天 |
| `tools/list` 缺少工具，或返回 `mcp_service_disabled` / `mcp_tool_disabled` | 让配置在服务端 `AURO_ADMIN_EMAILS` 中的全局管理员检查 `/admin` 的 MCP 策略；工作区管理员身份不授予全局权限 |
| 浏览器访问 `/api/tanks/mcp` 返回 405 | 该入口处理 MCP POST；GET 不提供 SSE 流，不能用浏览器打开它来测试连通性 |
| `playUrl` 无法打开或返回无权限 | 确认 Web 地址可达、浏览器与创建对局使用同一账号，且对局尚未过期 |
| 已保存角色，但对局创建结果未知 | 保留保存得到的角色引用，使用原请求参数和 `requestId` 重试创建对局，不重复保存角色 |

本地停止主站使用仓库根目录的 `make down`，它保留数据。恢复时重新执行 `make up C=api,web MODE=production`；单独重载 Codex MCP 不会启动主站。

## 相关文件

- [坦克角色 MCP：协议、权限、幂等与接口](tank-character-mcp.md)
- [MCP 工具 Schema](tank-character-mcp-tools.json)
- [坦克 HTTP OpenAPI](tank-character-api.openapi.json)
- [角色目录与草稿 Schema](../packages/core/tank-defense/character-catalog.json)
- [CLI 的 stdio 实现](../server/internal/cli/tanks_mcp.go)
- [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
