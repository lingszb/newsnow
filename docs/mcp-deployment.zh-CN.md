# NewsNow MCP 本地测试与云端部署

本文说明如何部署和验证当前 NewsNow 内置的 MCP 服务。内容以本仓库的
Node/Docker 单实例实现为准，不适用于 Cloudflare Pages、Vercel 或其他
Serverless 运行时。

## 1. 当前实现

NewsNow 在网站服务内提供无会话 Streamable HTTP MCP：

```text
POST http://<NewsNow 主机>:4444/mcp
Authorization: Bearer <MCP_INTERNAL_TOKEN>
```

MCP 与网站 API 共用新闻抓取、缓存和行业查询服务，提供四个只读工具：

| 工具 | 参数 | 用途 |
|---|---|---|
| `list_news_sources` | 无 | 列出可用来源 ID、平台、榜单和栏目 |
| `get_hottest_latest_news` | `id`，`count=10` | 获取指定来源的热点资讯，`count` 范围为 1–20 |
| `list_industries` | 无 | 列出当前动态行业的代码、路径、名称和描述 |
| `get_industry_news` | `industry`，`count=10`，`hours=24`，`sort=hot` | 获取已分类的跨平台行业资讯 |

`get_industry_news.industry` 只接受当前 `list_industries` 返回的 `code`。行业可在设置页动态修改，MCP 每次调用都会读取最新配置。`hours` 范围为 1–168，`sort` 只接受 `hot` 或 `latest`。

当前 HTTP MCP 有以下边界：

- 只接受 `POST /mcp`，`GET /mcp` 返回 405。
- 必须配置独立的 `MCP_INTERNAL_TOKEN`，未配置时返回 503。
- 请求必须来自回环地址、私有 IPv4 网段或私有/链路本地 IPv6 地址。
- 请求必须通过 Host/Origin 校验。
- MCP 是无会话服务，不返回或依赖会话 ID。
- stdio 仅用于本机调试，不是云端部署入口。

## 2. 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|---|---:|---|---|
| `MCP_INTERNAL_TOKEN` | 是 | 无 | `/mcp` 专用 Bearer Token，不能复用网站登录凭据 |
| `MCP_ALLOWED_HOSTS` | 视部署而定 | 无 | 逗号分隔的额外主机名；localhost 和私有 IP 会自动允许 |
| `MCP_ALLOWED_ORIGINS` | 视客户端而定 | 无 | 逗号分隔的额外 Origin 完整地址 |
| `NEWS_CLASSIFIER_ENABLED` | 行业工具需要 | `false` | 是否调用百炼分类 |
| `NEWS_CLASSIFIER_API_KEY` | 分类开启时需要 | 无 | 百炼 API Key |
| `NEWS_CLASSIFIER_ENDPOINT` | 否 | 百炼 OpenAI 兼容端点 | 分类请求地址 |
| `NEWS_CLASSIFIER_MODEL` | 否 | `qwen3.6-flash-2026-04-16` | 分类模型 |
| `NEWS_CLASSIFIER_TIMEOUT_MS` | 否 | `30000` | 单次分类请求超时，允许 1000 至 120000 毫秒 |
| `NEWS_CLASSIFICATION_VERSION` | 否 | `industry-v1` | 分类版本 |
| `INIT_TABLE` | 首次启动需要 | 无 | 设置为 `true` 以创建数据库表 |
| `ENABLE_CACHE` | 建议 | 无 | 设置为 `true` 以启用 SQLite 缓存 |

行业分类属于结构化提取任务，所有分类请求都会关闭模型思考。百炼中的 Qwen、DeepSeek、Kimi、GLM 等混合思考模型使用 `enable_thinking: false`；MiniMax/MiniMax-M3 使用 `thinking.type: disabled`。思考模式无法关闭的模型不适合作为分类模型。

注意：

- 当前实现不会自动读取 `DASHSCOPE_API_KEY`。
- 如果本机已设置 `DASHSCOPE_API_KEY`，启动前应显式映射：

```powershell
$env:NEWS_CLASSIFIER_API_KEY = $env:DASHSCOPE_API_KEY
```

- 不要把真实 Token 或 API Key 写入 Git、Dockerfile 或镜像。

生成本地测试 Token：

```powershell
$env:MCP_INTERNAL_TOKEN = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLowerInvariant()
```

## 3. 本地 Node 部署

### 3.1 前置条件

- Windows PowerShell 7
- Node.js 22.12 或更高版本
- Corepack 和 pnpm

Node 22 同时满足当前 Vite 构建和 MCP Inspector 的运行要求。

### 3.2 配置

```powershell
Set-Location D:\comcode\newsnow
corepack enable
pnpm install
Copy-Item example.env.server .env.server
```

编辑 `.env.server`，至少设置：

