# Issues 模块退役检查

基于当前工作区源码检查，日期为 2026-11-01。当前已退役的是 Issues、Projects、My Issues、Squads 的页面和主要导航，相关服务端业务、外部创建入口和部分客户端依赖仍然存在。

本报告区分用户仍可触达的功能、后台业务和未清理源码。接口或调度器仍在代码中注册，不代表已经确认生产环境有对应数据、启用的集成或正在执行的任务；本次未查询生产数据库或调用生产接口。

## 本次完成

- 从世界常规设置移除任务前缀行、修改按钮、确认弹窗、草稿状态、保存请求和 Issues 缓存失效逻辑。
- 从设置搜索索引移除任务前缀。
- 清理中、英、日、韩、法五种语言的任务前缀专用文案。
- 删除已失效的前缀编辑测试，更新现有世界设置测试，覆盖前缀不再显示及普通字段仍能自动保存。

对应实现：[世界常规设置](../packages/views/settings/components/workspace-tab.tsx)、[设置搜索](../packages/views/settings/components/use-settings-search-index.ts)、[现有组件测试](../packages/views/settings/components/workspace-tab.test.tsx)。

`workspace.issue_prefix` 的数据库字段、API 响应和服务端写入能力仍在。它们属于下文的后端退役范围，不能通过移除一个设置项完成退出。

## 仍然可触达的遗留

| 优先级 | 位置及证据 | 当前行为与影响 | 建议 |
| --- | --- | --- | --- |
| P1 | [Web 分享链接加入世界](<../apps/web/app/(application)/join/page.tsx>)：64、74、82 行 | 加入成功、已是成员及回退分支都导航到 `/{slug}/issues`，目标页面已退役。 | 统一使用世界路径工厂的 `root()`，当前为 `/{slug}/me`；同步修正测试预期。 |
| P1 | [Desktop 错误恢复页](../apps/desktop/src/renderer/src/components/route-error-page.tsx)：38–40、92、155 行 | 404 和异常页的恢复操作仍是 “Go to issues”，目标也是已退役页面。 | 改为当前世界入口及对应文案，保留现有标签页会话导航方式。 |
| P1 | [移动端聊天的引用入口](<../apps/mobile/components/chat/chat-composer.tsx>)、[引用选择器](../apps/mobile/components/issue/pickers/mention-picker-body.tsx)：74–123 行 | 聊天仍能打开仅提供 Issues 的引用选择器；输入搜索会调用 `searchIssues`，选择器还加载任务状态和 Squads。 | 去掉任务引用入口与查询，保留聊天发送、附件和停止执行。历史内容的展示另行处理。 |
| P2 | [移动端通知设置](<../apps/mobile/app/(app)/[workspace]/more/settings/notifications.tsx>)：23–57、108 行 | 仍显示任务分配、状态、评论、提及、更新和智能体动态六组开关；移动端收件箱已经只展示系统通知。 | 对齐 Web 的系统通知设置，检查旧偏好对后台投递是否仍有作用。 |
| P2 | [快捷键定义](../packages/core/shortcuts/definitions.ts)：82 行、[中文文案](../packages/views/locales/zh-Hans/settings.json) 的 `shortcuts.actions.findInIssue` | 快捷键设置仍显示“在任务中查找”；对应处理器只在已退役的 Issue 详情组件中使用。 | 移除该操作及持久化覆盖项；保留通用搜索和浏览器历史导航。`createIssue` 的旧翻译也仍在，但已不属于当前快捷键操作列表。 |
| P2 | [消息渠道设置](../packages/views/settings/components/channels-tab.tsx)：89–137 行及各语言 `*.page_description` | 飞书、Slack、钉钉、企业微信、Telegram 的可见说明和搜索文本仍宣传 `/issue` 创建任务。 | 与渠道侧命令能力一起退役，保留渠道聊天连接。 |
| P2 | [账单设置](../packages/views/settings/components/billing-tab.tsx)：336–340、1199–1202 行 | 启用世界订阅功能后，仍显示任务数量额度；受限套餐还会请求 `/api/issues/limit-usage`。 | 清理任务额度展示、查询、权益定义和对应恢复弹窗分支。账单页本身受功能开关控制，并非默认可见。 |
| P2 | [编辑器历史引用](../packages/views/editor/extensions/mention-view.tsx)：23–50 行、[任务引用卡片](../packages/views/issues/components/issue-mention-card.tsx)：42–52 行 | 新的 Web 引用建议已过滤 Issues/Projects，但历史节点仍渲染任务/项目卡片；任务卡片仍链接到已退役详情页。 | 历史引用保留可读标签，去掉已退役链接与详情查询。清理前先核对只读 Markdown 渲染和聊天历史入口。 |
| P3 | [Desktop 新标签页](../apps/desktop/src/renderer/src/components/tab-bar.tsx)：520–521 行 | 实际目标已是 `root()`，但创建时的标题仍为 “Issues”。 | 更新初始标题；这是旧命名，不是仍然打开任务页。 |

