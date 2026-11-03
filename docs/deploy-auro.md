# Createx 在 auro 上的独立部署

入口为 `scripts/deploy-createx.sh`，适用于已安装 Node 22+、PostgreSQL、Nginx 和 systemd 的 Linux ARM64 主机。默认 SSH 别名为 `auro`，可用 `CREATEX_DEPLOY_HOST` 更换。脚本不安装或升级主机工具链。

```bash
./scripts/deploy-createx.sh             # 只显示方案
./scripts/deploy-createx.sh preflight   # 只读检查
./scripts/deploy-createx.sh deploy      # 本地构建并部署
./scripts/deploy-createx.sh web         # 只构建并切换 Web 端
./scripts/deploy-createx.sh webcheck    # Web 单端发布的只读前置检查
./scripts/deploy-createx.sh verify
```

本地需要 Go、Node、根 `package.json` 声明的精确 pnpm 版本、npm、rsync 和 SSH。依赖须先用 `pnpm install --frozen-lockfile` 安装。构建需要访问 Google Fonts 和 npm registry。SSH 用户须具备免密 sudo 权限。脚本不会读取或上传本地 `.env`；Next 配置自身会读取 `.env`，脚本显式清空浏览器 API/WS 地址和构建时代理地址，发布包排除所有 `.env*` 文件。

## 隔离边界

| 资源 | Createx 使用值 |
| --- | --- |
| 系统用户 | `createx`，禁止交互登录 |
| 程序与版本指针 | `/opt/createx/releases`、`current`、`previous` |
| 配置与密钥 | `/etc/createx/backend.env`、`web.env`，root 0600 |
| 上传、插件、图片缓存 | `/var/lib/createx` |
| 发布前数据库备份 | `/var/backups/createx/*.dump`，root 0600 |
| PostgreSQL 数据库 / 角色 | `createx` / `createx`，非超级用户 |
| systemd | `createx-api.service`、`createx-web.service`、`createx.slice` |
| Nginx 站点 | `/etc/nginx/sites-available/createx.conf` 及同名 enabled 链接 |
| 本机入口 | `127.0.0.1:23080` |
| Next / Go / pprof | `127.0.0.1:23000` / `28080` / `26060` |

脚本检查资源归属；端口由其他进程占用、目录或配置缺少本脚本标记时直接退出，不终止占用进程。Nginx 配置先执行 `nginx -t`，再平滑 reload；不覆盖其他站点或全局配置，不更改防火墙，不重启 PostgreSQL，不复用其他项目的 Redis、密钥、数据库或运行时。

每次修改服务器前后，脚本比对 AgentPage/AuroCreator 所有 service 的进程、启动时间和 unit 配置，以及 Nginx/PostgreSQL 主进程与其他 Nginx 配置；同时检查这两个项目已有前端和 API 的健康状态。发现变化即报告失败，不尝试重启或恢复其他项目。这是变更检测，不能替代共享主机的容量监控。

本地交叉编译 Go 并构建 Next standalone，产物、Go/npm 缓存放在 `.cache/createx-deploy`，前端构建目录为 `apps/web/.next-createx`。按照项目安装的 sharp 声明下载精确版本的 Linux ARM64 原生依赖，并在目标主机实际生成一张 PNG 验证；不在服务器安装前端依赖或编译应用。

## 性能与发布

- 不配置 CPU 配额、内存上限或较低的 CPU/I/O 权重；项目按系统默认策略自由竞争资源，slice 仅用于分组和统计。Go 与 Node 使用各自默认运行时策略。账号、目录、数据库和端口隔离继续保留。
- API 使用项目默认数据库连接池与搜索内存配置，不额外设置数据库或角色连接数量上限。没有修改共享 PostgreSQL 的全局参数。
- Nginx 直接提供带内容哈希的 Next 静态资源，设置一年缓存和压缩。旧版资源继续保留，避免打开中的旧页面在发布后丢失 chunk；需要按实际访问生命周期单独清理 `/var/lib/createx/static`。动态页面、API、附件不启用代理缓存；WebSocket 传递 Upgrade，API 关闭缓冲以支持流式响应。
- 本地构建锁与服务器 `flock` 防止并发发布；上传校验 SHA-256。完整部署在本地构建前只读检查线上迁移基线；旧账本需要先按下节重建。上传后的精确账本检查通过后，先备份 Createx 数据库，再执行项目迁移器，最后安装 unit、切换版本并重启本项目两个服务。会有短暂重启窗口，不是零停机发布。
- 激活失败恢复上一版程序；数据库迁移保持向前，不自动执行 down 或恢复备份。成功后保留最新三版以及当前/上一版。备份不会自动删除，应配置外部备份与保留周期，避免磁盘耗尽。

