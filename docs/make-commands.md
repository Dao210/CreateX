# Make 命令参考

所有命令从仓库根目录执行。命令实现以 [Makefile](../Makefile) 为准；环境管理逻辑见 [scripts/dev-env.sh](../scripts/dev-env.sh)。

## 常用操作

```bash
make help                      # 查看全部命令；直接运行 make 效果相同
make up                        # 启动当前目录的 API 和 Web 环境
make status                    # 查看组件状态、地址及日志目录
make list                      # 列出本机注册的 Auro 开发环境
make down                      # 停止当前环境，保留数据库和配置
make build                     # 编译 Go 服务、CLI（含 daemon）和迁移工具
```

`make up`、`make status`、`make down` 是日常环境管理入口。数据库默认通过 `DATABASE_URL` 直接连接；本地开发需要 PostgreSQL 客户端工具。Docker PostgreSQL 通过 `make db-up` 按需启用。

## 帮助与环境管理

| 命令 | 作用 |
| --- | --- |
| `make help` | 显示命令列表，也是直接执行 `make` 时的默认目标。 |
| `make makehelp` | `make help` 的别名。 |
| `make up` | 启动当前目录的托管环境，默认包含 API 和 Web。 |
| `make status` | 分别查看 API、Web、daemon、Desktop 及数据库状态，并显示环境归属和日志目录。 |
| `make down` | 停止环境进程，保留数据库、CLI profile 和分配的环境槽位。 |
| `make list` | 列出本机注册的 Auro 开发环境。状态列表示 API 状态。 |
| `make destroy` | 停止环境并删除其数据库、CLI profile 等环境数据，释放槽位；默认询问确认。 |
| `make gc` | 回收源码目录已消失或有效期已结束的环境，删除相应环境数据。 |
| `make env-exec ARGS="-- 命令 参数"` | 在当前环境的变量和工作目录下执行命令。 |

指定组件和环境参数：

```bash
make up C=api                           # 仅 API
make up C=api,web,daemon                # API、Web 和 agent daemon
make up C=desktop                       # Desktop，并确保 API 启动
make up ARGS="--all"                    # API、Web、daemon、Desktop
make up ARGS="--name myenv"             # 新建环境时指定名称
make env-exec ARGS="-- pnpm dev:desktop"
```

`C` 支持的 Auro 组件是 `api`、`web`、`daemon`、`desktop`。选择 Web、daemon 或 Desktop 时，脚本会同时确保 API 启动。环境已登记时会复用其数据库、端口和 profile。

临时环境和清理预览：

```bash
make up ARGS="--ephemeral"              # 标记 owner=agent，默认有效期 24 小时
make up ARGS="--ttl 48"                 # 标记 owner=agent，设置有效期 48 小时
make gc ARGS="--dry-run"                # 仅预览将被回收的环境
make list ARGS="--json"                 # 含有效期和各端口的结构化列表
make status ARGS="--json"               # 当前环境的结构化状态
make status ARGS="createx-440"           # 按登记名称查看一个环境
```

已有环境只有显式传入 `--ephemeral` 或 `--ttl` 时才更新 owner 和有效期。普通 `make up` 会保留这些属性。到期环境会在执行 `make gc` 时被回收，`make up` 也会先触发自动清理；回收包含停止进程、删除数据库和 profile。长期使用前应查看登记的有效期。

## DEAL 与 Siege 独立壳

| 命令 | 作用 |
| --- | --- |
| `make up C=deal` | 启动独立 DEAL 环境，数据和日志位于 `.deal/`。 |
| `make status C=deal` | 查看 DEAL 状态。 |
| `make down C=deal` | 停止 DEAL，保留数据。 |
| `make up C=siege` | 启动 Siege 独立演示与测试壳。 |
| `make status C=siege` | 查看 Siege 独立壳状态。 |
| `make down C=siege` | 停止 Siege 独立壳，保留数据。 |

`deal`、`siege` 通过各自脚本管理，需要单独指定，不能与 Auro 组件组合为一个 `C` 值。`make list` 枚举的是 Auro 环境注册表；DEAL 和 Siege 独立壳分别使用上表的状态命令。Auro 工作区内的 Siege 功能随 API 和 Web/Desktop 启动。

