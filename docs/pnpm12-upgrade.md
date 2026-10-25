# pnpm 12 升级记录

执行日期：2026-10-06 至 2026-10-07。目标版本为 pnpm **12.9.1 稳定版**，原版本为 **10.28.2**。

## 变更范围

- 根 `package.json` 固定 `pnpm@12.9.1`，本地仍可通过 Corepack 按项目声明选择版本。
- pnpm 配置统一迁至 `pnpm-workspace.yaml`；`.npmrc` 只保留注册表、认证配置的职责。保留原有 `shamefullyHoist` 布局、catalog 和全部 overrides。
- 用 `allowBuilds` 明确允许 `esbuild`、`electron`，明确禁止其他已发现的依赖安装脚本；启用 `strictDepBuilds`，新出现的未审批构建脚本会使安装失败。
- 设置 `verifyDepsBeforeRun: error`。依赖过期时先明确执行 `pnpm install --frozen-lockfile`，避免 `run`、`exec` 隐式修改安装状态。
- 5 个 GitHub workflow 的 8 个 pnpm 设置步骤改为原生 `pnpm/setup`，固定 v3.0.0 的提交 SHA；保留各工作流的 Node 22 配置。由 pnpm action 管理缓存，移除重复的 setup-node pnpm 缓存；安装均使用冻结锁文件。
- Web Docker 的工具链阶段根据根声明安装原生 pnpm。在线依赖阶段使用 `/pnpm/store` 和 `/pnpm/cache`，离线构建阶段同时复制包数据与供应链策略元数据。
- 开发脚本从根声明读取版本，仓库指引同步记录配置与安装边界。