```bash
./scripts/deploy-createx.sh rollback    # 上一版程序；数据库结构不回退
./scripts/deploy-createx.sh prune       # 仅清理本项目的旧版本
./scripts/deploy-createx.sh resources   # 移除旧版 Createx 配额，仅重启 Createx
ssh auro 'sudo journalctl -u createx-api -u createx-web -n 100 --no-pager'
```

### 数据库基线重建

当前迁移只初始化空库。出现 `database contains retired migration "001_init"` 表示线上仍是旧迁移历史；Nginx 检查成功和其他项目健康检查成功均不表示本次部署成功。普通 `deploy` 不会修改迁移账本来绕过检查，也不会自动清空旧库。

重建必须独立执行：

1. 核对固定的 `createx` 数据库、角色与服务归属，准备新版本及可回退的旧版本。
2. 停止 Createx 写入，完整备份数据库；保留 `/etc/createx`、`/var/lib/createx` 的配置、密钥和上传文件。
3. 创建独立的新空库，用新版本迁移器初始化；只选择性导入账号、世界、成员、聊天、智能体、技能、集成和游戏数据。旧模块数据及旧迁移账本不导入。
4. 核对保留记录的标识、字段、迁移、索引和关系完整性，再一起切换数据库与程序。激活失败时一起恢复旧库与旧程序，不能让旧程序连接新基线。
5. 验证 `/health`、`/readyz`、Nginx/TLS、受影响的应用入口，以及同机项目状态。保留备份与重建清单。

重建后，`rollback` 会拒绝不支持当前迁移账本的旧 release；跨基线恢复必须使用与该 release 配套的数据库备份。完成重建后继续使用普通 `deploy`。

### Web 单端发布

`./scripts/deploy-createx.sh web` 只本地构建 Next standalone（含 Linux ARM64 sharp 原生依赖），上传后在服务器把当前版本的 API 二进制与迁移原样复制进新 release，切换 `current` 并只重启 `createx-web`。不执行数据库备份与迁移，不重启 API，不改动 systemd unit 与 Nginx。首次部署必须先执行完整 `deploy`；`webcheck` 可在构建前只读确认当前版本存在。

Web 单端 release ID 以 `-web` 结尾，manifest 额外记录 `web_commit=`，`commit=` 仍为运行中 API 的提交，`verify` 的 `/health` 校验因此不变；对 web-only 版本，API 进程目录放宽为任意历史 release。API 崩溃自愈或后续完整部署时仍从 `current` 加载同一二进制。静态资源按内容哈希增量写入 `/var/lib/createx/static`，旧页面引用的 chunk 保留。激活失败只回退 Web；`rollback` 仍整体回退并重启两个服务。后端代码或迁移有变更时不要使用该命令。

## 内部访问与正式域名

首次部署仅开放本机入口：

```bash
ssh -N -L 23080:127.0.0.1:23080 auro
```

浏览器打开 `http://localhost:23080`。初始应用 Origin 与此一致；首次发布不会增加公网监听。`weavea.world` 是仓库定义的正式域名。将其 A 记录设为 `132.145.173.120`，移除旧 A 及未指向该主机的 AAAA 记录后，可使用服务器已有的 certbot 账号签发证书并启用 HTTPS：

```bash
./scripts/deploy-createx.sh https weavea.world
```

