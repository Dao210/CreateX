# Doodle Siege 融入 Auro 多端方案

状态：方案，未实施。日期：2026-10-22。
前置文档：[Doodle Siege 技术方案](doodle-siege-architecture.md)（本文推翻其第 2.1 节与第 9 节的独立定位）、[交付与验收](doodle-siege-delivery.md)。

角色创造与地图玩法的下一步模块边界、HTTP/MCP 格式和完整案例见[角色创造与游戏对接接口技术规范](character-game-api.md)。该规范是待实现的新接口契约，不改变本文第 10 节记录的现有集成状态。

坦克守城已拆为独立工作区功能，Web / 桌面路由为 `/{workspaceSlug}/tanks`，与 Siege 平级；地图、操作与本地角色蓝图接口见[坦克守城](tank-defense.md)。

## 0. 结论

1. **这不是"加一个路由"，是把独立产品改成 Auro 的一个 workspace feature。** 现有实现刻意做了四处解耦：匿名 cookie、`.siege/` 文件存储、独立 Vite SPA、自成一套 CSS。融入等于逐一拆掉这四道焊点，每一道都有代价。
2. **web / desktop 可以原生共享，风险可控。** 两者都是 Chromium 运行时，Canvas 2D 和 Rapier wasm 都能跑；真正的工作量在视图抽取和样式归一，不在运行时。
3. **mobile 是唯一有硬约束的一端。** Hermes 不支持 WebAssembly，Rapier 跑不了；RN 也没有 DOM Canvas。移动端无法"原生跑同一套战斗运行时"，只能选路线。本文给出三条，推荐 M3 → M1 分两步。

**必须先拍板的岔路**：本节第 3 条。mobile 是否必须能"玩"，决定这轮是 4 周还是 3 个月。

## 1. 现状：四道焊点

| 维度 | 现状（证据） | 与 Auro 整体的差异 | 融入动作 |
| --- | --- | --- | --- |
| 身份 | 匿名 `siege_owner` cookie，30 天 HttpOnly<br>`server/internal/siege/http.go:108,174` | Auro 用 session + workspace membership | 换成 `RequireWorkspaceMember` 注入的 user/workspace |
| 存储 | `.siege/sessions/` JSON 快照<br>`server/internal/siege/store.go`、`Service` 依赖 `*Store` | PostgreSQL + sqlc | 抽 `Store` 接口，加 PG 实现；文件实现保留给 fixture 模式 |
| 进程 | 独立 `cmd/siege`，18107<br>`server/cmd/siege/main.go:73` | 主 server 单进程 | 路由挂进 `cmd/server/router.go` |
| 前端 | 独立 Vite SPA，`base: "/siege/"`<br>`apps/siege/vite.config.ts:9` | Next.js 路由 + Electron renderer | 抽 `packages/views/siege` |
| 样式 | 自写 300 行 CSS（`styles.css` 142 + `campaign/styles.css` 158） | `packages/ui` token + tailwind | 全量迁移 |
| UI 状态 | 319 行 `app.tsx` 单文件，直连 `SiegeClient` 单例 | views 组件 + Query hooks | 拆分 + 走 core 的 query 约定 |

## 2. 目标架构

```text
packages/core/siege/                三端共用，纯逻辑
  schema / geometry / compiler / cannon / campaign / simulation
  client.ts                         SiegeClient（baseURL 已可注入，无需改）
  platform.ts              新增     SiegePlatform 接口（见 4.2）

packages/views/siege/       新增    web + desktop 共享
  siege-workshop.tsx                工坊（拆自 app.tsx）
  arena/siege-arena.tsx             竞技场容器
  arena/{art,art-layer,effects}.ts  渲染辅助
  workshop/{cannon-workshop,metrics,cannon-painter}
  editor/drawing-canvas.tsx
  runtime/engine.ts                 Rapier 实例（保留在 views，理由见 4.3）
  campaign/{app,engine,painter,sound}.tsx

apps/web/app/[workspaceSlug]/(dashboard)/siege/page.tsx        新增
apps/desktop/src/renderer/src/pages/siege/                    新增
apps/mobile/app/(app)/[workspace]/siege/                      新增

server/internal/siege/
  store.go                         抽 Store 接口
  store_pg.go              新增    PostgreSQL 实现
  http.go                          去 cookie，改用 middleware 上下文
server/cmd/server/router.go        挂 /api/siege（workspace scope）
server/cmd/siege/main.go           保留：独立部署 + fixture 演示模式
```

