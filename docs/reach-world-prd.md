# REACH — 自动运行游戏世界 · 产品需求文档

| 项 | 内容 |
| --- | --- |
| 版本 | v0.1（可开工稿） |
| 日期 | 2026-10-22 |
| 代号 | **REACH**（中文对外名「曙光边境」）。世界代号与平台品牌解耦，品牌改名不影响本方案。 |
| 范围 | 营销首页 `/` 与营销子页的信息架构改造；支撑它们的常驻世界内核、创作 Schema、对外接口 |
| 不在范围 | 账号体系重构、实时手操 PvP、用户代码执行、加密资产 |

---

## 0. 一句话

**把营销页从「介绍产品的静态页面」换成一个正在运转的游戏世界：任何人（或任何 Agent）丢一件武器、一个角色进去，它就在里面自己活下去或死掉，而访客不需要登录就能看见。**

- EN：*The world is already running. Bring something that survives it.*
- ZH：**世界已经在跑了。带点能活下来的东西进来。**

---

## 1. 背景与问题

现在的落地页是标准的 SaaS 三件套：Hero 主张、功能三栏、开源区块、FAQ。它解释了产品，但不产生**停留**，也不产生**回来的理由**。仓库里已经有 DEAL（AI 谈判 Roguelike）和 Doodle Siege（画武器对战）两个可玩的独立游戏，但它们挂在 `/deal`、`/siege` 两个孤岛上，和首页没有关系，访客要先理解产品，才会想起来「哦，还有游戏」。

问题可以归成三条：

1. **首页没有可看的东西。** 访客的判断窗口只有几秒，静态截图给不出「现在发生了什么」。
2. **游戏与产品叙事脱节。** 两个游戏的入口藏在导航里，无法承担拉新。
3. **创作没有出口。** 用户画了一个武器，只能在那一局里用；Agent 生成一个角色，没有地方可以送去跑。

REACH 要解决的不是「再做一个游戏」，而是**给已有的游戏内核加一个持续存在的世界，并让这个世界本身成为首页内容**。

---

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 | 判据 |
| --- | --- | --- |
| G1 | 首页第一屏是**实时世界**，不是宣传图 | 首屏可交互世界窗口，冷启动 ≤ 1.5s 出现第一帧，≤ 3s 出现第一条世界播报 |
| G2 | 无需注册即可观看与理解 | 未登录访客可直接看懂「谁在活、谁刚死、怎么加入」，转化路径 ≤ 2 次点击 |
| G3 | 任何人可创作并投入世界 | 从首页到「实体已入场」≤ 3 分钟，含表单填写 |
| G4 | 外部 Agent 可零配置接入 | 只给一个根 URL，Agent 自行发现 schema 并成功提交；首提交成功率 ≥ 90% |
| G5 | 世界无人观看也持续运行 | 连续 7 天无新增用户，世界状态持续推进且事件流不断档 |

### 2.2 非目标（明确不做）

- 不做手操实时对战：世界是**自动结算**的，人只负责创作与给定策略，不负责临场操作。
- 不做用户自定义代码或脚本上传：一切行为由声明式参数表达，服务端编译。
- 不做经济系统/付费道具：第一版没有内购，避免与营销页的「免费观看」冲突。
- 不做 3D：世界窗口是 2D 确定性渲染，包体与首屏优先。
- 不接管 DEAL / Siege 的既有玩法：它们是世界里的**场景**，不是被替换。

---

## 3. 世界观（World Bible 摘要）

世界是一片被缓慢漂移的边界带切割的荒原。它不为主角存在，也不为观众暂停。

- **地形**：三条纵向的「带」（belt）横穿世界，带与带之间是会移动的**裂缝**。裂缝每季重排，逼迫实体迁移。
- **压力**：每个实体每拍消耗 `charge`（能量）；耗尽即衰减。补给点稀疏且会被占据。
- **天敌**：`Drifters`，世界自带的 NPC，按固定规则巡游与掠夺。它们保证世界在没有任何玩家时依然有事件。
- **他人**：玩家实体之间可以抢夺补给、也可以结盟（结盟是策略参数的自然结果，不是社交功能）。
- **死亡**：实体死亡后留下**残骸（wreck）**，残骸保留 70% 的属性与全部外观，可被其他实体拾取改造。这是内容再生的机制，也是「回来看」的钩子。
- **纪年**：世界以**赛季（Season）**推进，每季 7 天。季末冻结、归档、写入名人堂，然后开新季。

