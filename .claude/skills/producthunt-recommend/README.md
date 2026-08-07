# Product Hunt 图文推荐 Skill

针对 Product Hunt 三套数据源(日榜 / 周榜 / 月榜)生成「小红书组图」竖版图文推荐:封面页 + 每产品一页 + 总结页(全部 3:4),用 playwright 无头浏览器逐张截图成 PNG。产品的 AI 评价由调用 agent 自行撰写,数据一律来自真实榜单。

> 本 skill 与 newsnow 服务**分离**,仅通过 newsnow 的 HTTP `/mcp` 拉取 producthunt 榜单数据。
> 视觉系统移植自 [guizang-social-card-skill](https://github.com/op7418/guizang-social-card-skill)(Editorial 杂志 × E-ink / Swiss 瑞士两套),按本项目需要瘦身为 3:4 小红书卡专用,**不含 Live Photo / 微信公众号封面 / 地图**。

## 目录结构

```
producthunt-recommend/
├── SKILL.md                       # 主入口:触发、工作流、产物说明
├── reference/
│   ├── 图文规范.md                 # 视觉/内容硬规则(风格模式、主题色板、字号、反模式)
│   └── page-planning.md           # 封面/产品页/总结页规划、文案压缩、数据纪律
├── assets/
│   ├── template-teardown-card.html   # Teardown 产品拆解种子(默认,暖橙)
│   ├── template-editorial-card.html  # Editorial 种子(6 主题)
│   └── template-swiss-card.html      # Swiss 种子(4 accent)
├── scripts/
│   ├── fetch-producthunt.mjs      # 通过 HTTP /mcp 拉 producthunt 榜单数据
│   ├── build-deck.mjs             # data.json + plan.json → 组图 index.html
│   ├── screenshot.mjs             # playwright 截图:index.html 内每个 .poster → PNG
│   └── validate.mjs               # 自动校验(溢出/最小字号/密度/标题上限)
└── README.md
```

## 前置依赖

- **newsnow 服务**正在运行,且已配置 `/mcp` 可用(需 `MCP_INTERNAL_TOKEN`)。
- **playwright**(截图/校验脚本需要):
  ```bash
  pnpm add -D playwright
  pnpm exec playwright install chromium
  ```
  `fetch-producthunt.mjs` / `build-deck.mjs` 用 Node 内置 fetch/fs,零额外依赖。

## MCP / 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `BASE_URL` | newsnow 服务地址 | `http://127.0.0.1:4444` |
| `MCP_INTERNAL_TOKEN` | newsnow `/mcp` 的 Bearer token(必填) | — |
| `MCP_ALLOWED_HOSTS` | 可选,与 newsnow 部署一致 | — |
| `MCP_ALLOWED_ORIGINS` | 可选,与 newsnow 部署一致 | — |

> 在项目根 `.env` 或 shell 中设置。token 属于敏感信息,不要提交。

## 使用

```bash
# 1. 拉取榜单(周榜为例,默认前 5)
export BASE_URL=http://127.0.0.1:4444
export MCP_INTERNAL_TOKEN=your-token
node .claude/skills/producthunt-recommend/scripts/fetch-producthunt.mjs --period weekly --count 5
#  => 输出 dist/weekly/data.json

# 2. agent 撰写页面规划 plan.json(封面/每产品卖点+评价/总结)
#    格式见 reference/page-planning.md 与 build-deck.mjs 头部注释

# 3. 渲染组图 index.html(两套视觉任选,一套到底)
node .claude/skills/producthunt-recommend/scripts/build-deck.mjs \
  --period weekly --data dist/weekly/data.json \
  --plan dist/weekly/plan.json --style swiss --theme ikb
#  => 输出 dist/weekly/index.html(含封面/产品页/总结页)

# 4. playwright 逐张截图成竖版 PNG
node .claude/skills/producthunt-recommend/scripts/screenshot.mjs \
  --html dist/weekly/index.html
#  => 输出 dist/weekly/png/<id>.png  (xhs-cover / xhs-1 / … / xhs-summary)

# 5. (可选)自动校验 —— 用户要求才跑
node .claude/skills/producthunt-recommend/scripts/validate.mjs dist/weekly/index.html
```

## 周期参数

| 入口 | `--period` | MCP source id |
|---|---|---|
| 日榜 | `daily` | `producthunt` |
| 周榜 | `weekly` | `producthunt-weekly` |
| 月榜 | `monthly` | `producthunt-monthly` |

## 风格模式与主题

`build-deck.mjs` 的 `--style` / `--theme`(或写在 `plan.json` 里):

| 风格 | 主题(theme) |
|---|---|
| `teardown`(默认) | `orange`(暖橙,小红书原生产品拆解风) |
| `swiss` | `ikb` / `lemon-yellow` / `lemon-green` / `safety-orange` |
| `editorial` | `ink-classic` / `indigo-porcelain` / `forest-ink` / `kraft-paper` / `dune` / `midnight-ink` |

一套组图只选一个风格、一个主题。

## 产物

- `dist/<period>/data.json` 结构化榜单数据
- `dist/<period>/plan.json` 页面规划(agent 撰写)
- `dist/<period>/index.html` 组图(封面/产品页/总结页)
- `dist/<period>/png/<id>.png` 竖版组图截图

## 触发方式

当前为**手动 / agent 触发**(符合本项目「本地测试实现,无需定时任务」的约定)。

## 设计来源

- **teardown 拆解风**(默认):小红书原生「产品拆解」版式(暖橙主色、圆角卡片、分节内容块),按用户提供的版式样例实现。
- **Swiss / Editorial**:视觉系统(种子模板、主题色板、排版角色、反模式)移植自 [guizang-social-card-skill](https://github.com/op7418/guizang-social-card-skill)(见其仓库 LICENSE),按 producthunt 需要瘦身;原始 skill 本身借鉴 Guizang PPT 风格系统。
- 数据链路(HTTP `/mcp` 拉取 producthunt 榜单)为 newsnow 项目自写。再分发请尊重上游协议。