依赖方向不变：`apps/* → views → core + ui`。

### 2.1 入口 URL 变化

| 场景 | 现在 | 融入后 |
| --- | --- | --- |
| 开发 | `127.0.0.1:13107/siege/play/` | `127.0.0.1:3000/{workspace}/siege` |
| 生产 | `18107/siege/play/` | `{origin}/{workspace}/siege` |
| 独立演示 | 同生产 | 保留 `make up C=siege` → 18107 |

`/siege` 作为 workspace 下的路由，与 `reserved_slugs.json` 无冲突（它在 `[workspaceSlug]` 之下）；但若将来要做 `{origin}/siege` 的产品落地页，需要先注册 slug 并跑 `pnpm generate:reserved-slugs`。本轮不做。

## 3. P1：后端归一

目标：一个进程、一个身份、一个数据库。

### 3.1 数据模型（迁移 `564_siege.up.sql`）

保留领域模型，只换持久化后端 —— 用 JSONB 承载现有 payload，避免为融入而重写 `Service` 的领域逻辑：

```sql
create table siege_sessions (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  version integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index siege_sessions_owner on siege_sessions (workspace_id, user_id, updated_at desc);

create table siege_recognition_receipts (
  request_id uuid primary key,
  session_id uuid not null references siege_sessions(id) on delete cascade,
  state text not null,
  payload jsonb,
  model_meta jsonb,
  created_at timestamptz not null default now()
);
```

蓝图沿用现有做法存在 `payload` 里，不单独建表 —— 现有 `Session.blueprints` 已经是数组，拆分收益为零，反而要重写 `Save` 的版本冲突逻辑。**这是本方案唯一一处刻意的"不规范化"**，理由是蓝图的读写永远是整会话级的。

### 3.2 改动清单

| 文件 | 改动 |
| --- | --- |
| `server/internal/siege/store.go` | 抽 `type Store interface { Close; Create; Read; Save; Receipt; ... }`，把现有逻辑改名 `fileStore` |
| `server/internal/siege/store_pg.go` 新增 | `OpenPGStore(pool)` 实现同一接口，`Save` 用 `select ... for update` 保证 `expected_version` |
| `server/internal/siege/service.go` | `NewService(store Store, ...)`，签名只改类型 |
| `server/internal/siege/http.go` | 删 `owner(r)`、`siege_owner` cookie 读写；`create` 从 context 取 `userID`、`workspaceID` |
| `server/internal/siege/http_test.go` | 去掉 cookie 断言，改为注入 context 的测试辅助 |
| `server/cmd/server/router.go` | workspace group 内加 `r.Route("/api/siege", ...)`（约 1993 行附近） |
| `server/cmd/server/main.go` | 初始化 `siege.Service` 并传给 router；`SIEGE_RECOGNITION_MODE` 未配置时降级为 `disabled`（`status.ready=false`），**不阻止主服务启动** |
| `server/cmd/siege/main.go` | 改为读文件 store 的独立模式，仅供 fixture 演示与 Playwright |
| `scripts/siege-env.sh` | 保留；新增注释说明它是演示环境，不再是唯一入口 |

### 3.3 老数据

`.siege/sessions/` 里的匿名蓝图没有 workspace 归属，**无法自动迁移**。处置：迁移到 `{workspace}/siege` 后，首次进入时提供一次"导入本地蓝图"（读取导出的 JSON 文件，走正常 `Save`），服务端历史存档不迁移。这一点要在发布说明里写明，否则用户会认为存档丢了。

## 4. P2：视图抽取 + web/desktop

### 4.1 抽取顺序（按依赖倒序，保证每步可编译）

