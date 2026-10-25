# Issue 与 Project 功能完整删除方案

> 执行进度：三端路由退役、收件箱系统通知范围和加载优化已完成验收，详见 [路由删除与加载优化记录](issue-project-route-removal-2026-10-25.md)。本文件中的后台生产链、API/CLI/工具契约及领域实现完整删除尚未执行，不能将该阶段结果视为全部方案完成。

日期：2026-10-25。状态：已执行 `my-issues` 的三端路由与入口删除；Issue/Project 完整功能删除的其余部分尚未执行。详见 [my-issues 执行记录](my-issues-removal-2026-10-25.md)。

## 目标与建议

完整移除 Issue、Project 业务，包括收件箱中的 Issue 内容；Web、Desktop、Mobile 同步处理。删除页面之外，还必须删除创建、查询、修改、执行、提醒、通知、搜索、命令和 Agent 工具入口。

建议在一次完整变更中完成代码和产品能力删除，按下列阶段实施与验证。保留聊天、Agent/Runtime、Squad 本身、Autopilot 的 `run_only`、系统通知及游戏功能。旧 Issue/Project 数据先封存、不再被在线功能读取或写入；本次不默认执行不可逆的数据清空或 DROP TABLE。功能删除完成与历史数据物理销毁分别验收。

默认工作区首页建议统一改为聊天：Web/Desktop 的 `/{slug}/chat`，Mobile 对应聊天 tab。聊天在三端均已存在，避免为首页增加页面或平台分支。游戏入口保持现有导航位置。

## 当前代码确认的依赖

| 位置 | 已确认行为 | 删除要求 |
| --- | --- | --- |
| `packages/core/paths/paths.ts`、`resolve.ts` | root、登录后默认进入 issues | 统一改用剩余首页，覆盖邀请、创建工作区、引导及切换工作区 |
| `apps/web/app/[workspaceSlug]/(dashboard)/` | issues 列表/详情、projects 列表/详情、my-issues，共 5 个页面入口 | 删除路由和专属页面实现 |
| `apps/web/proxy.ts` | 旧地址重定向和根地址重定向仍生成 issues URL | 移除已退役路由的重定向，修正根地址目标 |
| `apps/desktop/src/renderer/src/routes.tsx` | 与 Web 对应的 5 个入口 | 同步删除，处理标签恢复和历史导航 |
| `apps/desktop/src/shared/issue-window.ts`、main/preload/renderer | Issue 独立窗口有完整 IPC、参数、导航和登录生命周期 | 整条窗口能力删除，不能只删主窗口路由 |
| `packages/views/inbox/components/inbox-page.tsx` | 直接渲染 IssueDetail；未找到通知时跳转 Issue 路由 | 移除 Issue 详情、跳转和对应状态、筛选、交互 |
| `packages/core/types/inbox.ts` | 大多数通知类型与 Issue 有关，quick_create 通知可能没有 issue_id | 按通知业务类型与关联共同清理，不能只检查 issue_id |
| `server/pkg/db/queries/inbox.sql`、`inbox_archive.sql` | 列表、归档、分组、筛选及计数关联 issue 表 | 服务端统一排除旧业务，去掉关联、分组和属性筛选 |
| `packages/views/common/actor-issues-panel.tsx` | Agent/Member 等页面复用 IssueSurface | 删除这些页面内的 Issue 面板，才能删除共享 IssueSurface |
| `packages/views/chat/`、`server/internal/handler/chat.go` | 聊天持久化 Project 上下文，支持选择、变更、执行时注入资源 | 删除项目选择、绑定、查询、资源注入；保留消息和附件 |
| `server/internal/service/autopilot.go` | 同时存在 create_issue 与 run_only，前者创建 Issue 并入队 | 删除 create_issue 分支及配置；保留 run_only；既有规则不得自动改成另一种执行行为 |
| `server/internal/service/task.go` | Issue、quick-create、chat 共用 TaskService | 拆除 Issue/quick-create 分支，保留聊天与直接执行的入队、领取、取消、回传、用量 |
| `server/cmd/server/main.go` | 注册 IssueWakeupJob、ChildEventSweepJob、通知监听器 | 停止并删除 Issue 专用生产者、调度与监听 |
| `server/cmd/server/router.go`、`server/pkg/publicapi/v1/routes.go` | 内部 API 与公共插件 API 均暴露 Issue；Project 有独立 CRUD/资源 API | 删除业务 API、处理器及客户端调用，清理对应授权 scope、契约和工具声明 |
| `server/cmd/auro/cmd_issue*.go`、`cmd_project.go` | CLI 可直接管理与创建业务对象 | 删除命令树及实现，同步清理帮助、补全、内置技能和运行时指令 |
| `server/internal/integrations/channel/engine/`、钉钉/飞书等适配层 | 消息渠道可创建 Issue，发送创建结果和 Issue 链接 | 删除 Issue 命令、解析、创建、广播与回复，保留渠道聊天 |
| `apps/mobile/app/(app)/[workspace]/` | Issue/Project 路由、创建表单、picker、my-issues tab、搜索及收藏 | 按移动端独立实现同步删除，不能只改共享包 |
| workspace、billing、权限、统计、WebSocket、设置 | 包含 Issue 前缀/状态初始化、额度、通知偏好、活动投影等派生能力 | 清理所有仍可触达的业务项；保留通用身份、配额、账务和权限基础设施 |

