# NewsNow AI: Vercel 前端 + JEV 行业分类 + 资讯 Agent

> 实施状态：开发分支预览。尚未完成线上部署与端到端验收。主分支保持不变。

## 部署拓扑

```text
浏览器 ── HTTPS ── Vercel (Vite 静态站点)
                       └─ /api/* → api/[...path].js → HTTPS Node/Nitro 服务
                                                   ├─ 新闻抓取与热点缓存
                                                   ├─ SQLite（持久化数据卷）
                                                   ├─ Qwen / JEV 分类队列
                                                   ├─ 资讯问答 /api/agent/chat
                                                   └─ 内网 MCP（不走 Vercel 代理）
```

此方案不把现有 SQLite、后台轮询和受私网访问限制的 `/mcp` 搬到无持久磁盘的 Vercel Functions，因而无需重写现有存储层。Vercel 侧只处理静态页面与轻量 HTTP 代理。

## 1. 恢复后端

沿用现有 Node/Docker + 持久卷部署，参见 [MCP 部署说明](./mcp-deployment.zh-CN.md)。

```bash
cp example.env.server .env
# 在 .env 中填写真实密钥并确保 NEWS_CLASSIFIER_ENABLED=true
docker compose -f docker-compose.local.yml up -d --build
```

以下参数放在后端的 `.env` / `.env.server`，不要放到 `VITE_*` 环境变量中：

```dotenv
INIT_TABLE=true
ENABLE_CACHE=true
NEWS_CLASSIFIER_ENABLED=true
NEWS_CLASSIFIER_PROVIDER=jev
NEWS_JEV_ENDPOINT=https://openrouter.ai/api/alpha/decisions
NEWS_JEV_MODEL=typesafe/jev-1.14
OPENROUTER_API_KEY=sk-or-请替换
# 或只为分类配置 NEWS_JEV_API_KEY=sk-or-...

AGENT_CHAT_MODEL=openai/gpt-4o-mini
# 可使用独立的 Agent 密钥（可选）
AGENT_OPENROUTER_API_KEY=
```

- 分类仍调用现有 `server/services/news-classifier.ts` 的批量任务；设置 `NEWS_CLASSIFIER_PROVIDER=qwen` 可回退旧实现。
- 当 JEV 启用时，分类模型来自 `NEWS_JEV_MODEL`，设置页仅显示模型，不允许误修改旧 Qwen 模型配置。
- JEV 使用 OpenRouter `/api/alpha/decisions`，不是 `/api/v1/chat/completions`；Agent 的生成式模型则使用聊天接口。
- 保留 `MCP_INTERNAL_TOKEN` 与 MCP 私网访问限制，**不要**在 Vercel 公开代理 `/mcp`。
- 切换分类器不会自动重算已有分类；只影响后续待处理任务，历史记录需按需单独重新入队。

## 2. 在 Vercel 恢复网站

在 Vercel Dashboard 重新创建项目并选择 **Import Git Repository**：

1. 导入 `lingszb/newsnow`，测试时选择本开发分支 `feat/newsnow-ai-jev-classifier`，或者先通过 PR 创建 Preview。
2. Framework Preset: **Vite**。仓库的 `vercel.json` 已提供 `buildCommand`、`outputDirectory` 和 SPA 回退。
3. Build Command: `pnpm run build:vercel`；Output Directory: `dist`。
4. 在 Project Settings → Environment Variables 填写：

   ```dotenv
   NEWSNOW_BACKEND_URL=https://你的后端HTTPS域名
   ```

   该变量仅供 Vercel Function 使用，不是前端 `VITE_*` 变量；不要填后台 API Key。
5. 部署后检查 `/`、`/industry` 和 `/api/latest`。若后端尚未恢复，前端可打开，但代理会返回 502 / 503。
6. 将 GitHub OAuth 回调改为新站点域名并验证登录与鉴权（如启用登录）。

> 后端必须具有公网可达的 HTTPS 入口才能被 Vercel 函数访问，但 **MCP 端点不能因此公开**。配置防火墙、反向代理路由和限流，只让非 MCP HTTP API 对外提供服务。最好添加服务间认证和独立的公共 API 网关，再用于真实公网流量。

## 3. 功能验收

```bash
# 在 Node 后端验证
curl -fsS https://你的后端域名/api/industry-status
curl -fsS https://你的后端域名/api/industries

# 浏览器或者 curl 验证 Vercel 同源 API
curl -fsS https://你的vercel域名/api/latest
curl -fsS https://你的vercel域名/api/industry-status
```

Agent 测试：

```bash
curl -fsS https://你的vercel域名/api/agent/chat \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"role":"user","content":"总结最近科技热点"}],"industryPath":"tech"}'
```

当行业分类队列为空、且行业新闻已入库时，应返回 `answer` 和来源数组 `sources`；没有分类数据时会提示尚无可用新闻，而不是编造答案。

### 上线前仍需验证

- `pnpm install && pnpm typecheck && pnpm test && pnpm run build:vercel`
- JEV 实际请求是否支持所选批量问题数量；根据真实数据评估分类准确率和响应延迟。
- **JEV confidence 不是分类正确率**。现有分类阈值 0.60 延续原方案，必须用人工标注样本校准。
- 来源链接有效性与文章摘要覆盖度，检查 Agent 是否引用了与答案对应的新闻。
- Vercel Function 转发请求体、Cookies、鉴权 Header 和返回流的兼容性。
- 线上 Agent 调用限流、滥用防护、费用预算与日志脱敏。现有每进程软限流不能替代正式的网关限流。
- 移动端侧边栏、深色模式、行业路由深链和 PWA 缓存。
- GitHub OAuth 新域名回调验证。

## 4. 下一阶段

现阶段的 Agent 属于 **资讯上下文问答 MVP**：利用已存储的标题、摘要和行业标签回答，并给出来源。它尚不是完整的检索增强 Agent（无全文向量检索、多工具编排、长期会话存储）。下一期可以加入 JEV 意图路由、全文抓取、检索索引、跨来源事件聚类和可观察的 tool-calling trace。