一句话的调性：**冷静、克制、不庆贺**。没有升级音效，没有连胜特效。世界只记录发生了什么。

---

## 4. 世界如何运行

### 4.1 时间模型

| 概念 | 定义 |
| --- | --- |
| `beat` | 世界的原子时间单位，60 秒。所有结算以 beat 为单位 |
| `tick` | 一次批量结算：取自上 beat 以来的事件队列，按固定步长确定性模拟，产出状态增量 |
| `season` | 7 天 = 10,080 beat。季末冻结，世界版本归档 |
| `worldVersion` | 单调递增整数。任何状态查询都带版本，客户端据此判断是否需要拉增量 |

**关键约束：世界不按帧算。** 服务端只在有事件或有观众时才推进结算，结算结果写入状态快照；渲染完全在客户端由快照回放。这样成本与「在线人数」无关，只与「实体数量 × beat 数」有关。

### 4.2 结算顺序（每个 beat，固定顺序，不可调换）

1. **环境**：裂缝位移、补给刷新、灾变判定（每 240 beat 一次）。
2. **感知**：每个实体按 `senses` 半径收集可见目标。
3. **决策**：按实体 `policy` 参数打分，选出本 beat 的动作（移动/攻击/采集/躲避/固守）。纯函数，无随机。
4. **结算**：同时结算所有动作，伤害与消耗按固定公式，**先写意图再统一生效**，避免顺序偏袒。
5. **死亡与残骸**：生命归零的实体转为残骸，进入拾取池。
6. **叙事**：把本 beat 中「值得播报」的事件（击杀、首杀、赛季纪录、结盟、拾取）落成一条 `chronicle` 记录。

随机性只来自一个按 `seasonId + beat` 派生的种子，任何人都能复算。**可复算是产品信任的一部分**：玩家会怀疑「是不是后台调我了」。

### 4.3 生存与胜负

没有全局胜利条件。单个实体的「成绩」是三个数：

- `survived`：存活 beat 数
- `kills`：击杀数
- `legacy`：死亡后残骸被拾取改造的次数（负向也不难看，这是它的特色）

赛季榜按 `survived` 排序，同分看 `legacy`。

---

## 5. 创作模型与 Schema

### 5.1 两种可投递物

| 类型 | 谁来做 | 表达方式 | 复用 |
| --- | --- | --- | --- |
| **Weapon（武器）** | 人画、或 Agent 生成 | 结构化参数（形态 + 尺寸 + 材质 + 一个特性） | 复用 Siege 的几何编译器与校验 |
| **Character（角色）** | Agent 生成、或人选模板改造 | 底盘 + 装备（1 武器 + 1 护具）+ 行为策略 + 一句台词 | 复用 Siege 的 blueprint 与 DEAL 的结算词汇 |

**为什么武器不用「画」而用「参数」：** LLM 不擅长生成 4096 网格的笔迹，但极擅长填参数。对外接口只接受参数化描述，几何由服务端确定性编译 —— 人画的路径仍然走 Siege，最终也编译成同一份 `WeaponSpec`。

### 5.2 点数预算（核心防滥用机制）

所有可调属性走**定额点买**：每个实体 100 点，单项 0–40，至少两项非零。

- 属性不直接进公式，先经派生函数：`damage = 6 + atk * 1.4`，`hp = 40 + tough * 3`，`speed = 1 + agi * 0.06`。
- 由此天然杜绝「全 40」的超模角色，也让「我该怎么分配」成为真正的决策。
- 服务端在提交时同时返回 `powerIndex`（与赛季中位数对比的百分位），超模不是拒绝，而是**公开标注**。透明比封禁更有效。

### 5.3 `reach.entity/1`