P1 优先处理失效跳转和仍在调用任务接口的客户端入口。P2 收敛设置和历史展示，P3 清理维护负担。

## 仍能产生任务数据的后台入口

| 入口 | 证据 | 退役时需要处理 |
| --- | --- | --- |
| HTTP API | [主服务路由](../server/cmd/server/router.go)：2053–2124 行仍注册 Issues 的创建、查询、修改、评论、子任务、唤醒、执行、附件和 PR 关联；2132、2142、2165、2176、2192 行还注册快捷操作、属性、状态、项目和小队。 | 先查清仍在使用的客户端和内部调用，再关闭创建及修改入口，明确旧客户端的返回契约。移除 UI 不会关闭这些接口。 |
| CLI 和智能体指引 | [CLI 注册](../server/cmd/auro/main.go)：75–84 行仍注册 `issue`、`project`、`property`、`squad`；[内置平台技能](../server/internal/service/builtin_skills/auro-platform/SKILL.md) 仍指导智能体使用 Issues、Projects、Squads。 | 同步收敛 CLI 命令、帮助、运行提示和内置技能，避免智能体继续创建用户无法在页面管理的资源。 |
| 消息渠道 `/issue` | [渠道引擎](../server/internal/integrations/channel/engine/router.go)：578–608 行仍解析并创建任务，各渠道适配器继续提供相关能力。 | 关闭任务命令分支和任务深链接回复；保留普通渠道聊天、身份验证及媒体处理所需能力。 |
| 自动化 | [Autopilot 服务](../server/internal/service/autopilot.go)：614–617 行仍支持 `execution_mode=create_issue`。 | 先盘点已有自动化和待执行记录，再退役该模式。`run_only` 应独立评估，不随 Issues 一起删除。 |
| 定时后台任务 | [主服务初始化](../server/cmd/server/main.go)：842–852 行仍注册搜索索引清理、Issue 唤醒、子任务完成扫描和 Autopilot 调度。 | 核对持久化计划、运行中记录及失败重试后，移除仅属于 Issues 的作业。聊天用量汇总和通用执行调度不能整体删除。 |
| 编号与数据层 | [世界处理器](../server/internal/handler/workspace.go) 仍默认生成、返回并接受修改 `issue_prefix`；[世界 SQL](../server/pkg/db/queries/workspace.sql) 仍维护 `issue_counter`。 | 停止业务写入后再评估字段、关系表和历史数据的归档与迁移，保留必要的 API 响应兼容。 |

## 已隐藏但尚未清理的源码

