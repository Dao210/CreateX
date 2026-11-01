# Inbox 创作与世界消息验收

验收日期：2026-11-02（Asia/Shanghai）。实现说明见 [Creation and world messages](../inbox-world-messages.md)。

## 已实现的业务行为

- Inbox 按全部、我的创作、世界摘要、系统分类；选择通过 URL 的 `item` 消息 ID 定位。
- MCP 保存或更新 Tank、角色成长提供个人消息；世界摘要覆盖当前世界的所有符合条件成员，默认订阅。
- 已保存、世界可读的 Tank 及其成长事件，以及服务端结算的居民目标里程碑进入每小时摘要。私有 Siege 库、聊天和未保存草稿不进入摘要。
- 源事实随业务事务写入；投递失败可重试、重复处理不重复发信、发布后的摘要不可变。世界摘要不触发系统横幅。
- 已读、归档和恢复按消息独立处理；同一创作的不同小时消息互不覆盖。消息链接使用来源世界，并遵守游戏有效访问策略。
- 创作消息和世界摘要可独立关闭；关闭世界摘要后，个人创作消息继续投递。

## 执行结果

| 检查 | 结果与范围 |
| --- | --- |
| `make inbox-test-db` | 通过；5 个 PostgreSQL 场景覆盖事务回滚、重试、摘要不可变、订阅、成员隔离、关闭/隐藏游戏以及退役消息过滤 |
| `make life-test-db` | 通过；Worker 的目标事件、outbox 原子性和重启处理 |
| Core API/Inbox/偏好/realtime/Agent Life 相关测试 | 通过；最近一次集合为 16 文件、374 测试 |
| Core 系统通知及 realtime 回归 | 通过；3 文件、62 测试，与上一集合有重叠 |
| Views Inbox 与 locale parity | 通过；2 文件、229 测试 |
| Mobile 类型检查与完整测试命令 | 通过；26 文件、152 测试，另含 `ios-run.test.sh` 脚本断言 |
| Core、Web 类型检查 | 通过 |
| Desktop `electron-vite build` | 通过 main、preload、renderer 构建；未制作安装包 |
| Web `make web-build` | 隔离验证快照的生产构建通过 |
| `e2e/inbox-world.spec.ts` | 生产模式 Chromium 通过；实际登录、MCP 保存、实时到达、跨成员摘要、来源世界链接、订阅关闭、已读/归档/恢复及跨世界隔离 |
| 界面验收 | 1440px 桌面、390px 窄屏、浅色和深色；无水平溢出，主题提供器切换后按钮文字颜色正确 |
| 修改文件的 ESLint、`git diff --check` | 通过本次收尾检查范围 |

推送前另行执行通知、消息定位、标签页标题、Desktop 浏览历史及移动归档的定向回归：11 文件、258 测试通过。

浏览器测试只回拨自身测试世界的事实时间来结束摘要窗口，真实后台投递器负责生成摘要。测试通过 `TestApiClient` 删除自身世界与账号。验收截图：

- [桌面](inbox-world-2026-11-02/desktop.png)
- [窄屏浅色](inbox-world-2026-11-02/phone-light.png)
- [窄屏深色](inbox-world-2026-11-02/phone-dark.png)

## 验收边界

浏览器和新数据库初始化使用独立验证 checkout 及其环境 `createx-932`。主要 Inbox 后端、投递器、消息 schema、Worker、消息内容组件和 E2E 与主目录核对一致；主目录同时存在其他功能的并行清理，不能把隔离快照验收等同于整个主目录所有检查通过。

主目录最新 Desktop renderer 类型检查仍被 `packages/views/editor/extensions/mention-suggestion.tsx` 的未使用变量及缺失 `userItems` 引用阻塞。本次没有宣称根目录全量检查通过。未执行原生设备/模拟器验收、实际 OS 横幅点击验收、真实 Agent CLI、生产部署或线上验收。

原环境 `createx-440` 及主数据库 `auro_createx_440` 保留，未重置或覆盖；其 migration 记录仍从 `001_init` 开始，当前处于停止状态。项目并行切换新数据库 baseline 的主库升级问题需要单独处理。本次验收不把新库初始化成功视作原主库迁移成功。

临时环境的进程、验证数据库和配置已通过 `make destroy` 清理。工作树归档工具将验证 checkout 识别为当前聊天的 primary checkout，拒绝删除，因此保留 checkout；交付代码、截图和本记录均已保存在原项目主目录。