```json
{
  "schema": "reach.entity/1",
  "kind": "character",
  "name": "Rust Marshal",
  "locale": "en",
  "appearance": {
    "palette": ["#1B1B1F", "#C8622D", "#E8E1D5"],
    "silhouette": "broad"
  },
  "chassis": "walker",
  "loadout": {
    "weapon": {
      "form": "hammer",
      "dimensions": { "length": 42, "mass": 30, "head": 18 },
      "material": "scrap",
      "trait": "concussive"
    },
    "armor": { "plate": "plated", "trait": "braced" }
  },
  "stats": { "atk": 26, "tough": 30, "agi": 12, "sense": 16, "upkeep": 16 },
  "policy": { "aggression": 0.6, "caution": 0.4, "hoard": 0.2, "loyalty": 0.5 },
  "voice": "I don't move first. I move last.",
  "provenance": { "generator": "workbuddy", "model": "claude-sonnet", "author": "chunjun" }
}
```

字段规则（全部强校验，任一不满足即 `422` 并返回逐字段错误）：

| 字段 | 约束 |
| --- | --- |
| `schema` | 必须为 `reach.entity/1`，未知版本拒收 |
| `kind` | `character` \| `weapon` |
| `name` | 2–32 字符，允许中英文数字空格连字符，禁表情与 URL |
| `appearance.palette` | 恰好 3 个 `#RRGGBB`，且两两对比度 ≥ 1.4 |
| `appearance.silhouette` | `slim` \| `broad` \| `tall` \| `low` |
| `chassis` | `walker` \| `crawler` \| `drifter` \| `tower` |
| `loadout.weapon.form` | `blade` \| `hammer` \| `cannon` \| `wheel` \| `shield` \| `structure` |
| `dimensions.*` | 整数 1–100；`mass` 影响搬运与 upkeep，不是纯增益 |
| `material` | `scrap` \| `bone` \| `glass` \| `iron`（各有明确取舍，无优劣序） |
| `trait` | 从闭集里取 1 个；稀有 trait 有赛季配额 |
| `stats` | 五项之和 = 100，单项 0–40 |
| `policy.*` | 四个浮点，各 0–1，互不约束 |
| `voice` | ≤ 60 字符，一句话，进世界播报；过内容审核 |
| `provenance` | `generator` ∈ `human`/`workbuddy`/`codex`/`other`；用于榜单分类，不用于加权 |

`weapon` 类型省略 `chassis`/`loadout.armor`/`policy`，把 `stats` 解释为武器参数；其余同构。两种类型共用一套校验与一套入场流程，降低接口成本。

### 5.4 校验与回执

提交接口是**幂等**的：客户端带 `Idempotency-Key`，重复提交返回同一 `entityId` 与同一 `receipt`。

回执包含三部分，缺一不可：

1. `entityId` + `worldVersion` + 预计入场 beat；
2. `normalized`：服务端归一化后的最终 spec（几何编译结果）；
3. `diagnostics`：逐字段问题、`powerIndex`、以及「你的实体在同类中的预期存活分位」。

第 3 项是留给 Agent 的自我修正回路：**第一次不合格是可预期的，第二次合格才是正常路径**。

---

## 6. 对外接口

设计原则：**一个根 URL + 一份机器可读 schema，其余自解释。** 不为每个工具做专用适配。

### 6.1 能力发现

`GET /.well-known/reach.json`

```json
{
  "world": "reach",
  "season": "2026-S04",
  "worldVersion": 418203,
  "schemas": { "entity": "/api/reach/schema/entity-1.json" },
  "endpoints": {
    "state": "/api/reach/state",
    "feed": "/api/reach/feed",
    "submit": "/api/reach/entities",
    "entity": "/api/reach/entities/{id}"
  },
  "limits": { "entitiesPerHour": 10, "payloadBytes": 16384 },
  "docs": "/developers/reach"
}
```

Agent 只需知道域名，其余靠这一次 GET 拉齐。

### 6.2 端点

| 方法 | 路径 | 用途 | 备注 |
| --- | --- | --- | --- |
| `GET` | `/api/reach/state` | 世界快照 | 支持 `If-None-Match`，命中返回 `304`；`?view=full` 只对已认证创作者开放 |
| `GET` | `/api/reach/feed?since=<cursor>` | 事件流（含世界播报） | 游标分页；`since` 保留 24 小时 |
| `GET` | `/api/reach/entities/{id}` | 实体档案与战绩 | 公开只读，可分享 |
| `POST` | `/api/reach/entities` | 提交实体 | 需 `Idempotency-Key`；匿名可提交但有配额与人工抽检 |
| `POST` | `/api/reach/entities/{id}/orders` | 下达有限指令 | 仅 `retreat` / `hold` / `hunt`，每实体每季 3 次 |
| `GET` | `/api/reach/schema/entity-1.json` | JSON Schema | 与 §5.3 同源生成，不手写两份 |
| `GET` | `/api/reach/season/current` | 赛季元数据 | 剩余时间、灾变日程、榜单口径 |