## 编译与单独运行

| 命令 | 作用 |
| --- | --- |
| `make build` | 编译 `server/bin/server`、`server/bin/auro`、`server/bin/migrate`；注入对应版本信息。 |
| `make daemon` | 使用源码 CLI 重启 `local` profile 的 agent daemon，使用 CLI 已保存的登录状态。 |
| `make auro ARGS="..."` | 从 Go 源码执行 CLI，并传递子命令和参数。 |
| `make cli ARGS="..."` | `make auro` 的别名。 |
| `make api-dev` | 直接运行当前配置下的 Go API，不重复执行数据库预检查。 |
| `make server` | 检查环境文件和数据库后运行 Go API。 |
| `make web-dev` | 启动 Next.js 开发服务。 |
| `make desktop-dev` | 启动 Electron 开发环境。 |

daemon 集成在 `auro` CLI 中，随 `make build` 编译。构建和管理示例：

```bash
make build
make auro ARGS="daemon status --profile local"
make daemon
```

`make daemon` 会编译运行源码并重启进程。托管环境的 daemon 使用自己的 profile，通常形如 `dev-createx-440`；通过 `make up C=daemon` 和 `make status` 管理该环境的 daemon。

`make build` 可以覆盖版本和目标平台：

```bash
make build VERSION=dev COMMIT=local
make build GOOS=linux GOARCH=amd64
make build GOOS=linux GOARCH=arm64
make build GOOS=darwin GOARCH=arm64
make build GOOS=windows GOARCH=amd64
```

Windows 目标自动添加 `.exe` 后缀。`VERSION`、`COMMIT` 默认由 Git 推导，无法读取时分别使用 `dev`、`unknown`；CLI 的构建时间由 `DATE` 设置。

前端生产构建使用 pnpm：

```bash
pnpm build                              # 全部前端应用，排除移动端
pnpm --filter @auro/web build            # Web
pnpm --filter @auro/desktop build        # Desktop 编译
pnpm --filter @auro/deal build           # DEAL
pnpm --filter @auro/siege build          # Siege 独立壳
```

## 初始化与其他启动入口

| 命令 | 作用 |
| --- | --- |
| `make setup` | 根据环境文件安装依赖、确保数据库存在并执行迁移。 |
| `make start` | 检查数据库、执行迁移，然后在当前终端启动 API 和 Web。 |
| `make stop` | 按环境配置的端口强制停止 API 和 Web 监听进程。 |
| `make dev` | 自动准备环境文件、数据库和迁移并启动服务。 |

`make stop` 按端口终止进程。托管环境日常停止使用 `make down`，它会检查进程归属。

## 主目录与 worktree

| 命令 | 作用 |
| --- | --- |
| `make worktree-env` | 生成 `.env.worktree`，配置独立数据库和端口。 |
| `make setup-main` | 使用 `.env` 初始化。 |
| `make start-main` | 使用 `.env` 启动。 |
| `make stop-main` | 停止 `.env` 指定端口上的进程。 |
| `make check-main` | 使用 `.env` 运行综合检查。 |
| `make setup-worktree` | 缺少 `.env.worktree` 时先生成，再初始化。 |
| `make start-worktree` | 使用 `.env.worktree` 启动。 |
| `make stop-worktree` | 停止 `.env.worktree` 指定端口上的进程。 |
| `make check-worktree` | 使用 `.env.worktree` 运行综合检查。 |
| `make remove-worktree WORKTREE=/绝对路径` | 删除指定 worktree 的数据库，再移除其目录。 |

Makefile 默认优先选择存在的 `.env`，其次选择 `.env.worktree`。`setup`、`start`、`stop`、`check` 等直接读取 Makefile 环境配置的目标可显式指定文件：

```bash
make setup ENV_FILE=.env.worktree
make check ENV_FILE=.env.worktree
```

托管环境的 `up` 会按目录自动选择环境文件，`status`、`down` 使用注册表定位环境；它们不依赖上述 `ENV_FILE` 覆盖方式。Worktree 应通过环境脚本配置，不复制主目录的 `.env`，也不手工猜测 PostgreSQL 实例来创建数据库。