1. `editor/drawing-canvas.tsx`（75 行，只依赖 core 类型）
2. `arena/{art,art-layer,effects}.ts`（124 行，纯绘制函数）
3. `workshop/{cannon-painter,metrics,cannon-workshop}`（220 行）
4. `runtime/engine.ts` + `campaign/engine.ts`（589 行，Rapier）
5. `arena/siege-arena.tsx`（112 行）→ 依赖 1、2、4
6. `campaign/{app,painter,sound}`（369 行）
7. `siege-workshop.tsx` ← 最后拆 `app.tsx` 的 319 行

每步在 `packages/views/package.json` 加一条 exports 映射，与现有 `"./agents": "./agents/index.ts"` 同格式。

### 4.2 必须注入的平台能力（这是"多端一致"的真正落点）

`app.tsx` 与 `platform/storage.ts` 现在直接用四个浏览器 API，它们在 mobile 上都不存在：

| 能力 | 现状位置 | web/desktop 实现 | mobile 实现 |
| --- | --- | --- | --- |
| 草稿持久化 | `platform/storage.ts` IndexedDB | IndexedDB | AsyncStorage / expo-file-system |
| 偏好 | `platform/storage.ts` localStorage | localStorage | AsyncStorage（`StorageAdapter` 已有约定） |
| 随机 ID | `crypto.randomUUID`（app.tsx 4 处） | 原生 | expo-crypto |
| 草图哈希 | `crypto.subtle.digest` | 原生 | expo-crypto digest |
| 导出 PNG | `canvas.toBlob` + `document.createElement` | 原生 | expo-file-system + expo-sharing |

定义为 `packages/core/siege/platform.ts`：

```ts
export interface SiegePlatform {
  preferences: StorageAdapter;
  loadDraft(): Promise<WorkshopDraft | null>;
  saveDraft(draft: WorkshopDraft): Promise<void>;
  randomId(): string;
  drawingHash(drawing: Drawing): Promise<string>;
  exportPng(blob: Blob, filename: string): Promise<void>;
}
```

`packages/views/siege` 只接受 `platform` 作为 prop，不 import 任何浏览器全局。web/desktop 各注入一份实现（其实可以共用同一份 `web-platform.ts`，Electron renderer 也有 localStorage/IndexedDB）。

**这一步的收益大于抽物理层**：它让"三端共用 90% 的组件代码"变成现实，而且不需要动 Rapier。

### 4.3 为什么不抽 PhysicsPort

原方案第 6.2 节设计了 `PhysicsPort`，P0 没落地。现在也**不建议**为 web/desktop 补上：两者都是 Chromium，Rapier 直接可用，抽象只会增加一层无收益的间接。

条件触发：只有当 mobile 走 M2（原生重写）时才引入 `PhysicsPort`，届时 core 里的 `simulation.ts` 已经有了规则入口，抽接口的成本远低于现在提前抽象。这符合原方案"出现第三个具体消费者再提取"的原则。

### 4.4 web 接入

```tsx
// apps/web/app/[workspaceSlug]/(dashboard)/siege/page.tsx
import dynamic from "next/dynamic";
const SiegeWorkshop = dynamic(() => import("@auro/views/siege").then(m => m.SiegeWorkshop), { ssr: false });
export default function Page() { return <SiegeWorkshop platform={webPlatform} /> }
```

必须 `ssr: false`：`RAPIER.init()` 与 `canvas.getContext` 在服务端渲染时不可用。

### 4.5 desktop 接入

`apps/desktop/src/renderer/src/routes.tsx` 加一条 workspace 子路由，复用 `workspace-route-layout`。页面首位放 `DragStrip`（`packages/views/platform`）。

desktop **不要**用 `<webview>` 加载远程 `/siege` —— 会绕过 preload 隔离，且离线不可用。原生 import 共享视图，这是能做且应该做的。

### 4.6 样式归一

300 行 CSS 里有 `--paper`、`--ink` 一类游戏专用色。处置：纸张/墨色/战场色保留为 `packages/ui/styles/tokens.css` 的新增 token（前缀 `--siege-`），其余布局走 tailwind。不把游戏色彩塞进 Auro 的语义色板（`--background` / `--primary`），否则会污染后台界面。

## 5. P3：mobile

### 5.1 硬约束（不是选择，是事实）