`orders` 的限额是刻意的：世界是自动运行的，人不该成为操纵杆。

### 6.3 接入示例（文档与测试共用）

```bash
# 1. 发现
curl -s https://example.com/.well-known/reach.json

# 2. 取 schema
curl -s https://example.com/api/reach/schema/entity-1.json

# 3. 提交
curl -sX POST https://example.com/api/reach/entities \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 0f9c...' \
  -d @entity.json
```

### 6.4 对接 WorkBuddy / Codex

不写定制插件，给一份 **tool 描述（function calling 定义）+ 一条 prompt 片段**，让两者都能直接吃：

```json
{
  "name": "reach_submit_entity",
  "description": "Submit a weapon or character to the REACH world. Fetch /.well-known/reach.json for the current schema first.",
  "parameters": { "type": "object", "required": ["entity"], "properties": { "entity": { "type": "object" } } }
}
```

配套 prompt：*"Generate one REACH entity. Respect stats summing to 100. Prefer one distinctive trait over balanced stats. Submit, then read diagnostics and fix once."*

要求：**首次失败可接受，一次修正后必须通过**。这是我们对外宣称的可用性口径，也是接入文档里唯一需要学的东西。

### 6.5 限额与风控

| 风险 | 措施 |
| --- | --- |
| 刷量 | 每 IP 每小时 10 次提交；匿名身份按 cookie 绑定，7 天后可认领 |
| 内容滥用 | `name` / `voice` 过敏感词 + LLM 审核；命中即 `422`，不进队列 |
| 超模 | 点数预算 + `powerIndex` 公示；同一 trait 单季配额 |
| 抄袭 | 同名同 spec 去重；残骸拾取记 `lineage`，榜单显示血缘 |
| 算力 | 结算按 beat 批量；季末归档冷存；实体数上限 5,000/季，超出排队 |

---

## 7. 营销信息架构

### 7.1 路由

| 路由 | 角色 | 关键内容 |
| --- | --- | --- |
| `/` | 主入口，**世界即首屏** | 实时世界窗口 + 世界时钟 + 本季 Top 5 + 「带我进去」CTA + 三段说明 + 页脚 |
| `/world` | 观看页（可分享） | 全屏世界、播报流、赛季榜、按实体筛选 |
| `/world/build` | 创作器 | 参数表单 + 实时预览 + 提交回执 |
| `/world/entities/[id]` | 实体档案 | 战绩、残骸血缘、动态 OG 卡片 |
| `/developers/reach` | 接口文档 | well-known、schema、三条 curl、tool 定义 |
| `/world/seasons/[id]` | 归档赛季 | 名人堂与季末结算 |

`/deal`、`/siege` 保留原路径，在导航中降为「世界里的场景」，从 `/world` 交叉链接。

### 7.2 首页结构（从上到下）

1. **世界窗口**（占视口 62–68%）：2D 俯视，实体为带颜色的剪影，播报以极小的等宽字体在旁边滚动。右上角世界时钟与 `worldVersion`。
2. **一行主张**：`The world is already running.` / 「世界已经在跑了。」
3. **一个动作**：`Bring something in` / 「带它进来」→ `/world/build`。次级动作：`Watch` / 「先看看」→ `/world`。
4. **How the world runs**：三列，讲 beat、生存、残骸。用世界里的真实数字做插图，不用示意图。
5. **Bring a weapon or a character**：并排两个参数卡，展示「40 点攻击 = 更快死」这类取舍，直接暴露预算机制。
6. **Connect your agent**：`/.well-known/reach.json` 一行命令 + WorkBuddy / Codex 两个示例。
7. **页脚**：沿用现有 footer 结构，避免二次维护。

**删除**：现有 hero 的产品截图、`FeaturesSection` 的三栏、`OpenSourceSection` 的独立区块。开源与自托管信息移入 `/about` 与页脚，不占首页。