```dotenv
HOST=127.0.0.1
PORT=4444
INIT_TABLE=true
ENABLE_CACHE=true
MCP_INTERNAL_TOKEN=请替换为随机长令牌
MCP_ALLOWED_HOSTS=
MCP_ALLOWED_ORIGINS=

# 如需行业分类：
NEWS_CLASSIFIER_ENABLED=true
NEWS_CLASSIFIER_API_KEY=请替换为百炼APIKey
NEWS_CLASSIFIER_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
NEWS_CLASSIFIER_MODEL=qwen3.6-flash-2026-04-16
NEWS_CLASSIFIER_TIMEOUT_MS=30000
NEWS_CLASSIFICATION_VERSION=industry-v1
```

`.env.server` 已被 `.gitignore` 排除。

### 3.3 开发模式

```powershell
pnpm dev
```

默认访问地址以 Vite 控制台输出为准。MCP URL 为同一服务下的 `/mcp`。
后续使用 `127.0.0.1:4444` 的示例针对本地生产模式或 Docker；开发模式应替换为
Vite 实际输出的端口。

### 3.4 本地生产模式

```powershell
pnpm build
pnpm start
```

`pnpm start` 会通过 `--env-file .env.server` 加载运行配置。

### 3.5 检查后台状态

```powershell
Invoke-RestMethod http://127.0.0.1:4444/api/industry-status |
  ConvertTo-Json -Depth 5
```

重点检查：

- `running`：当前后台刷新是否仍在执行。
- `classifierEnabled`：分类开关是否开启。
- `classifierConfigured`：分类 API Key 是否已配置。
- `pendingClassifications`：待分类数量。
- `failedClassifications`：最终失败数量。

首次启动会抓取多个来源并创建分类队列。分类开启后，
`pendingClassifications` 应逐步下降。分类尚未完成时，
`get_industry_news` 返回空数组是正常状态。

## 4. 本地 Docker 部署

### 4.1 从当前工作树构建

使用 `docker-compose.local.yml`：

```powershell
Set-Location D:\comcode\newsnow
Copy-Item example.env.server .env
```

编辑 `.env`，至少设置：

```dotenv
MCP_INTERNAL_TOKEN=请替换为随机长令牌
MCP_ALLOWED_HOSTS=newsnow
MCP_ALLOWED_ORIGINS=

NEWS_CLASSIFIER_ENABLED=false
NEWS_CLASSIFIER_API_KEY=
```

如需使用当前 PowerShell 会话中的百炼密钥，不必写入 `.env`：

```powershell
$env:NEWS_CLASSIFIER_ENABLED = "true"
$env:NEWS_CLASSIFIER_API_KEY = $env:DASHSCOPE_API_KEY
$env:MCP_INTERNAL_TOKEN = "请替换为随机长令牌"
```

构建并启动：

```powershell
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f newsnow
```

当前工作树必须使用 `docker-compose.local.yml`。根目录的
`docker-compose.yml` 默认拉取上游 `ghcr.io/ourongxing/newsnow:latest`，
不保证包含本地未提交改动。

SQLite 数据保存在命名卷 `newsnow_data`，重建容器不会删除该卷。

当前 Dockerfile 固定使用 Node `20.12.2`。本地镜像已经构建并通过运行验证，
但 Vite 7 构建时会提示其低于推荐的 `20.19+`。这不是本次已验证镜像的运行
阻塞项；后续升级基础镜像后应重新执行完整构建和容器验收。

### 4.2 使用导出的镜像包

导入：

```powershell
docker load -i .\dist\newsnow-industry-mcp-20260731.tar
docker compose -f docker-compose.local.yml up -d --no-build
```

验证镜像：

```powershell
docker image inspect newsnow:local
```

停止服务但保留数据：

```powershell
docker compose -f docker-compose.local.yml down
```

不要执行 `down -v`，除非明确要删除 `newsnow_data` 中的缓存、文章和分类数据。

## 5. 使用 MCP Inspector 测试

官方 MCP Inspector 支持 Streamable HTTP、Bearer Token、自定义 Header、
`tools/list` 和 `tools/call`。当前 Inspector 要求 Node.js `^22.7.5`。

参考：

- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [MCP Inspector GitHub](https://github.com/modelcontextprotocol/inspector)
- [Streamable HTTP Transport](https://modelcontextprotocol.io/specification/draft/basic/transports)

以下命令已在本仓库当前 `/mcp` 实现上实际验证。

### 5.1 列出工具

```powershell
$McpUrl = "http://127.0.0.1:4444/mcp"

npx.cmd -y @modelcontextprotocol/inspector@latest `
  --cli $McpUrl `
  --transport http `
  --method tools/list `
  --header "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

预期出现：

```text
list_news_sources
get_hottest_latest_news
list_industries
get_industry_news
```

### 5.2 列出来源

```powershell
npx.cmd -y @modelcontextprotocol/inspector@latest `
  --cli $McpUrl `
  --transport http `
  --method tools/call `
  --tool-name list_news_sources `
  --header "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

### 5.3 获取指定来源热点

先从 `list_news_sources` 的结果中选择有效来源 ID：

```powershell
npx.cmd -y @modelcontextprotocol/inspector@latest `
  --cli $McpUrl `
  --transport http `
  --method tools/call `
  --tool-name get_hottest_latest_news `
  --tool-arg id=zhihu `
  --tool-arg count=5 `
  --header "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

预期同时返回：

- 供旧客户端阅读的文本内容。
- 包含 `sourceId`、`sourceName` 和 `items` 的 `structuredContent`。

该工具可能触发指定来源刷新，因此测试时需要允许 NewsNow 访问外部新闻来源。

### 5.4 列出动态行业

```powershell
npx.cmd -y @modelcontextprotocol/inspector@latest `
  --cli $McpUrl `
  --transport http `
  --method tools/call `
  --tool-name list_industries `
  --header "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

返回的 `structuredContent.industries` 包含 `code`、`path`、`name` 和 `description`。设置页修改行业后再次调用即可得到最新结果，无需重连 MCP。

### 5.5 获取行业资讯

先从 `list_industries` 的结果中选择当前有效的行业 `code`：

```powershell
npx.cmd -y @modelcontextprotocol/inspector@latest `
  --cli $McpUrl `
  --transport http `
  --method tools/call `
  --tool-name get_industry_news `
  --tool-arg industry=TECH `
  --tool-arg count=10 `
  --tool-arg hours=24 `
  --tool-arg sort=hot `
  --header "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

如果 `items` 为空，依次检查：

1. `/api/industry-status` 中分类是否开启且已配置。
2. `pendingClassifications` 是否仍大于 0。
3. `failedClassifications` 是否增长。
4. 所选行业和时间范围内是否确实有已分类文章。

### 5.5 Inspector 图形界面

```powershell
npx.cmd -y @modelcontextprotocol/inspector@latest
```

浏览器打开 Inspector 输出的本地地址，通常为
`http://localhost:6274`。连接配置：

```text
Transport: Streamable HTTP
URL: http://127.0.0.1:4444/mcp
Header: Authorization
Value: Bearer <MCP_INTERNAL_TOKEN>
```

Inspector 代理具有连接服务和启动本地进程的能力，不要把 Inspector 自身暴露到
不可信网络。

### 5.6 stdio 调试

stdio 适配器不会独立启动 NewsNow。必须先运行网站服务，再执行：

```powershell
$env:BASE_URL = "http://127.0.0.1:4444"

npx.cmd -y @modelcontextprotocol/inspector@latest `
  pnpm.cmd --silent mcp:stdio
```

stdio 适配器通过 `BASE_URL` 调用网站 API，不经过 `/mcp` 的 Bearer、Host 和
Origin 校验，仅用于同机开发调试。

## 6. 鉴权与错误验证

缺少 Bearer Token：

```powershell
curl.exe -i -X POST http://127.0.0.1:4444/mcp `
  -H "Content-Type: application/json" `
  --data "{}"
```

Token 已配置时，预期返回 401 和：

```text
WWW-Authenticate: Bearer
```

使用不支持的 GET：

```powershell
curl.exe -i http://127.0.0.1:4444/mcp `
  -H "Authorization: Bearer $env:MCP_INTERNAL_TOKEN"
```

预期返回 405。

常见状态码：

| 状态码 | 原因 |
|---:|---|
| 401 | Token 缺失或不匹配 |
| 403 | 请求不是私网来源，或 Host/Origin 不允许 |
| 405 | 使用了非 POST 方法 |
| 503 | 服务端没有配置 `MCP_INTERNAL_TOKEN` |

## 7. 云服务器部署

### 7.1 推荐拓扑

```text
MCP 客户端
    │
    │ VPN、VPC 或内网入口
    ▼
防火墙 / Security Group
    │
    ├── 可选：同机 Nginx/Caddy + TLS
    ▼
NewsNow 容器 :4444
    │
    ▼
newsnow_data 持久卷
```

推荐使用普通 Linux 云主机和 Docker Engine，以单实例方式运行。
不要将行业分类、后台刷新或 `/mcp` 部署到无持久磁盘的 Serverless 平台。

### 7.2 网络要求

- 端口 `4444` 只允许 VPN、VPC 或明确的内网 CIDR 访问。
- 不要仅依赖 Bearer Token 把 `/mcp` 直接暴露到公网。
- 如果前面有反向代理，应用看到的来源地址通常是代理或 Docker 网桥私有地址。
  此时应用层私网检查会通过，公网隔离必须由防火墙、Security Group、VPN 或代理
  ACL 保证。
- 使用域名时，把实际域名加入 `MCP_ALLOWED_HOSTS`。
- 浏览器或带 Origin 的客户端跨域访问时，把完整 Origin 加入
  `MCP_ALLOWED_ORIGINS`。

### 7.3 从源码构建

在云服务器上：

```bash
git clone <你的仓库地址> newsnow
cd newsnow
cp example.env.server .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
INIT_TABLE=true
ENABLE_CACHE=true

NEWS_CLASSIFIER_ENABLED=true
NEWS_CLASSIFIER_API_KEY=请替换
NEWS_CLASSIFIER_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
NEWS_CLASSIFIER_MODEL=qwen3.6-flash-2026-04-16
NEWS_CLASSIFIER_TIMEOUT_MS=30000
NEWS_CLASSIFICATION_VERSION=industry-v1

MCP_INTERNAL_TOKEN=请替换为至少32字节随机令牌
MCP_ALLOWED_HOSTS=newsnow,10.0.0.10,mcp.internal.example.com
MCP_ALLOWED_ORIGINS=
```

Linux 可生成 Token：

```bash
openssl rand -hex 32
```

启动：

```bash
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f newsnow
```

生产环境建议给服务增加 `restart: unless-stopped`，并确认
`newsnow_data:/usr/app/.data` 挂载没有被删除。

### 7.4 使用离线镜像包

把镜像包、`docker-compose.local.yml` 和 `.env` 上传到服务器：

```bash
docker load -i newsnow-industry-mcp-20260731.tar
docker compose -f docker-compose.local.yml up -d --no-build
```

镜像导入后应存在：

```bash
docker image inspect newsnow:local
```

### 7.5 同机反向代理

如果使用同机 Nginx，建议让云防火墙只开放内网 HTTPS 入口，并把宿主机
`docker-compose.local.yml` 中的端口映射改为
`127.0.0.1:4444:4444`，将宿主机 `4444` 限制为回环地址。代理必须保留原
Host：

```nginx
location / {
    proxy_pass http://127.0.0.1:4444;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
}
```

对应环境变量示例：

```dotenv
MCP_ALLOWED_HOSTS=mcp.internal.example.com
MCP_ALLOWED_ORIGINS=https://mcp.internal.example.com
```

如果客户端不发送 Origin，可不配置 `MCP_ALLOWED_ORIGINS`。

### 7.6 云端验收

在同一 VPC/VPN 内的测试机执行：

```bash
curl -fsS https://mcp.internal.example.com/api/industry-status
```

然后使用 Inspector CLI：

```bash
npx -y @modelcontextprotocol/inspector@latest \
  --cli https://mcp.internal.example.com/mcp \
  --transport http \
  --method tools/list \
  --header "Authorization: Bearer ${MCP_INTERNAL_TOKEN}"
```

上线验收至少包括：

1. `tools/list` 只出现预期的四个工具。
2. 四个工具均能返回 `structuredContent`。
3. 缺少或错误 Token 返回 401。
4. 未允许的 Host/Origin 返回 403。
5. 公网来源无法绕过 VPN、防火墙或代理 ACL 访问。
6. 重启容器后，行业数据和缓存仍存在。
7. `failedClassifications` 没有持续增长。

## 8. 运维

查看日志：

```bash
docker compose -f docker-compose.local.yml logs --tail=200 newsnow
```

重启：

```bash
docker compose -f docker-compose.local.yml restart newsnow
```

备份持久卷：

```bash
mkdir -p backups
docker run --rm \
  -v newsnow_data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine \
  tar -czf /backup/newsnow-data.tar.gz -C /data .
```

升级源码部署：

```bash
git pull
docker compose -f docker-compose.local.yml up -d --build
```

轮换 `MCP_INTERNAL_TOKEN` 后需要重新创建容器，使新环境变量生效：

```bash
docker compose -f docker-compose.local.yml up -d --force-recreate
```

## 9. 故障排查

| 现象 | 检查项 |
|---|---|
| `/mcp` 返回 503 | 是否配置并注入 `MCP_INTERNAL_TOKEN` |
| 返回 401 | Header 是否为 `Authorization: Bearer <token>`，容器是否已重建 |
| 返回 403 | 客户端来源网段、Host、Origin、反向代理和 Security Group |
| 返回 405 | MCP 客户端是否使用 Streamable HTTP POST |
| Inspector 无法启动 | Node 是否满足 Inspector 当前要求 |
| `tools/list` 正常但行业结果为空 | 分类开关、API Key、待分类数、失败数和时间范围 |
| 热点工具提示来源无效 | 先调用 `list_news_sources` 获取当前来源 ID |
| 容器重建后数据丢失 | 是否挂载并保留 `newsnow_data` |
| Compose 没有本地新功能 | 是否误用了拉取上游镜像的 `docker-compose.yml` |