## 方案选择

| 方案 | 结果 | 判断 |
| --- | --- | --- |
| 只删除路由、隐藏入口 | API、CLI、自动化和收件箱仍会生成或展示业务内容 | 不满足完整删除 |
| 完整删除在线功能；封存历史数据 | 产品和后台均不再提供 Issue/Project 能力，保留恢复依据 | 推荐，破坏范围最可控 |
| 同时销毁历史表、附件和所有关联字段 | 需要处理共享附件、账务审计、执行历史及升级中的客户端 | 不作为默认执行范围；须完成独立的数据销毁方案后实施 |

保留历史迁移编号及已部署迁移记录。不要重写旧迁移或把历史记录从迁移表中删除。必要的停用迁移使用新增文件；SQL 改动后运行 `make sqlc`。本次无需新增索引时，不引入索引迁移。

## 实施顺序

### 1. 建立可恢复基线

- 当前目录没有 `.git`，`git status` 返回非 Git 仓库；不能依赖 git revert、worktree 或原始差异识别。
- 修改前为所有受影响的源文件建立备份和 SHA-256 清单，新增文件单独记录；排除 `.env`、用户数据、构建产物和依赖。每批扩大文件范围时，先补备份再修改。
- 后续恢复只覆盖本任务改动且仍匹配本任务修改后哈希的文件，防止覆盖用户并发修改。
- 先记录定向测试及构建基线。当前已运行 core 路径测试：7 个文件、76 项通过；尚未验证完整工程基线。

### 2. 删除后台生产链路并处理既有配置

- 盘点运行中/待执行的 Issue 与 quick-create 任务、Issue 唤醒、子任务触发、create_issue 自动化规则、消息渠道未完成投递。
- 新版本不再接受新业务创建或派发。旧 create_issue 规则停用并记录停用原因及原状态；不自动转换为 run_only，避免改变用户授权的执行含义。
- 在实际升级窗口先停止新触发，并等待既有 Issue 执行结束；有未结束执行时列出清单，交由升级流程明确处理后再切换。不要把其任务伪装成成功，不影响聊天任务。
- 删除 Issue 专属调度注册、通知监听、PR 自动完成功能、quick-create、派生执行和评论触发；保留共享执行框架。
- 聊天历史的 Project 绑定不再作为活动上下文或执行目录来源；新聊天不接受 Project 绑定。历史字段与数据封存，普通聊天与附件不丢失。
- 工作区创建和引导不再初始化 Issue 状态、不再生成引导 Issue、不再开展基于 Issue 的来源回填。

### 3. 清理收件箱，确保列表和红点一致