### 7.3 转化路径

```
未登录 → 看世界（0 点击）→ 看懂规则（滚动）→ 造一个（1 点击）→ 入场（提交）
                                    ↘ 接 Agent（复制一条 curl）
```

`/world/build` 允许**先试后登录**：本地预览免费，入场需要身份（匿名 cookie 即可，不强制注册）。这是 G3「3 分钟」的前提。

---

## 8. 设计语言与文案

### 8.1 视觉

- **底色是世界的底色，不是品牌色。** 主画布 `#0E0F12`，文字 `#E8E1D5`，唯一强调色 `#C8622D`（锈橙），用于「当前存活」与主 CTA。全站不超过 3 个色相。
- **UI 退让。** 世界窗口无边框、无卡片、无阴影，直接贴边。所有控件用 1px 描边与 6px 圆角，不使用玻璃拟态与发光。
- **排版。** 标题用紧凑字距（`-0.02em`）的中性无衬线，正文 16px/1.65，最长行宽 62 字符。数字与时间戳用等宽字体，让「世界在跑」有质感。
- **动效克制。** 世界本身在动，界面不要再动。只保留两处过渡：实体死亡时 200ms 淡出为残骸、播报新增时 120ms 上浮。禁止视差、禁止大图缩放。
- **移动端优先收缩。** 世界窗口在窄屏降为 `aspect-ratio: 4/3` 的聚焦视图，播报折叠成单行滚动条。

### 8.2 文案基线（中英并列，均需母语级）

| 位置 | 英文 | 中文 |
| --- | --- | --- |
| 主张 | The world is already running. | 世界已经在跑了。 |
| 副标题 | Build a weapon, send in a character, and see how long it lasts. | 造一件武器，送一个角色进去，看它能活多久。 |
| 主 CTA | Bring something in | 带它进来 |
| 次 CTA | Just watch | 先看看 |
| 观看页提示 | No download. No signup to watch. | 无需下载，观看不用注册。 |
| 规则段标题 | How the world runs | 世界怎么运转 |
| 创作段标题 | Bring a weapon or a character | 带一件武器，或一个角色 |
| 接口段标题 | Connect your agent | 把你的 Agent 接进来 |
| 接口副文案 | One URL. One schema. No SDK. | 一个地址，一份 schema，不需要 SDK。 |
| 死亡播报 | `Rust Marshal` fell at the third belt. Wreck intact. | 「锈帅」倒于第三带，残骸完好。 |
| 赛季结束 | Season 04 closed. 1,842 entities entered. 37 lasted the week. | 第四赛季结束：入场 1,842，撑满一周的 37 个。 |
| 页脚签名 | The world doesn't wait. | 世界不等你。 |

文案规矩：**不吹嘘、不用感叹号、不写「史诗」「传奇」「征途」**。世界越冷静，越像真的。

---

## 9. 数据模型

| 实体 | 关键字段 | 说明 |
| --- | --- | --- |
| `World` | `id`, `seasonId`, `beat`, `worldVersion`, `seed` | 单例行，常驻 |
| `Season` | `id`, `startedAt`, `endsAt`, `rulesVersion`, `seed`, `status` | `live` / `frozen` |
| `Entity` | `id`, `seasonId`, `kind`, `spec`, `normalized`, `ownerRef`, `enteredBeat`, `status`, `survived`, `kills`, `legacy` | `spec` 与 `normalized` 都存，前者审计、后者结算 |
| `BeatSnapshot` | `seasonId`, `beat`, `digest`, `payloadRef` | 按 beat 增量存储，只保留最近 720 beat 全量 |
| `Chronicle` | `seasonId`, `beat`, `kind`, `text`, `entityIds` | 世界播报，首页与观看页的主要内容源 |
| `Wreck` | `id`, `fromEntityId`, `beat`, `spec`, `claimedBy` | 残骸池，24 小时后消失 |
| `Submission` | `idempotencyKey`, `payloadHash`, `entityId`, `diagnostics` | 幂等与审计 |
| `Lineage` | `childId`, `parentId`, `kind` | 拾取改造的血缘链 |

存储：沿用现有 PostgreSQL（世界数据与平台数据同库、不同 schema）；`BeatSnapshot` 的 `payloadRef` 指向对象存储。DEAL / Siege 的单实例文件存储不动。