- `packages/core/issues` 有 44 个非测试 TS/TSX 文件，`packages/views/issues` 有 146 个；Projects 对应目录分别有 7 个和 17 个。它们存在跨功能引用，数量不等于可以直接删除的文件数。
- 移动端 `components/issue` 和 `components/project` 分别仍有 30 个和 8 个非测试 TS/TSX 文件；聊天复用了其中的组件，需先拆出仍然通用的部分。
- [世界路径工厂](../packages/core/paths/paths.ts)：30–33 行仍提供 Issues/Projects URL；[Dashboard 守卫](../packages/views/layout/use-dashboard-guard.ts)：13、67–75 行仍维护最近任务存储；[实时同步](../packages/core/realtime/use-realtime-sync.ts) 仍处理任务管理事件和缓存更新。处理事件不等于当前页面一定会发起相应请求，需要按实际观察者和调用方清理。
- `issue-statuses-tab.tsx`、`properties-tab.tsx`、`wakeups-tab.tsx`、`quick-actions-tab.tsx` 仍在设置目录；主设置导航已不挂载这些页面。搜索索引也保留了部分对应定义，但按可见页面过滤，不应误判为仍可搜索进入。
- [全局弹窗注册](../packages/views/modals/registry.tsx) 仍含 `IssueLimitUpgradeDialog`。该组件也承担 Autopilot 配额恢复，不能按文件名整体删除。
- [新世界入口](<../apps/web/app/(application)/(auth)/workspaces/new/page.tsx>) 和 [Desktop 窗口覆盖层](../apps/desktop/src/renderer/src/components/window-overlay.tsx) 仍处理 `destination.kind === "issue"`；[当前引导流程](../packages/views/onboarding/onboarding-flow.tsx) 的实际完成分支返回聊天或默认入口，Issue 分支属于未收敛的旧契约。
- [主 Playwright 配置](../playwright.config.ts) 仅排除独立的性能和 DEAL 测试；[旧 Issues E2E](../e2e/issues.spec.ts)、任务表格、评论、子任务唤醒等用例仍会被默认发现，仍假定任务页面存在。应删除对应页面行为测试，保留退役路由、无任务请求和历史内容可读性的回归覆盖。
- [README](../README.md) 仍写“chat is the current workspace landing page”，与当前 `root() -> /me` 不符。多语言字典也仍包含已不展示的任务设置、创建任务和工作流文案，应跟随调用方删除，避免一次性误删仍被聊天使用的键。

## 已正确退役或需要保留的边界

- Web、Desktop、Mobile 的 Issues/Projects/My Issues/Squads 主页面和导航已退役；旧地址保持不可用，不应恢复页面或重定向来掩盖新入口仍生成旧地址的问题。
- [Web 通知设置](../packages/views/settings/components/notifications-tab.tsx) 已只保留系统通知；[Web 收件箱](../packages/views/inbox/components/inbox-page.tsx) 和移动端收件箱都按 [系统通知规则](../packages/core/inbox/system-notifications.ts) 过滤任务记录。旧收件箱组件中出现 Issue 类型，不代表当前收件箱仍挂载它们。
- [标签设置](../packages/views/settings/components/labels-tab.tsx) 已明确使用 `scope="skill"`，应保留技能标签。
- 保留退役路径的 reserved slugs、持久化标签页过滤和防止旧目的地恢复的测试。这些是在落实退役边界。
- **区分 Issue 业务与 Task 执行引擎。** [聊天发送](../server/internal/service/task.go)：2389 行仍通过 `CreateChatTask` 创建执行记录，服务端队列、消息、取消、Daemon、用量统计和相关权限被聊天共用。先拆开 Issue 专用分支，再评估删除；不能搜索 `task` 或 `issue` 后批量移除。
- 世界成员权限、认证、API 凭据、游戏内容和游戏进度、Agent Life 的规则模拟不属于此次 Issues 业务清理。
- 历史迁移是数据库演进记录。数据库清理应新增明确的归档/迁移步骤，不直接删除已运行迁移或把现存业务表当作无用文件处理。

## 建议执行顺序

1. **客户端收口：** 修复加入世界和桌面恢复入口；移除移动端任务引用和通知项、任务专用快捷键、渠道任务说明、账单任务额度；处理历史引用的失效链接。全部指向现有世界或聊天能力。
2. **停止新任务业务写入：** 盘点 CLI、渠道 `/issue`、Autopilot `create_issue`、Issue 唤醒及相关 HTTP 创建/修改接口，统一退役；同时更新运行提示和内置技能。
3. **拆出共享依赖：** 从 Issue 目录拆出聊天需要的编辑器、消息、附件和纯工具；清理任务专用缓存、实时事件、路径工厂、隐藏设置页和多语言键，再删除失效目录与 E2E。
4. **数据退出：** 确认没有生产者和消费者后，处理历史任务、关联表、编号字段、索引及计划记录；运行相应数据库、API 兼容和聊天回归验证。

## 本次验证

- 世界设置、设置外壳、设置导航、多语言一致性：4 个测试文件，268 项测试通过。
- `@auro/views` 类型检查与改动的设置组件 ESLint 通过。
- `@auro/web` 类型检查、`@auro/desktop typecheck:web` 通过。
- `git diff --check` 通过。
- 本次只修改前缀设置及其引用；其余条目为源码分析结果，未执行完整后端测试、完整 E2E、生产数据检查或移动端原生验证。
