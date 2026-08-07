---
name: producthunt-recommend
description: 生成 Product Hunt 每日/每周/每月产品推荐的「小红书组图」竖版图文卡片(封面 + 每产品一页 + 总结页,3:4)。当用户提到「producthunt 推荐」「本周/本月/今日好产品」「生成图文推荐」「做成图片」「小红书式图文」「出组图」「产品拆解」时使用。通过 newsnow 的 HTTP /mcp 拉取 producthunt 榜单数据,默认渲染「产品拆解」风(暖橙圆角卡片、分节内容块,小红书原生拆解版式),另可选 Swiss 瑞士 / Editorial 杂志两套视觉。产品的 AI 评价由 agent 自行撰写,数据一律来自真实榜单。
---

# Product Hunt 图文推荐

把三套数据源(日榜 `producthunt`、周榜 `producthunt-weekly`、月榜 `producthunt-monthly`)变成一组**小红书组图**:封面页 + 每产品一页 + 总结页,全部 3:4 竖版,逐张截图成 PNG。

三套视觉,一套组图只用一套:

| 风格 | 默认 | 气质 |
|---|---|---|
| `teardown`(默认) | 暖橙 | 小红书原生「产品拆解」:圆角卡片、分节块(哪些人需要它/跟竞品比好在哪/简单总结),信息密度高、页面吃满 |
| `swiss` | IKB 蓝 | 工程冷感:无圆角/阴影/渐变,越大越细 |
| `editorial` | Indigo Porcelain | 杂志专栏感:衬线 + 纸墨 + 氛围层 |

**表达优先**:每个产品页讲清「为什么值得看」,不是把文字塞进海报。

## 触发与周期

- 用户说「本周/周榜」→ 周榜,`period = weekly`
- 用户说「本月/月榜」→ 月榜,`period = monthly`
- 用户说「今日/日榜」→ 日榜,`period = daily`
- 未指定时默认周榜;未指定数量默认取前 5。

## 工作流

1. **Intake**:确认周期、数量(默认 5)、风格模式(默认 teardown)。见 `reference/图文规范.md`。
2. **拉数据**:`node scripts/fetch-producthunt.mjs --period weekly --count 5` → `dist/weekly/data.json`。
3. **规划页面 + 写 plan.json**:封面钩子;每个产品的 `oneLiner`(一句话卖点)、`intro`(引入)、`who`/`when`(适合谁用/啥时候用得上)、`competition`(竞品对比 3 条)、`review`(AI 总结 2~3 句);总结。见 `reference/page-planning.md`。**评价由 agent 撰写,不得编造票数/评论/排名数字。**
4. **渲染组图**:`node scripts/build-deck.mjs --period weekly --data … --plan dist/weekly/plan.json`(默认 teardown;或 `--style swiss --theme ikb` / `--style editorial --theme indigo-porcelain`)→ `dist/weekly/index.html`。
5. **截图**:`node scripts/screenshot.mjs --html dist/weekly/index.html` → `dist/weekly/png/<id>.png`。
6. **交付**:先把组图给用户看,问一句:**「先你自己看,还是我先自动核查一遍?」** 用户要求才跑 `node scripts/validate.mjs dist/weekly/index.html`,修 FAIL 后重渲。**不要自动跑校验。**

## 视觉 / 内容硬规则(详见 reference/图文规范.md)

- 一套组图**只用一个风格模式**,不混搭。
- teardown:页面吃满、分节块完整;页眉固定 Product Hunt 珊瑚圆 P 标 + 「产品拆解」品牌行;底栏固定「数据来源 + 票数 + 评论 + 发布日 + 排名」。
- swiss/editorial:展示标题 ≤2 行、单行 ≤8 字;正文 ≥28px;Swiss 无圆角/阴影/渐变;Editorial 有氛围层不用卡片背景。
- 票数/评论/排名一律来自真实榜单,不编造。

## 产物

- `dist/<period>/data.json` 结构化榜单数据
- `dist/<period>/plan.json` 页面规划(agent 撰写)
- `dist/<period>/index.html` 组图(含封面/产品页/总结页)
- `dist/<period>/png/<id>.png` 竖版组图截图(`xhs-cover` / `xhs-<rank>` / `xhs-summary`)

## 环境变量 / MCP 配置

- `BASE_URL` 默认 `http://127.0.0.1:4444`(newsnow 服务地址)
- `MCP_INTERNAL_TOKEN` 必填(newsnow 的 `/mcp` Bearer token)
- 可选 `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`(与 newsnow 部署一致)

详见 `README.md`。