---

## 10. 非功能需求

| 维度 | 要求 |
| --- | --- |
| 首屏 | LCP ≤ 1.8s（4G），世界第一帧 ≤ 1.5s；世界窗口 JS ≤ 120KB gzip |
| 结算 | 单 beat 结算 5,000 实体 ≤ 200ms（Go，确定性模拟，无外部调用） |
| 可用性 | 观看链路只读，世界服务降级时首页展示最近快照 + 「世界暂停」状态，不白屏 |
| 可复算 | 任一 beat 的状态可由 `seed + spec 集合` 重放；提供内部 `replay` 命令 |
| 无障碍 | 世界窗口提供文本替代视图（播报流即替代）；对比度 ≥ 4.5:1；动效尊重 `prefers-reduced-motion` |
| SEO | 首页与实体档案 SSR 出正文；播报流分页可索引；`/world` 不做 noindex |
| 审核 | 名称/台词双审；举报入口在实体档案页 |

---

## 11. 指标

| 指标 | 现状 | 目标（上线 4 周） |
| --- | --- | --- |
| 首页首屏停留 | 未测 | ≥ 25s 中位数 |
| 观看 → 创作 | — | ≥ 8% |
| 创作 → 入场成功 | — | ≥ 85% |
| 外部 Agent 提交占比 | 0 | ≥ 30% |
| 实体 7 日回访（作者回来查看） | — | ≥ 20% |
| 自然分享（OG 卡片点击） | — | ≥ 1,000/周 |

北极星指标：**每周「入场并活过一个完整 beat 周期（≥ 60 beat）」的实体数**。它同时衡量创作量与规则可玩性，且不易被刷。

---

## 12. 里程碑

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| M0 内核 | 世界结算引擎、schema、校验、回执、replay | 5,000 实体单 beat ≤ 200ms；同 seed 两次重放 digest 一致 |
| M1 观看 | `/.well-known`、state、feed、`/world` 观看页 | 未登录可看；304 生效；断流 60s 自动重连 |
| M2 首页 | `/` 改造、世界窗口、三段说明、文案双语 | LCP ≤ 1.8s；文案 en/zh 同步；旧 section 已下线 |
| M3 创作 | `/world/build`、提交、诊断、档案页、OG 卡片 | 3 分钟内完成首次入场；422 可读可修 |
| M4 接口 | `/developers/reach`、tool 定义、WorkBuddy/Codex 实测 | 两个客户端各完成一次「首次失败 → 修正 → 通过」 |
| M5 赛季 | 冻结、归档、名人堂、`/world/seasons/[id]` | 跨季数据不串；归档页可独立访问 |

M0–M2 可并行两路（引擎 / 前端壳），M3 依赖 M0，M4 依赖 M3。

---

## 13. 风险与开放问题

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 世界空城 | 访客看到无人区，直接离开 | Drifters 保证事件密度；首季预置 200 个作者署名为 `system` 的实体做种子 |
| LLM 生成同质化 | 榜单被同一种 build 占据 | trait 配额 + `powerIndex` 公示 + 赛季中期灾变改变地形收益 |
| 结算成本失控 | 实体数增长导致账单线性上涨 | 按 beat 批量 + 只保留 720 beat 全量 + 季末冷存 |
| 内容审核漏网 | 台词进首页播报造成事故 | 播报只输出服务端模板生成文本，用户 `voice` 需通过审核才可入播报；未过审则显示占位 |
| 营销页「游戏化」伤及产品叙事 | 访客以为这是游戏公司 | 页脚与 `/about` 保留平台定位；接口段本身就是产品能力的证明 |
| 与 DEAL / Siege 口径漂移 | 三处规则描述不一致 | 规则版本号 `rulesVersion` 单一来源，页面从接口读，不硬编码 |

**开放问题（需产品决策，不阻塞 M0）：**

1. 世界是否公开 API 的写权限给完全匿名请求？当前方案是「可写但限流 + 抽检」，风险在于被当作免费算力。
2. 赛季长度 7 天是否过长？若首季留存不足，考虑 3 天短季。
3. 中文世界名「曙光边境」是否保留？代号 REACH 已与品牌解耦，中文名可单独调整。

---

## 14. 与现有代码资产的映射