- 删除 Issue 相关通知生产逻辑、类型及详情 UI，包含 quick_create_done/failed/unconfirmed、children_done 等没有可靠 issue_id 的类型。
- 收件箱保留当前非 Issue 的 autopilot_paused、autopilot_quota_exceeded 系统通知及对应阅读、归档能力；停用自动化规则产生的停用提示按系统通知处理。
- 服务端列表、归档游标页、facets、单条读取、未读统计、跨工作区摘要、批量已读/归档的可操作集合使用相同剩余通知范围，旧通知不再出现在响应中。
- 移除状态/优先级/任务分组筛选和缓存投影。保留与剩余通知有关的已读、参与者筛选；删除持久化旧筛选键，避免用户停留在永久空列表。
- WebSocket、桌面通知、移动推送、消息渠道通知同步处理，阻止旧通知重新出现；点击旧 Issue 推送不能恢复详情或进入循环导航。

### 4. 删除三端页面、上下文与入口

- 删除 Issues、My Issues、Projects、详情、创建/编辑、关联/子任务、看板/表格/甘特等全部业务 UI；同步删除 Agent、Member、Squad 页内的 Issue 面板。
- 删除 ProjectPicker、项目资源管理、聊天项目上下文、Issue/Project 提及建议、实体卡片、搜索结果、最近浏览、收藏和创建快捷键。通用搜索保留页面、成员、设置等仍可用目标。
- 删除 Issue 独立窗口、IPC、preload 类型和专用导航。保留主窗口认证、会话同步和通用窗口行为。
- 将剩余业务仍使用的通用属性选择器、附件列表、转录展示等先移入现有 common/通用模块，再删除旧目录。只迁移仍有实际调用者的实现，不重新建一套组件。
- 删除对应 core hooks/stores/types、API 方法、WebSocket updater、导出和无调用者依赖；所有语言同步清理相关产品文案。保留历史更新日志及外部 GitHub issue 等普通文本。
- 默认首页、登录回调 next、邀请完成、创建工作区、引导结束、根代理、桌面新标签和切换工作区统一指向 chat。
- 桌面持久化清理覆盖当前 URL、全部后退/前进历史、关闭标签恢复记录、资源键及 memento；保留其余合法标签。全部失效时创建 chat 标签。Mobile 清理旧选择和草稿，不恢复已删除路由。
- 旧页面 URL 进入现有不存在页面；不增加兼容路由、重定向到收件箱或隐藏的 Issue 替代详情。保留退役路由 slug 的占用，避免旧链接被误识别成新建工作区。

### 5. 删除后端入口、领域实现和工具契约

- 删除 Issue/Project CRUD、资源、评论线程、订阅、反应、元数据、任务属性、状态、视图、关联与搜索等专属 API、service、SQL query 及对应生成代码。
- 删除内部与公开插件 API 的业务路由、CLI 命令、Agent 工具/内置技能说明、运行时指令和可自动发现的契约；渠道聊天不再解析为 Issue 创建。
- 删除搜索索引中 Issue/Project 专属内容、同步和清理任务。通用搜索或编辑器仍有其他用途的基础组件按实际消费者保留。
- 删除 Issue 专属账单额度、通知偏好、工作区设置、统计、事件及权限分支；共享 label/skill label、附件、执行用量、身份授权和 MCP 管理不按名称批量删除。
- 已保留 API 的响应兼容按边界处理：旧协议要求的字段可返回空值/default，不再查询业务对象或接受业务写入；不引入内部兼容层维持旧功能。
- 旧独立业务端点的撤销是有意的兼容性变化。旧桌面/移动/CLI 会失去对应能力，发布需先备好三端新客户端并协调切换，不能宣称旧客户端功能无损。
- 在线领域代码删除与退役表封存是明确边界。生成模型或历史迁移中剩余的旧表定义作为数据遗留记录，不属于在线功能；验收报告列出这些残留。

## 风险与降低方式