- **Hermes 无 WebAssembly**：`@dimforge/rapier2d-compat` 依赖 `RAPIER.init()` 编译 wasm，RN 运行时会直接抛错。
- **无 DOM Canvas**：`arena.tsx` 的 `getContext("2d")` 系列调用在 RN 上不存在。
- 因此 mobile **不可能**原生跑 `runtime/engine.ts` 与 `campaign/engine.ts`。

### 5.2 三条路线

| | M1 WebView 容器 | M2 原生重写 | M3 只读（蓝图/战绩） |
| --- | --- | --- | --- |
| 做法 | 加 `react-native-webview`，加载 `{origin}/{workspace}/siege`，携带既有 session | Skia 重画渲染 + 纯 TS 确定性物理替换 Rapier | RN 原生列表页，读 `/api/siege` 展示蓝图与战绩，不跑模拟 |
| 复用 | 100% | core 规则 100%，渲染与物理 0% | core 类型 + client |
| 工作量 | 1–2 周 | 2–3 人月 | 1 周 |
| 一致性风险 | 无（同一份代码） | **高**：两套物理手感必然漂移 | 低 |
| 体验 | 可玩，手势与性能受容器限制 | 原生 | 只能看，不能画和打 |

### 5.3 推荐

**M3 先落地，M1 作为可玩兜底，M2 只在产品明确要求"原生战斗手感"时启动。**

理由：
- M3 一周内让 mobile 真正可用（能看自己的蓝图、能看战绩），体验与 Auro 其他页面一致，不是壳。
- M1 补上"能玩"，代价只有容器和一次登录态注入；`react-native-webview` 是 Expo 官方支持项。
- M2 的成本不在代码量，而在**一致性债**：`hitDamage`、`inkCost`、`campaignStars` 这些规则一旦有第二套物理实现，"形状决定功能"的手感就分叉了，后续每次调平衡都要双端验证。这是本方案最不推荐的路径。

如果产品必须"移动端原生玩"，建议先做 M1 验用户留存，用数据决定是否付 M2 的代价。

## 6. 分期与工作量

| 阶段 | 内容 | 人日（1 人） | 可独立交付 |
| --- | --- | --- | --- |
| P1 | 后端归一（store 接口 + PG + 路由挂载 + 测试） | 6–8 | ✅ web 仍走 13107，但 API 已统一 |
| P2a | views 抽取 + platform 注入 | 8–10 | ✅ 组件可在 storybook/测试中跑 |
| P2b | web 路由 + desktop 路由 + 样式归一 | 5–7 | ✅ 两端可用 |
| P3a | mobile M3 | 4–5 | ✅ |
| P3b | mobile M1 | 5–8 | ✅ |
| P3c | mobile M2（可选） | 40–60 | — |

P1 与 P2a 可以并行（不同人、不同包）。

## 7. 验收断言

```sh
# P1
(cd server && go test ./internal/siege ./cmd/server)
curl -s -b "$AURO_COOKIE" localhost:8080/api/siege/status | jq .mode

# P2
pnpm --filter @auro/core typecheck
pnpm --filter @auro/views typecheck
pnpm --filter @auro/views test -- siege
pnpm --filter @auro/web typecheck
pnpm --filter @auro/desktop typecheck
pnpm exec playwright test --config playwright.config.ts -g siege

# P3
pnpm --filter @auro/mobile typecheck
```

必须成立的行为断言（不是"页面能打开"）：

1. 未登录访问 `/{workspace}/siege` 跳登录；非成员访问返回 403，不泄漏 workspace 是否存在。
2. 同一用户在 web 保存的蓝图，desktop 打开可见；换 workspace 不可见。
3. `expected_version` 冲突返回 409，界面保留当前画图不覆盖（现有行为不能回退）。
4. 识别预算按 user 计，跨端共享同一配额。
5. 断开主 server 时游戏页面给出可恢复错误，不白屏（Rapier 初始化失败路径现有 `physics_unavailable` 已处理）。
6. desktop 下 `DragStrip` 可拖动窗口，Canvas 区不吃拖动事件。
7. 移动端 M3 只调 `GET /api/siege/sessions/{id}`，不请求 `recognitions`。