## 数据库与代码生成

| 命令 | 作用 |
| --- | --- |
| `make db-up` | 通过 Docker Compose 启动共享 PostgreSQL。 |
| `make db-down` | 停止数据库 Compose 环境，保留 Docker 数据卷。 |
| `make db-drop` | 确认后永久删除当前配置的本地数据库。 |
| `make db-reset` | 删除并重建当前本地数据库，再执行全部迁移；当前实现使用 Docker Compose 的 PostgreSQL 容器。 |
| `make migrate-up` | 确保目标数据库存在，然后执行向上迁移。 |
| `make migrate-down` | 确保目标数据库存在，然后执行回滚。 |
| `make sqlc` | 根据 SQL 查询重新生成 sqlc Go 代码。 |

`db-drop`、`db-reset` 会丢失数据库内容，`migrate-down` 也可能删除数据。原生 PostgreSQL 开发环境不需要先执行 `make db-up`。

## 测试与清理

| 命令 | 作用 |
| --- | --- |
| `make test` | 检查数据库、执行迁移，再运行 Go race 测试。 |
| `make check` | 检查数据库，执行前端类型检查、TS 单元测试、Go 测试和 Playwright E2E；按需为 E2E 启动 API/Web，并在结束时停止本次启动的进程。 |
| `make clean` | 删除 Go 产物和临时目录、前端构建产物、MDX/Expo/Turbo 缓存及 TS 增量编译文件。 |

`make check` 不包含移动端验证和根前端 lint。相关命令另行执行：

```bash
pnpm lint
pnpm --filter @auro/mobile typecheck
pnpm --filter @auro/mobile lint
pnpm --filter @auro/mobile test
```

## Docker 自托管

| 命令 | 作用 |
| --- | --- |
| `make selfhost` | 缺少 `.env` 时生成配置，拉取官方镜像并启动自托管环境。 |
| `make selfhost-build` | 缺少 `.env` 时生成配置，从当前源码构建后端和 Web 镜像并启动。 |
| `make selfhost-stop` | 停止自托管 Compose 环境。 |

这些命令需要 Docker Compose CLI 插件。

## 如何阅读 `make list`

输出列依次为：**环境名称、API 状态、owner、API 端口、数据库名称、源码目录**。

```text
createx-440              running  agent    18520  auro_createx_440             /Users/chunjun/Desktop/Build/Games/createx
```

| 示例值 | 含义 |
| --- | --- |
| `createx-440` | 环境登记名称。默认由目录名和分配的槽位组成，此例槽位偏移为 `440`。 |
| `running` | API 健康响应通过当前源码和进程归属校验。Web、daemon、Desktop 有各自状态，通过 `make status` 查看。 |
| `agent` | 环境生命周期 owner 标记，使用 `--ephemeral` 或 `--ttl` 时设置。有效期以登记记录为准。 |
| `18520` | API HTTP 端口，默认分配规则为 `18080 + 440`。 |
| `auro_createx_440` | 此环境连接的 PostgreSQL 数据库名称。 |
| `/Users/chunjun/Desktop/Build/Games/createx` | 此环境绑定的源码目录。 |

同一槽位的默认 Web 端口为 `13000 + 440 = 13440`，Desktop renderer 端口为 `5174 + 440 = 5614`。实际端口通过 `make status` 或 JSON 列表核对。

其他 API 状态：`stopped` 表示未取得 API 健康响应，`mismatch` 表示取得响应但环境身份未匹配。查询依赖本机端口访问和进程信息权限。

环境默认登记在 `~/.auro/dev/envs/`，可以通过 `AURO_DEV_HOME` 改变注册表位置。`make list ARGS="--json"` 还会提供 `created_at`、`ttl_hours`、`expires_at`；时间以 UTC 表示，`ttl_hours=0` 表示未设置有效期。

## 尚未实现的目标

`seed` 只出现在 Makefile 的 `.PHONY` 声明中，没有执行步骤，不能用来初始化业务数据。