该命令仅增加本域名的 ACME webroot 站点，先通过公网随机挑战文件验证 DNS/HTTP 路由，再签发证书。失败会恢复原有 Createx 站点，不重启 Nginx。它要求 certbot 与 ACME 账号已由主机管理员配置，不自动注册账号或接受新条款。续期使用证书自己的 webroot 与 deploy hook，验证 Nginx 配置后 reload。不要在 DNS 尚未就绪时反复申请证书。

如果证书和私钥已放在主机，可直接执行：

```bash
./scripts/deploy-createx.sh publish weavea.world \
  /etc/letsencrypt/live/weavea.world/fullchain.pem \
  /etc/letsencrypt/live/weavea.world/privkey.pem
```

`publish` 检查证书域名、剩余有效期、私钥匹配和已有同名站点，更新应用 Origin，并增加该域名的 HTTP→HTTPS 与 HTTPS 站点。使用本机 SNI 请求验证，失败时恢复配置；不申请证书或更改 DNS。自带证书的续期后需由证书管理流程 reload Nginx。正式域名启用后，应使用该 HTTPS 地址登录，避免 Cookie 与 Origin 不一致。

如果服务器已放置 Cloudflare Origin CA 证书，可以直接接入，不进行域名解析检查。将 Cloudflare 官方提供的 [RSA/ECC 根证书](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/#cloudflare-origin-ca-root-certificate) 保存在本项目的 `/etc/createx/ca/` 后，将 CA bundle 作为第五个参数传入：

```bash
./scripts/deploy-createx.sh publish weavea.world \
  /etc/nginx/certs/weaveaworld.pem \
  /etc/nginx/certs/weaveaworld.key \
  /etc/createx/ca/cloudflare-origin.pem
```

脚本显式校验该 CA、证书名称和本机 TLS 响应，不跳过证书校验，也不修改系统全局 CA 信任。Origin CA 用于 Cloudflare 与源站之间的连接，需配合 Cloudflare 代理和 Full (strict)。`verify` 从 `/etc/createx/site.conf` 读取本项目接入配置，直接访问本机 443 验证，无需 DNS。私钥应为 root 0600。

登录邮件需在服务器 `/etc/createx/backend.env` 中配置 `RESEND_*` 或 `SMTP_*` 后重启 `createx-api`；未配置时服务器仅将验证码写入本项目日志。其他后端集成密钥在该项目自己的 backend env 维护，搜索引擎验证值放在 web env，不从其他应用复制。此部署不会启动代理 daemon；需要执行代理任务时再按产品流程连接运行时。

### DNS 验证失败

若 `https` 无法通过公网挑战文件检查，脚本恢复原站点，不向证书机构申请证书。先核对注册商的 NS 委派与实际编辑记录的平台一致，并确认根域名 `@` 的 A 记录已在权威 DNS 发布。递归解析器可能仍缓存旧地址，不要仅凭本机 `getent` 判断变更是否完成。

如果公共解析器返回 `SERVFAIL`，禁用 DNSSEC 校验的查询却成功，应检查父区 DS 与权威 DNSKEY/签名是否匹配。切换 DNS 平台时遗留的 DS 会导致解析失败；应修复签名链，或在明确不使用 DNSSEC 时从注册商移除旧 DS。详见 [Google 域名排障](https://developers.google.com/speed/public-dns/docs/troubleshooting/domains)。修正后等相关 TTL 缓存失效再重试。

## 验证

```bash
bash scripts/deploy-createx.test.sh
bash -n scripts/deploy-createx.sh scripts/deploy/createx-host.sh
(cd server && go test ./internal/profiling ./cmd/server \
  -run 'TestNewServerAddress|TestMainHTTPAddress|TestNewMainHTTPServerTimeouts' -count=1)
```

边界测试覆盖外部进程占用、非 loopback 监听、外来配置与符号链接拒绝、失败发布恢复版本指针，以及其他项目进程/配置改变或健康检查失败的拒绝。真实 `verify` 另检查运行进程目录、构建 commit、数据库迁移就绪、Linux 图片依赖、Nginx 网关和已配置的源站 TLS。它不验证邮件投递、真实代理执行或登录后的所有游戏流程。

实现参考：[Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)、[systemd 资源控制](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)、[Nginx WebSocket](https://nginx.org/en/docs/http/websocket.html)。
