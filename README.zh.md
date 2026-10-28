<div align="center">

# 织个世界 · Weave a World

**创造生命，编织世界。**

一款开发中的创造型冒险与虚拟文明模拟游戏。
创造角色与装备，让作品接受游戏的检验，逐步成为世界故事的一部分。

[项目网站](https://weavea.world) · [English](README.md) · [本地运行](#本地运行) · [Agent 创作](#让-agent-参与创造) · [文档导航](#文档导航)

<img src="apps/web/public/images/weave-a-world-social.png" alt="织个世界 — 创造生命，编织世界" width="900">

</div>

## 我们在做什么

**你的创造，让世界发生改变。**

画一件武器、组装一个角色，或让 Agent 帮你表达想法。把作品带进游戏，
观察它如何行动、为什么成功或失败，再改造下一版。我们围绕这条循环构建游戏：

**创造 → 游玩 → 观察 → 改造 → 在世界里留下痕迹。**

当前仓库包含可玩的防守游戏、谈判游戏和自动世界原型。
共享且持续演化的虚拟文明是长期方向；现阶段，作品还不能在这些游戏之间自由通用。

## 现在可以体验什么

| 体验 | 你可以做什么 | 入口与当前范围 |
| --- | --- | --- |
| **涂鸦攻城 · Doodle Siege** | 绘制或组装武器，测试真实物理表现，部署防线并挑战战役。 | `/{workspaceSlug}/siege` 与 `/{workspaceSlug}/siege/campaign`。使用主应用的 Web/Desktop 和账号。 |
| **坦克守城 · Tank Defense** | 在点数预算内搭配部件，驾驶坦克挑战战役、限时突击与无尽防守。 | `/{workspaceSlug}/tanks`。支持 Web/Desktop、键盘和浏览器触屏操作；外部 Agent 可通过 MCP 创建坦克。 |
| **个人收藏** | 查看自己的 Siege 蓝图、坦克角色与个人进度。 | `/{workspaceSlug}/me`。按账号和工作区隔离；个人成绩由客户端上报。 |
| **REACH 世界预览** | 观察实体争夺补给、战斗和留下残骸，也可通过 HTTP API 投入作品。 | 首页公开预览与独立的实验性世界服务。页面区分实时、预览和断连状态；浏览器内的创作流程尚待完成。 |
| **DEAL** | 利用对话、证据和房间内的物品，与讨债人谈判。 | 独立运行的 `/deal`。支持显式选择的规则试玩，以及配置语言模型后的 AI 模式。 |

体验 Siege 和坦克时，在本地 Web 地址登录、完成首次进入流程，再从工作区侧栏打开游戏。
普通防守玩法不需要模型配置；Siege 也支持不依赖 AI 识别的手动部件确认。
原生移动端尚未接入这些游戏。

## 让 Agent 参与创造

人和 Agent 应当能为同一个游戏创作。Agent 提交结构化草稿，
版本化的部件目录与确定性规则负责校验，并计算作品的游戏属性。

**已经实现的 MCP 创作链路是坦克：**读取目录 → 校验草稿 → 保存角色版本 →
检查兼容性 → 创建冻结对局 → 打开返回的 `playUrl` 游玩。
Agent 帮你创造坦克，玩家负责驾驶。可从游戏中的「连接 Agent」开始，
具体步骤见[坦克角色 MCP](docs/tank-character-mcp.md)。

当前各协议的范围不同：

| 协议 | 状态 |
| --- | --- |
| `tank-defense@1` | 已实现坦克角色目录、HTTP API、MCP 和冻结版本对局。 |
| `reach.entity/1` | REACH 实验性实体提交与世界规则，与坦克协议独立。 |
| `ground2d@1` | 通用自由拼装方案；[技术规范](docs/character-game-api.md)仍是设计稿，不能当作已实现接口调用。 |

不同 MCP 客户端的配置与认证能力需要分别确认。
环境准备、接入方式和验收边界见[连接指南](docs/codex-mcp-deployment.md)。

## 本地运行

除非另有说明，命令均从仓库根目录执行。

### 主应用：Siege、坦克与个人收藏

准备以下依赖：

- 满足根目录 [package.json](package.json) 中 `engines` 要求的 Node.js。
- 同一文件 `packageManager` 声明的准确 pnpm 版本。
- [server/go.mod](server/go.mod) 声明的 Go 版本。
- 已启动的 PostgreSQL 17+，以及可用的 `psql`、`pgcrypto` 和 `pg_trgm`。

新主检出目录首次配置时，复制一次示例文件，编辑 `.env` 中的 `DATABASE_URL`，
使用已存在的 PostgreSQL 登录角色：

```bash
cp .env.example .env
```

然后安装依赖并启动：

```bash
pnpm install --frozen-lockfile
make up MODE=development
make status
```

打开 `make status` 显示的 Web 地址。托管环境会为当前目录分配端口和数据库，
执行迁移并启动 API 与 Web。配置角色有权限时可自动创建缺失的本地数据库；
远程数据库必须提前存在。需要 Docker PostgreSQL 时，显式运行 `make db-up`。

```bash
make up MODE=production    # 日常本地使用，构建并复用 .next-local
make up MODE=development   # 开发热更新
make status                # 查看地址、组件状态和当前 Web 模式
make down                  # 停止当前环境，保留数据
```

当前目录会记住选择的 Web 模式。Git worktree 使用 `make worktree-env`
生成自己的 `.env.worktree`，不要复制主检出目录的 `.env`。
环境管理详见 [Make 命令参考](docs/make-commands.md)与 [scripts/dev-env.sh](scripts/dev-env.sh)。

### DEAL：独立规则试玩

DEAL 需要 Node.js、pnpm 和 Go，无需工作区账号或 PostgreSQL：

```bash
pnpm install --frozen-lockfile --filter @auro/deal...
DEAL_MODEL_MODE=scripted make up C=deal
make status C=deal
make down C=deal
```

默认 Web 地址为 `http://127.0.0.1:13106/deal/`，会话与日志保存在 `.deal/`。
使用模型玩法时，参考 [.env.example](.env.example) 配置 `DEAL_MODEL_MODE=llm`
及 `DEAL_LLM_*`，然后重启 DEAL。模型失败不会自动切换成规则试玩。
详见 [DEAL 运行与交付说明](docs/deal-delivery.md)。

### REACH：实验性世界服务

REACH 当前使用独立、单实例的文件存储服务，主应用的 `make up` 不会启动它：

```bash
cd server
REACH_DATA_DIR=.reach REACH_SEED=42 REACH_BEAT_SECONDS=1 go run ./cmd/reach
```

API 默认监听 `http://127.0.0.1:18107`，能力发现入口为
`/.well-known/reach.json`。一秒一拍用于本地演示，默认节拍为 60 秒。
前台运行时按 Ctrl+C 停止。

首页默认请求同源的 `/api/reach`。展示该服务的实时世界，需要将
`/api/reach/*` 和 `/.well-known/reach.json` 路由到它；单独启动服务不会自动连接首页。
没有实时连接时，首页可以展示已标注的预览数据。
接口、赛季归档与创作页面等待办见 [REACH 设计与实现说明](docs/reach-world-prd.md)。

## 代码结构

| 位置 | 职责 |
| --- | --- |
| `apps/web` | Next.js 公共游戏页面与需登录的工作区路由。 |
| `apps/desktop` | Electron 宿主，复用共享游戏页面与逻辑。 |
| `packages/core` | 无界面的游戏规则、目录、Schema、API 客户端与共享状态。 |
| `packages/views` | 共享游戏界面、Canvas 绘制、物理、输入与音频。 |
| `packages/ui` | 共享 UI 原语与语义样式。 |
| `server/internal/siege`、`tanks`、`gameprogress` | 主应用的游戏 API、创作存储和个人进度。 |
| `apps/deal`、`server/internal/deal` | 独立谈判游戏。 |
| `server/internal/reach`、`server/cmd/reach` | 实验性自动世界引擎、HTTP API 与服务入口。 |
| `apps/mobile` | 独立 Expo/React Native 客户端，游戏接入待完成。 |

项目基于 Auro 的账号、工作区、Agent 与运行时基础设施演进，内部仍使用
`@auro/*` 包名和 `AURO_*` 配置。Issue、Project、my-issues 和 Squad 的界面路由已退役，
当前工作区默认进入聊天。

## 验证

按改动范围选择游戏检查，具体命令见对应文档。主项目前后端检查为：

```bash
pnpm typecheck
pnpm lint
pnpm test
make test
```

先显式启动主应用，再运行需登录的游戏浏览器测试：

```bash
pnpm exec playwright test e2e/siege e2e/tanks.spec.ts e2e/tanks-mcp.spec.ts
```

DEAL 使用独立的[检查与 Playwright 配置](docs/deal-delivery.md)。
REACH 的 Go 测试为 `(cd server && go test ./internal/reach)`。
根目录前端检查不覆盖原生移动端，移动端另见其 [README](apps/mobile/README.md)
与[开发规则](apps/mobile/AGENTS.md)。

## 文档导航

| 主题 | 文档 |
| --- | --- |
| 品牌与公共网站 | [品牌和搜索身份](docs/brand-and-seo.md) |
| 本地环境 | [Make 命令参考](docs/make-commands.md) |
| Siege 工坊与战役 | [工作区集成](docs/siege-integration-plan.md) · [林地战役](docs/siege-campaign-delivery.md) |
| 坦克规则与操作 | [坦克守城](docs/tank-defense.md) |
| Agent 创建坦克 | [坦克 MCP](docs/tank-character-mcp.md) · [客户端配置](docs/codex-mcp-deployment.md) |
| 自动世界方向 | [REACH PRD 与原型状态](docs/reach-world-prd.md) |
| 谈判游戏 | [DEAL PRD](docs/deal-prd.md) · [运行与交付](docs/deal-delivery.md) |
| 通用角色协议提案 | [技术规范](docs/character-game-api.md) |
| 仓库贡献规则 | [AGENTS.md](AGENTS.md) |

设计文档可能包含尚未实现的内容，功能是否可用应结合其实现说明与所属源码判断。

## 许可与来源

本仓库包含源自 Auro 的代码，现有 [Auro License](LICENSE) 与[归属声明](NOTICE)
继续适用，具体条款以这两个文件为准。