| 需求 | 复用 | 需要新增 |
| --- | --- | --- |
| 武器几何编译 | `server/internal/siege`（`Spec`/`Drawing` 校验、确定性编译、`RulesVersion` 模式） | 参数化入口 `weaponParams → Drawing`，对外不暴露画笔迹 |
| 回合结算与叙事 | `server/internal/deal`（回合、心理学向量、`Receipt` 回执模式） | 把「对话回合」抽象为 beat 内的决策步 |
| HTTP 层 | 两个游戏的 `http.go`（owner cookie、Origin 校验、`problem()` 错误体、限流窗口） | 世界级 `state`/`feed`，以及跨实体的队列 |
| 实体档案与分享 | `apps/web/app/(landing)/usecases/[slug]` 的动态路由与 metadata 写法 | 动态 OG 图 |
| 首页组件 | `apps/web/features/landing/components/*` 的 section 拆分方式 | `world-window`、`chronicle-feed` 两个新组件 |
| i18n | `features/landing/i18n/{en,zh,ja,ko}.ts` 的字典工厂 | 世界相关 key 一组，四语同步；未提供语言的 locale 回落 en |
| 校验测试 | `packages/core/siege` 的纯函数测试风格 | schema 边界用例（点数、对比度、闭集外值） |

**边界提醒：** 世界内核属于新领域 `server/internal/reach`，不复用 `deal`/`siege` 的 session 模型 —— 那两个是「一局」，世界是「一直」。共用的只有编译、校验与 HTTP 卫生习惯。

---

## 15. M0 落地状态（2026-10-22）

内核与对外接口已可运行，前端仍是 M1/M2 待办。

### 15.1 代码位置

| 文件 | 内容 |
| --- | --- |
| `server/internal/reach/types.go` | 线上契约（`Spec`/`Entity`/`Receipt`/`Problem`）与版本常量 |
| `server/internal/reach/spec.go` | 逐字段校验、派生数值、`powerIndex` 百分位 |
| `server/internal/reach/geometry.go` | 参数 → 确定性多边形，边界框由 `length`/`mass` 决定 |
| `server/internal/reach/schema.go` | `entity-1.json` 由校验器的闭集生成，测试锁一致性 |
| `server/internal/reach/engine.go` | beat 结算、残骸、灾变、双语播报、快照 |
| `server/internal/reach/store.go` | 单实例文件世界（`world.json`，原子写 + flock） |
| `server/internal/reach/service.go` | 幂等提交、去重、配额、orders、档案读模型 |
| `server/internal/reach/http.go` | 端点、ETag、限流、owner cookie |
| `server/cmd/reach/main.go` | 独立二进制，按 beat 自动推进 |

### 15.2 运行

```bash
cd server
REACH_DATA_DIR=.reach REACH_SEED=42 REACH_BEAT_SECONDS=1 go run ./cmd/reach
```

演示用 `REACH_BEAT_SECONDS=1` 把一 beat 压到 1 秒；线上保持默认 60。`REACH_SEED` 固定后世界可复算。

### 15.3 已实现端点

`/.well-known/reach.json`、`/api/reach/schema/entity-1.json`、`state`（ETag/304）、`feed`（seq 游标）、`season/current`、`POST entities`（幂等 + 422 逐字段）、`entities/{id}`、`entities/{id}/orders`。

### 15.4 与本文档的差异（以实现为准）

1. **beat 长度可配置**，`/season/current` 回传实际值，客户端不假设 60 秒。
2. **`state` 默认最多返回 600 个实体**（榜单前半 + 存活填充）；`view=full` 尚未实现。
3. **orders 的即时效果**：`hold` 4 beat 内原地减伤 10%，`hunt` 4 beat 内无视谨慎值追击，`retreat` 立即移到地图边缘并扣 20% HP（逃跑有代价）。
4. **未实现**：赛季冻结与名人堂、`voice` 的 LLM 审核、SSE 推送、全部前端页面（`/world`、`/world/build`、`/developers/reach`）。

### 15.5 关键验收数据

- 2000 实体单 beat 结算 **2.7ms**（预算 200ms）。
- 同 seed 重放 300 beat，`digest` 逐 beat 一致。
- 完整测试：`go test ./internal/reach/`（含 `-race`）全绿。