## 8. 风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 推翻既有架构决策，文档漂移 | 后续维护者按旧文档理解会做错判断 | 同步改 `doodle-siege-architecture.md` 第 2.1、9 节，标注"已由本方案取代" |
| 匿名存档无法迁移 | 用户认为存档丢失 | 提供 JSON 导入；发布说明写明 |
| 主服务引入视觉模型依赖 | 主 server 启动变慢/失败 | `SIEGE_RECOGNITION_MODE` 缺省为 disabled，识别不可用时手动画图仍可用 |
| 识别预算被跨越端滥用 | 成本 | 配额按 user 计，`http.go` 现有 `budget` 逻辑迁移即可 |
| mobile M2 的一致性债 | 长期平衡维护成本翻倍 | 明确不做，除非有留存数据支撑 |
| Rapier wasm 增大 web 首屏 | 首屏变慢 | 路由级 `dynamic` 已是懒加载，不进主 bundle |
| 保留的独立模式与 REACH 抢端口 | 18107 已被 `cmd/reach` 默认占用，`make up C=siege` 会失败 | 独立模式启动时显式设 `SIEGE_API_PORT`，或让 `siege-env.sh` 探测占用后自动 +1 |

## 9. 本方案不做什么

- 不删除 `apps/siege`：它是独立部署与 fixture 演示的载体，也是 e2e 的稳定目标。
- 不合并 DEAL 与 Siege 的引擎，不建 GamePlatform / 通用 ECS。
- 不把战斗结果上传做权威排名（原方案第 10 节的复算路径仍然有效，未变）。
- 不为 mobile 提前抽 `PhysicsPort`。

## 10. 实现状态（P1 + P2 已落地，mobile 暂不做）

| 项 | 状态 | 落点 |
| --- | --- | --- |
| Store 抽接口 + PostgreSQL 实现 | 已实现 | `server/internal/siege/store.go`（接口）、`store_pg.go`、`store_file.go`，迁移 `564_siege_session` |
| 后端身份改为 workspace 成员 | 已实现 | `siege.Owner{WorkspaceID, UserID}`；`http.go` 从 context 取 owner，缺则 401 |
| `/api/siege` 挂进主 server | 已实现 | `router.go` 的 workspace 组内，`siegeOwner` 做唯一胶水；`cmd/server/siege.go` 负责装配 |
| views 抽取 + 平台注入 | 已实现 | `packages/views/siege`（Rapier/Canvas/音频都在这里），`SiegePlatform` 含 `assetBase` 与 `request` |
| web / desktop 接入 | 已实现 | `apps/web/app/[workspaceSlug]/siege{,/campaign}`、`apps/desktop/.../pages/siege-page.tsx` |
| 独立壳（e2e/fixture 载体） | 保留 | `apps/siege` 只剩 `main.tsx` + `navigation.tsx` + `styles.css` |
| 侧边栏入口 | 已实现 | `app-sidebar.tsx` 的 `workNav`（自动化之后）；`WORKSPACE_PAGES` 加 `siege → Gamepad2`；5 个语言包补 `layout.nav.siege`；`reserved-slugs` / `link-handler` 同步 |
| mobile | 未做（按指示跳过） | M3 只读方案仍在第 5 节 |

实现期新增的两个判断，补记在此：

1. **`SiegePlatform.request` 必须存在**。游戏原先只发 `credentials: "include"`，而 `/api/siege/*` 挂在 workspace 组下：web 缺 `X-Workspace-Slug` 会被 `RequireWorkspaceMember` 拒，缺 `X-CSRF-Token` 会被 CSRF 拒；desktop 是 token 模式，没有 Bearer 直接 401。现在统一走 `@auro/core/api` 的 `authenticatedFetch`（复用 `ApiClient.authHeaders()`），独立壳没有 `ApiClient` 时自动降级为普通 fetch。
2. **`pgStore.ReserveBudget` 的 insert 分支要带守卫**。文件存储用 `count >= limit` 挡住；只把守卫写在 `on conflict` 分支上，会让 `limit = 0` 时白送一次识别。改成 `insert ... select ... where $3 > 0`，并统一按 UTC 分日。

仍未做：

- workspace / user 删除时扫 `siege_session`、`siege_recognition_budget`（迁移注释已声明由应用负责）。