迁移规则参考 [pnpm 官方迁移文档](https://pnpm.io/migration)；原生安装 action 参考 [pnpm/setup v3.0.0](https://github.com/pnpm/setup/releases/tag/v3.0.0)。

## 必要的 Turbo 兼容修复

原锁定的 Turbo 2.9.5 无法解析 pnpm 12 的多文档 YAML 锁文件，运行时会报告依赖图解析警告。本次同步固定 **Turbo 2.9.7**，该稳定版本包含 [官方解析修复](https://github.com/vercel/turborepo/pull/12616)。最终 dry run 已能解析工作区依赖图。

pnpm 12 生成的锁文件包含两个 YAML 文档：第一个记录包管理器依赖，最后一个记录项目依赖。保留 `lockfileVersion: '9.0'`，不能通过删除第一个文档解决旧工具的解析问题，参见 [官方锁文件说明](https://pnpm.io/lockfile)。

结构化比较确认：应用依赖文档仍有 **2185 个 package 条目、13 个 importer**；仅替换 Turbo 及其 6 个平台包，并更新根 Turbo 声明。除此之外，catalog、overrides、importer、package 与 snapshot 内容一致。没有升级 React、Next.js、Expo、Electron 或其他业务依赖；原锁文件中不存在于当前目录的 docs importer 也保留。

## 本地验证

本机环境：macOS arm64、Node 24.14.1。本地结果不能替代 GitHub Node 22 与其他系统的执行结果。

| 项目 | 结果 |
| --- | --- |
| pnpm 版本、Turbo 版本与依赖图 | 12.9.1 / 2.9.7，依赖图解析通过 |
| 全工作区冻结安装 | 通过，包括 Electron、esbuild 安装及工作区 postinstall |
| 全工作区冻结离线安装 | 通过，包含工作区 postinstall |
| 锁文件业务依赖结构比较 | 通过，仅更新上述构建工具记录 |
| CI YAML、8 个原生设置步骤、开发脚本语法 | 通过 |
| CI 范围选择测试 | 39 项通过 |
| 非移动端类型检查、lint | 类型检查流程 9 个任务、lint 8 个任务通过；保留现有 lint 警告 |
| 非移动端单元测试 | 9159 项通过、1 项原有桌面断言失败；详见下表 |
| DEAL / Electron 前端 / UI Lab 构建 | 全部通过；完整桌面构建的 Go 阻塞见下文 |
| 移动端类型检查、lint、测试 | 全部通过，35 个测试文件、234 项测试及 iOS 包装脚本断言通过 |
| Metro 导出 | iOS、Android 均生成 Hermes 字节码包；未进行 IPA、APK 或设备验收 |
| DEAL Go 测试 | `internal/deal`、`cmd/deal`、`pkg/llm` 通过 |
| DEAL 浏览器回归 | scripted 环境、本机 Chrome，6 条端到端流程通过 |
| Docker | 完整镜像构建通过，Linux arm64 / Node 22.23.3；原生安装、离线冻结安装、Web 编译及首页 200 启动检查通过 |
| 完整桌面构建与打包 | Go 编译阻塞，未完成完整安装包验收 |

原 pnpm 10 环境已复现桌面测试 `apps/desktop/scripts/worktree-dev-env.test.mjs` 的现有失败：测试断言 `/tmp/auro-3494` 的校验和模 1000 为 0，实际为 947。该测试及实现未随本次升级修改。最初并行运行大测试集与 Metro 出现额外超时，最终验收采用较低并发复核。

最终测试命令与结果：

```bash
pnpm exec turbo run test --filter='!@auro/mobile' --force --concurrency=1 --continue=always -- --maxWorkers=2
```

| 工作区 | 测试文件 | 测试结果 |
| --- | ---: | --- |
| Core | 171 | 2206 项通过 |
| Views | 473 | 5961 项通过 |
| DEAL | 1 | 2 项通过 |
| Web | 35 | 279 项通过 |
| Desktop | 59 | 665 项通过、上述 1 项失败 |
| UI Lab | 8 | 46 项通过 |

命令以 1 退出，不能视为全量测试绿色。降并发后的完整重跑未出现先前的额外超时。

完整桌面构建需要先编译 Go CLI，而 `server/pkg/remotemcp/client.go:89` 调用不存在的 `netip.Addr.IsLinkLocalAurost`、`IsAurost`。升级前副本执行 `go test ./pkg/remotemcp` 复现相同编译错误，源码字节比较一致；本次未修改该文件。Electron 主进程、preload 和 renderer 的独立构建已通过，不能据此声称完整桌面安装包已通过。需要修复此现有 Go 问题后，再执行 `APPLE_TEAM_ID= CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @auro/desktop package -- --mac dir --arm64 --publish never`。

> **后续（2026-10-07）：** 该编译阻塞已定位并修复。实际影响面为 3 个文件 6 处，而非上文记录的单文件 2 处 —— 包依赖链 `internal/handler → internal/integrations/wecom → pkg/remotemcp` 使 Go 只报告最底层失败包，修一层才暴露下一层。根因是品牌重命名的正则误伤（`Multicast` → `Aurost`），与 pnpm 升级无关。详见文末「Go 编译阻塞修复」。

首次 Playwright 调用因本机没有对应的 Chromium headless shell 而未能启动浏览器。改用已安装 Chrome 后，延期、搜查、合作、红线失败、丢失响应重试、窄屏物品操作全部通过：

```bash
DEAL_TEST_BROWSER_CHANNEL=chrome pnpm exec playwright test --config apps/deal/playwright.config.ts
```

本机只有 Xcode Command Line Tools，未做移动端原生设备/模拟器构建；Windows、Linux 桌面打包和 GitHub 工作流实际执行仍需远程 CI 验证。

本地 Web 镜像名为 `native-pnpm12-web:local`；验收时使用临时的本机端口，首页返回 200、HTML 为 449475 字节，随后停止并删除临时容器。这只证明镜像构建和进程/首页启动，不包含真实后端、账户或业务联调。

原版本的全量测试也曾出现 web 对比度测试超时；已区分基础环境失败与升级后的最终结果。

## 安装耗时比较

在相同业务锁文件、已安装依赖、已缓存包数据与元数据的隔离目录中，执行 `install --frozen-lockfile --offline --ignore-scripts`，各测量 5 次：

| 版本 | 中位耗时 |
| --- | ---: |
| pnpm 10.28.2 | 1.048 秒 |
| pnpm 12.9.1 原生程序 | 0.335 秒 |

该场景耗时减少约 68%。pnpm 10 经 Corepack 启动，pnpm 12 使用原生程序；这是实际工具链的对比，不能单独归因于依赖解析算法。测试跳过安装脚本，不代表完整冷安装、构建或游戏运行的性能。冷安装受网络重试和并行下载影响，未形成可归因的性能结论。

## 使用和回滚

日常安装与检查：

```bash
corepack enable
pnpm --version # 12.9.1
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @auro/mobile typecheck
pnpm --filter @auro/mobile lint
pnpm --filter @auro/mobile test
```

首次使用需要网络获取声明的包管理器。CI 与 Docker 使用原生安装入口，不依赖开发机的全局版本。新增依赖安装脚本时审阅后更新 `allowBuilds`，不要关闭构建审批。

本次变更的 12 个原文件已备份到 `.auro/pnpm12-upgrade/20261006-232250/baseline/`；清单为同目录的 `manifest.json`。该备份已被 `.auro/` 忽略规则覆盖，只保存在本机。

验证日志位于同目录 `logs/`，结构化摘要为 `verification.json`；保留原版本桌面断言和 Go 编译错误的复现证据。

需要回滚时，从仓库根目录执行以下命令。恢复会覆盖清单中的当前配置；如升级后又修改这些文件，应先保存或逐项合并：

```bash
python3 - <<'PY'
import json, pathlib, shutil
backup = pathlib.Path('.auro/pnpm12-upgrade/20261006-232250')
for name in json.loads((backup / 'manifest.json').read_text())['files']:
    shutil.copy2(backup / 'baseline' / name, pathlib.Path(name))
PY
corepack enable
pnpm --version # 10.28.2
pnpm install --frozen-lockfile --force
```

回滚配置必须同时恢复锁文件、pnpm 配置和工作流；不要只改版本字符串。回滚后重跑相应检查。

当前目录没有 `.git`，本次仅完成本地文件修改与验收，未提交、推送或触发远程 workflow。没有发布镜像、桌面安装包或移动端应用。

## Go 编译阻塞修复（2026-10-07）

`go build ./...` 此前失败于品牌重命名的正则误伤：`Multicast` 被替换为 `Aurost`，`InterfaceLocalMulticast` 被替换为 `InterfaceLocalAurost`。

影响面为 **3 个文件 6 处**，全部位于地址白名单 / SSRF 防护路径：

| 文件 | 处数 | 修正为 |
| --- | ---: | --- |
| `server/pkg/remotemcp/client.go:89` | 2 | `IsLinkLocalMulticast`、`IsMulticast` |
| `server/internal/integrations/wecom/media_guard.go:192-193`（含 `:57` 注释） | 3 | 同上，另加 `IsInterfaceLocalMulticast` |
| `server/internal/handler/file.go:949` | 1 | `IsLinkLocalMulticast` |

以上方法名均为 `net/netip.Addr` 的实际谓词（`go doc net/netip.Addr` 可查），替换与原意等价。

验证：

```bash
cd server && go build ./... && go test ./pkg/remotemcp/ ./internal/integrations/wecom/ ./internal/handler/
```

三个包测试通过，`go build ./...` 通过。完整桌面打包仍未验收，需再执行上文给出的 `pnpm --filter @auro/desktop package` 命令。

改动前副本备份于 `.auro/pnpm12-upgrade/20261007-go-auro-fix/baseline/`。

顺带发现与处理（品牌重命名遗留与时间敏感用例，与 pnpm 升级无关）：

- **已修复** `internal/daemon/execenv` 的 `TestCodexShellEnvAllowlistUsesExactTaskAndSafeInheritedNames`（`codex_shell_env_test.go:61`）与 `TestCodexShellEnvAllowlistOnlyAuthorizesExplicitCustomSecrets`（`:107`）：期望值按重命名前的字母序硬编码（`AURO_SERVER_URL` 被期望排在 `LOCALAPPDATA` 与 `PATH` 之间），而实现的 `sort.Slice` 按新名字做大小写不敏感排序 —— 实现正确、期望过时。已同步期望顺序，并用 `gofmt` 补齐因改名而失效的 map 字面量对齐。
- **已修复** `pkg/agent` 的 `TestCursorExecuteLargePromptDoesNotDeadlock`（`cursor_stdin_unix_test.go:137`）：payload 从 `"multica cursor stdin payload 0123456789\n"`（40 字节）改为 `"auro ..."`（37 字节）后，`37 × 13108 = 484996` 掉到用例自身要求的 512 KiB 之下。已改为按 payload 长度推导重复次数，不再耦合字符串长度。
- **已修复** `pkg/agent` 的 `TestGrokSupplementTimesOutIndependentlyAndAllowsNextMessage`（`grok_test.go:243`）：用例把 `grokSupplementTimeout` 临时压到 50 ms 以制造第一次 interject 超时，但该窗口不足以让 fake 完成第二次 interject 的 ACP 往返。已放宽到 300 ms —— 仍满足用例自身「第一次超时 <1s」的断言 —— 并补注释说明取值依据。

这三处此前都不可能被发现：`go build ./...` 失败使整个后端测试无法启动。修复后全量结果：

```bash
cd server && go test ./... > /tmp/gotest.log 2>&1
awk '$1=="FAIL"{print $2}' /tmp/gotest.log   # 仅列失败包，应无输出
```

69 个包全部通过，0 失败。同包的 `TestHermesBackendClosesSessionWhenEarlyFailureLeavesEscapedHolder` 属时间敏感用例，全量并发下偶发失败、单独重跑通过，未作改动。