| 风险 | 降低方式及验收依据 |
| --- | --- |
| 删除 TaskService 导致聊天/Agent 无法执行 | 按任务来源拆除 Issue 分支，覆盖 chat/run_only 的入队、claim、取消、完成、错误和用量测试 |
| 代码删完，计划/渠道仍不断尝试创建 Issue | 先清除所有生产者和既有规则，再删消费者；检查 scheduler、webhook、渠道、CLI 和 agent tool 的负面测试 |
| 收件箱空了但红点不归零，或归档仍读出旧任务 | 服务端统一业务范围；测试列表、分页、facets、摘要和推送一致性，不能只做前端过滤 |
| 旧 Project 上下文仍控制工作目录或 prompt | 删除 claim payload 构建与 runtime 读取路径，测试旧绑定聊天仍可发送但不注入项目资源 |
| 默认首页、历史标签导致启动白屏或重定向循环 | 统一首页并净化持久化历史；覆盖登录/邀请/引导/切工作区及全失效标签 |
| 按目录删除误删通用 UI 或后端基础能力 | 先处理跨目录引用，迁出仍使用的通用实现，再删除业务目录；检查生成代码和直接依赖 |
| 旧客户端依赖已删除接口 | 明确发布切换要求；保留其他 API 的响应形状，禁止把缺失功能伪装成成功 |
| 历史数据误删、共享附件被连带清理 | 本次封存退役数据；保留账务/运行历史，检查附件 GC 与工作区删除流程，不做批量物理销毁 |
| 无 Git 或并发修改导致不可恢复 | 文件级快照、前后哈希与删除清单，恢复时检测冲突 |

## 验证与完成条件

1. 先以真实行为验证负面条件：所有三端入口、独立窗口、API/CLI/工具均不可再创建或访问 Issue/Project，后台不会再生成对象。
2. 收件箱主列表、归档、未读统计、跨工作区红点和通知推送中均无 Issue；新系统通知仍可阅读、已读、归档。
3. 聊天发消息、附件、Agent 领取/执行/取消/回传和 run_only 自动化仍正常；旧 Project 绑定不产生查询、资源注入或隐式任务迁移。
4. 登录、邀请、引导、切工作区、桌面重启与前进后退正常；DEAL、Siege、Tanks 及 MCP 管理入口不回退。
5. 静态扫描产品代码无在线 Issue/Project 引用；对必须保留的协议空字段、退役数据定义和历史文本列出理由。不能以搜索全仓库单词为零代替功能验收。
6. 删除旧功能专属测试；将仍有价值的共享执行/通知测试改为聊天、run_only 或系统通知夹具，避免靠删除测试隐藏回归。
7. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`；另行运行 mobile 的 typecheck/lint/test。前端根命令不覆盖移动端。
8. SQL 变化运行 `make sqlc`；Go 定向检查后运行 `make test`。默认测试只用 fake agent，不执行真实账号的 Agent CLI。
9. E2E 覆盖新首页、旧 URL 不存在、搜索/快捷键无旧入口、收件箱与聊天、Tanks/MCP；Siege 和 DEAL 根据实际共享代码影响进行 smoke。测试环境通过项目环境脚本管理。
10. Mobile 如无可用模拟器/设备，明确记录无法验证原生导航、键盘、主题和跨端实时行为；桌面无运行环境时同样不得宣称实机验证通过。
11. 最终交付源文件变更/删除清单、测试结果、协议及数据遗留清单、升级/恢复步骤。本轮分析不构成部署授权。

## 方案自审

- 已纠正初始“只删除路由、保留收件箱详情”的范围；完整删除包含收件箱和所有跨页面依赖。
- 已纠正“将链接统一改到 inbox”的想法：收件箱不是通用 Issue 容器，且自身存在跳回 Issue 路由的逻辑。
- 已纳入无 issue_id 的 quick-create 通知、后台生产者、独立窗口、Mobile、公共 API、CLI 和内置 Agent 指令。
- 已区分可删除的 Issue 任务业务与聊天/自动化共享的执行框架。
- 已区分完整功能删除与不可逆历史数据销毁，避免因“删功能”误删聊天附件、运行记录和账务。
- 执行以用户审阅此范围为前提；批准后按完整方案持续实施，不把某一阶段当作全部完成。
