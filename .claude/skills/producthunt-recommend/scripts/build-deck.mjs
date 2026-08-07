#!/usr/bin/env node
/**
 * build-deck.mjs —— 把 Product Hunt 榜单数据 + agent 的 plan.json 渲染成一张多页组图 index.html。
 *
 * 用法:
 *   node scripts/build-deck.mjs --period weekly \
 *     --data dist/weekly/data.json \
 *     --plan dist/weekly/plan.json \
 *     --style swiss --theme ikb \
 *     [--out dist/weekly/index.html]
 *
 * 说明:
 *   - --data   fetch-producthunt.mjs 输出的 data.json(items 数组)
 *   - --plan   agent 撰写的页面规划(封面/每产品一句话卖点+评价/总结)。结构见下。
 *   - --style  editorial | swiss    (也可在 plan.style 指定)
 *   - --theme  对应主题名(也可在 plan.theme 指定)
 *
 * plan.json 结构:
 * {
 *   "style": "swiss",                 // 可选,默认取 --style
 *   "theme": "ikb",                   // 可选,默认取 --theme
 *   "cover":   { "title": "…", "hook": "一句话钩子", "countBadge": "05" },
 *   "products":[
 *     { "rank": 1, "one-liner": "一句话卖点", "review": "2~3 句 AI 评价" },
 *     { "rank": 2, "one-liner": "…",         "review": "…" }
 *   ],
 *   "summary": { "title": "一句话收尾", "note": "…" }
 * }
 *
 * 产品页真实数据(标题/简介/票数/评论/缩略图/链接)一律来自 data.json 按 rank 合并,
 * 只填充真实值,绝不编造。agent 的角色是讲故事(封面钩子、卖点、评价),不是造数据。
 */
import process from "node:process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(__dirname, "../assets")

const PERIOD_ZH = { daily: "日榜", weekly: "周榜", monthly: "月榜" }
const THEMES = {
  teardown: ["orange"],
  swiss: ["ikb", "lemon-yellow", "lemon-green", "safety-orange"],
  editorial: ["ink-classic", "indigo-porcelain", "forest-ink", "kraft-paper", "dune", "midnight-ink"],
}

function parseArgs(argv) {
  const args = { period: "weekly", data: null, plan: null, style: null, theme: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--period") args.period = argv[++i]
    else if (v === "--data") args.data = argv[++i]
    else if (v === "--plan") args.plan = argv[++i]
    else if (v === "--style") args.style = argv[++i]
    else if (v === "--theme") args.theme = argv[++i]
    else if (v === "--out") args.out = argv[++i]
  }
  return args
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** 标题里的换行符转成 <br> */
function titleHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br>")
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US")
}

function periodKey(payload) {
  return payload?.productHunt?.periodKey ?? ""
}

function sourceLabel(payload) {
  return payload?.sourceName ?? "Product Hunt"
}

function leaderboardUrl(payload) {
  return payload?.productHunt?.leaderboardUrl ?? ""
}

/** 显示用链接:去掉协议与查询参数,只留 host + path */
function displayUrl(url) {
  try {
    const u = new URL(url)
    return (u.hostname + u.pathname).replace(/\/$/, "")
  } catch {
    return url
  }
}

/* ---------- Swiss 渲染 ---------- */

function swissCover(plan, meta) {
  const c = plan.cover ?? {}
  const toc = meta.products.map(p => `
        <div class="ph-row">
          <span class="row-nb">${String(p.rank).padStart(2, "0")}</span>
          <span class="row-title">${escapeHtml(p.title)}<span class="sub">${escapeHtml(p.oneLiner)}</span></span>
        </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-cover">
      <div class="content stack gap-7">
        <div class="chrome-min">
          <span>Product Hunt · ${meta.periodZh}</span>
          <span>${escapeHtml(meta.periodKey)}</span>
        </div>
        <div class="stack gap-7">
          <p class="t-cat">封面 · Cover</p>
          <h1 class="h-statement">${titleHtml(c.title ?? "本周好产品")}</h1>
          <p class="lead">${escapeHtml(c.hook ?? "")}</p>
        </div>
        <div class="stack gap-4">
          <p class="t-meta">本期看点 · Contents</p>
          <div>${toc}</div>
        </div>
        <div class="grow"></div>
        <div class="row gap-6">
          <p class="t-meta">Issue ${escapeHtml(c.countBadge ?? String(meta.count).padStart(2, "0"))}</p>
          <p class="t-meta">/ ${escapeHtml(meta.source)} ${meta.periodZh}</p>
        </div>
      </div>
    </section>`
}

function swissProduct(p, item, meta) {
  const thumb = item?.productHunt?.thumbnailUrl ?? ""
  const logoHtml = thumb
    ? `<div class="ph-logo"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'"></div>`
    : ""
  return `
    <section class="poster xhs" id="xhs-${p.rank}">
      <div class="content stack gap-5">
        <div class="chrome-min">
          <span>Product Hunt · ${meta.periodZh}</span>
          <span>#${p.rank}</span>
        </div>
        <div class="ph-head${thumb ? "" : " no-logo"}">
          ${logoHtml}
          <div class="stack gap-4">
            <p class="t-cat">#${p.rank} · Product</p>
            <h1 class="h-xl">${escapeHtml(item.title)}</h1>
            <p class="lead">${escapeHtml(p.oneLiner || item.summary || item.tagline || "")}</p>
          </div>
        </div>
        <div class="card-fill stack gap-5">
          <p class="body">${escapeHtml(p.review ?? "")}</p>
        </div>
        <div class="ph-stat">
          <span class="num">${fmtNum(item.productHunt?.votesCount)}</span><span class="lbl">票</span>
          <span class="num">${fmtNum(item.productHunt?.commentsCount)}</span><span class="lbl">评论</span>
        </div>
        <a class="ph-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="ph-link-row"><span>查看产品</span><span class="arrow">→</span></span>
          <span class="ph-url">${escapeHtml(displayUrl(item.url))}</span>
        </a>
      </div>
    </section>`
}

function swissSummary(plan, meta) {
  const s = plan.summary ?? {}
  const board = meta.products.map(p => `
        <div class="ph-row">
          <span class="row-nb">${String(p.rank).padStart(2, "0")}</span>
          <span class="row-title">${escapeHtml(p.title)}</span>
          <span class="row-val">${fmtNum(p.votes)} 票 · ${fmtNum(p.comments)} 评</span>
        </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-summary">
      <div class="content stack gap-7">
        <div class="chrome-min">
          <span>Product Hunt · ${meta.periodZh}</span>
          <span>${escapeHtml(meta.periodKey)}</span>
        </div>
        <div class="stack gap-7">
          <p class="t-cat">总结 · Summary</p>
          <h1 class="h-statement">${titleHtml(s.title ?? "一句话收尾")}</h1>
          <p class="lead">${escapeHtml(s.note ?? "")}</p>
        </div>
        <div class="stack gap-4">
          <p class="t-meta">本期票数榜 · By Votes</p>
          <div>${board}</div>
        </div>
        <div class="grow"></div>
        <a class="ph-link" href="${escapeHtml(meta.leaderboard)}" target="_blank" rel="noopener noreferrer">
          <span class="ph-link-row"><span>查看完整榜单</span><span class="arrow">→</span></span>
          <span class="ph-url">${escapeHtml(displayUrl(meta.leaderboard))}</span>
        </a>
      </div>
    </section>`
}

/* ---------- Editorial 渲染 ---------- */

function editorialCover(plan, meta) {
  const c = plan.cover ?? {}
  const toc = meta.products.map(p => `
          <div class="ledger-row">
            <span class="ledger-nb">${String(p.rank).padStart(2, "0")}</span>
            <span class="ledger-title">${escapeHtml(p.title)}</span>
          </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-cover">
      <div class="grain"></div>
      <div class="paper-wash"></div>
      <div class="content stack gap-3">
        <div class="issue-row">
          <span>Product Hunt</span><span class="dot"></span><span>${meta.periodZh}</span>
        </div>
        <div class="stack gap-2">
          <p class="kicker">封面 · Cover</p>
          <h1 class="h-xl">${titleHtml(c.title ?? "本周好产品")}</h1>
          <p class="h-sub">${escapeHtml(c.hook ?? "")}</p>
        </div>
        <div class="stack gap-1">
          <p class="label">本期看点 · Contents</p>
          <div class="ledger">${toc}</div>
        </div>
        <div class="grow"></div>
        <div class="rule-accent"></div>
        <p class="meta">${meta.count} 个产品 · Issue ${escapeHtml(c.countBadge ?? String(meta.count).padStart(2, "0"))}</p>
      </div>
      <div class="issue-strip">
        <span>Product Hunt</span><span>—</span><span>${meta.periodZh}</span>
      </div>
    </section>`
}

function editorialProduct(p, item) {
  const thumb = item?.productHunt?.thumbnailUrl ?? ""
  const logoHtml = thumb
    ? `<div class="ph-logo"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'"></div>`
    : ""
  return `
    <section class="poster xhs" id="xhs-${p.rank}">
      <div class="grain"></div>
      <div class="paper-wash"></div>
      <div class="content stack gap-2">
        <div class="issue-row">
          <span>Product Hunt</span><span class="dot"></span><span>#${p.rank}</span>
        </div>
        <div class="ph-head${thumb ? "" : " no-logo"}">
          ${logoHtml}
          <div class="stack gap-1">
            <p class="kicker">#${p.rank} · Product</p>
            <h1 class="h-xl">${escapeHtml(item.title)}</h1>
            <p class="h-sub">${escapeHtml(p.oneLiner || item.summary || item.tagline || "")}</p>
          </div>
        </div>
        <p class="body">${escapeHtml(p.review ?? "")}</p>
        <div class="ph-stat">
          <span class="num">${fmtNum(item.productHunt?.votesCount)}</span><span class="lbl">票</span>
          <span class="num">${fmtNum(item.productHunt?.commentsCount)}</span><span class="lbl">评论</span>
        </div>
        <a class="ph-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="ph-link-row"><span>查看产品</span><span class="arrow">→</span></span>
          <span class="ph-url">${escapeHtml(displayUrl(item.url))}</span>
        </a>
      </div>
      <div class="issue-strip">
        <span>Product Hunt</span><span>—</span><span>#${p.rank}</span>
      </div>
    </section>`
}

function editorialSummary(plan, meta) {
  const s = plan.summary ?? {}
  const board = meta.products.map(p => `
          <div class="ledger-row">
            <span class="ledger-nb">${String(p.rank).padStart(2, "0")}</span>
            <span class="ledger-title">${escapeHtml(p.title)}</span>
            <span class="ledger-note">${fmtNum(p.votes)} 票 · ${fmtNum(p.comments)} 评</span>
          </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-summary">
      <div class="grain"></div>
      <div class="paper-wash"></div>
      <div class="content stack gap-2">
        <div class="issue-row">
          <span>Product Hunt</span><span class="dot"></span><span>${meta.periodZh}</span>
        </div>
        <div class="stack gap-2">
          <p class="kicker">总结 · Summary</p>
          <h1 class="h-display">${titleHtml(s.title ?? "一句话收尾")}</h1>
          <p class="lead">${escapeHtml(s.note ?? "")}</p>
        </div>
        <div class="stack gap-1">
          <p class="label">本期票数榜 · By Votes</p>
          <div class="ledger">${board}</div>
        </div>
        <div class="grow"></div>
        <a class="ph-link" href="${escapeHtml(meta.leaderboard)}" target="_blank" rel="noopener noreferrer">
          <span class="ph-link-row"><span>查看完整榜单</span><span class="arrow">→</span></span>
          <span class="ph-url">${escapeHtml(displayUrl(meta.leaderboard))}</span>
        </a>
      </div>
      <div class="issue-strip">
        <span>Product Hunt</span><span>—</span><span>${meta.periodZh}</span>
      </div>
    </section>`
}

/* ---------- Teardown 拆解风渲染 ---------- */

function tdTop(meta, right) {
  return `
        <div class="td-top">
          <div class="left">
            <div class="td-brand-logo">
              <svg viewBox="0 0 64 64" width="64" height="64" aria-label="Product Hunt">
                <circle cx="32" cy="32" r="32" fill="#FF6154"/>
                <path fill="#fff" d="M25 47 V17 h10.6 c6.4 0 10.9 4.4 10.9 10.5 c0 6.1 -4.5 10.5 -10.9 10.5 H31 v9 Z"/>
                <path fill="#FF6154" d="M31 22.6 v10 h4.2 c3.3 0 5.5 -2 5.5 -5 c0 -3 -2.2 -5 -5.5 -5 Z"/>
              </svg>
            </div>
            <div>
              <p class="td-brand-name">Product Hunt 产品拆解</p>
              <p class="td-brand-meta">${escapeHtml(meta.periodKey)} · PM 视角</p>
            </div>
          </div>
          <span class="td-rank">${right}</span>
        </div>`
}

function tdCover(plan, meta) {
  const c = plan.cover ?? {}
  const toc = meta.products.map(p => `
          <div class="td-row">
            <span class="nb">${String(p.rank).padStart(2, "0")}</span>
            <span class="t">${escapeHtml(p.title)}<span class="sub">${escapeHtml(p.oneLiner)}</span></span>
            <span class="v">${fmtNum(p.votes)} 票</span>
          </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-cover">
      <div class="content">
        ${tdTop(meta, `共 ${meta.count} 个`)}
        <div>
          <h1 class="td-title">${titleHtml(c.title ?? "本周好产品")}</h1>
          <p class="td-hook">${escapeHtml(c.hook ?? "")}</p>
        </div>
        <div>
          <p class="td-sec">本期看点</p>
          <div class="td-rows">${toc}</div>
        </div>
        <div class="td-foot">
          <span>数据来源 <a href="${escapeHtml(meta.leaderboard)}">Product Hunt</a></span>
          <span class="sep">·</span><span>${escapeHtml(meta.periodZh)}</span>
        </div>
      </div>
    </section>`
}

function tdProduct(p, item, meta) {
  const ph = item.productHunt ?? {}
  const logo = ph.thumbnailUrl
    ? `<div class="td-logo"><img src="${escapeHtml(ph.thumbnailUrl)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'"></div>`
    : ""
  const who = p.who ?? ""
  const when = p.when ?? ""
  const cardsHtml = (who || when)
    ? `
        <div>
          <p class="td-sec">哪些人需要它</p>
          <div class="td-cards">
            <div class="td-card"><p class="lbl">适合谁用</p><p class="txt">${escapeHtml(who)}</p></div>
            <div class="td-card"><p class="lbl">啥时候用得上</p><p class="txt">${escapeHtml(when)}</p></div>
          </div>
        </div>`
    : ""
  const vs = Array.isArray(p.competition) && p.competition.length
    ? `
        <div>
          <p class="td-sec">跟竞品比好在哪</p>
          <div class="td-vs">${p.competition.map(b => `<div class="td-li"><p>${escapeHtml(b)}</p></div>`).join("")}</div>
        </div>`
    : ""
  const published = ph.publishedAt ? new Date(ph.publishedAt).toISOString().slice(0, 10) : ""
  return `
    <section class="poster xhs" id="xhs-${p.rank}">
      <div class="content">
        ${tdTop(meta, `No.${p.rank}`)}
        <div class="td-head">
          ${logo}
          <div>
            <h1 class="td-name">${escapeHtml(item.title)}</h1>
            <p class="td-tag">${escapeHtml(p.oneLiner || item.summary || "")}</p>
          </div>
        </div>
        <p class="td-intro">${escapeHtml(p.intro ?? item.summary ?? "")}</p>
        ${cardsHtml}
        ${vs}
        <div class="td-sum">
          <p class="head">💡 简单总结</p>
          <p class="txt">${escapeHtml(p.review ?? "")}</p>
        </div>
        <div class="td-foot">
          <span>数据来源 <a href="${escapeHtml(item.url)}">Product Hunt</a></span>
          <span class="sep">·</span><span>${fmtNum(ph.votesCount)} 票</span>
          <span class="sep">·</span><span>${fmtNum(ph.commentsCount)} 评论</span>
          ${published ? `<span class="sep">·</span><span>${published} 发布</span>` : ""}
          <span class="sep">·</span><span>本期第 ${p.rank} 名</span>
        </div>
      </div>
    </section>`
}

function tdSummary(plan, meta) {
  const s = plan.summary ?? {}
  const board = meta.products.map(p => `
          <div class="td-row">
            <span class="nb">${String(p.rank).padStart(2, "0")}</span>
            <span class="t">${escapeHtml(p.title)}</span>
            <span class="v">${fmtNum(p.votes)} 票 · ${fmtNum(p.comments)} 评</span>
          </div>`).join("")
  return `
    <section class="poster xhs" id="xhs-summary">
      <div class="content">
        ${tdTop(meta, "完")}
        <div>
          <h1 class="td-title">${titleHtml(s.title ?? "一句话收尾")}</h1>
          <p class="td-hook">${escapeHtml(s.note ?? "")}</p>
        </div>
        <div>
          <p class="td-sec">本期票数榜</p>
          <div class="td-rows">${board}</div>
        </div>
        <div class="td-sum">
          <p class="head">💡 简单总结</p>
          <p class="txt">${escapeHtml(s.review ?? s.note ?? "")}</p>
        </div>
        <div class="td-foot">
          <span>数据来源 <a href="${escapeHtml(meta.leaderboard)}">Product Hunt</a></span>
          <span class="sep">·</span><span>${escapeHtml(meta.periodZh)} · ${escapeHtml(meta.periodKey)}</span>
        </div>
      </div>
    </section>`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataPath = args.data || `dist/${args.period}/data.json`
  const planPath = args.plan || `dist/${args.period}/plan.json`

  const payload = JSON.parse(await readFile(dataPath, "utf8"))
  const plan = JSON.parse(await readFile(planPath, "utf8"))

  const style = (args.style || plan.style || "teardown").toLowerCase()
  if (!["teardown", "swiss", "editorial"].includes(style)) throw new Error(`Unknown style "${style}"; expected teardown|swiss|editorial`)
  const theme = args.theme || plan.theme || (style === "swiss" ? "ikb" : style === "editorial" ? "indigo-porcelain" : "orange")
  if (!THEMES[style].includes(theme)) {
    throw new Error(`Unknown theme "${theme}" for ${style}; expected ${THEMES[style].join(" | ")}`)
  }

  // 按 rank 合并 plan.products 与 data.items
  const itemsByRank = new Map((payload.items ?? []).map(i => [Number(i.rank), i]))
  const products = (plan.products ?? []).map(p => ({ p, item: itemsByRank.get(Number(p.rank)) }))
  const missing = products.filter(({ item }) => !item)
  if (missing.length) {
    console.warn(`[build] 警告: plan 中这些 rank 在 data.json 里没有对应产品,已跳过: ${missing.map(({ p }) => p.rank).join(", ")}`)
  }
  const valid = products.filter(({ item }) => item)

  const meta = {
    periodZh: PERIOD_ZH[args.period] || args.period,
    periodKey: periodKey(payload),
    source: sourceLabel(payload),
    leaderboard: leaderboardUrl(payload),
    count: valid.length,
    products: valid.map(({ p, item }) => ({
      rank: Number(p.rank),
      title: item.title ?? "",
      oneLiner: p.oneLiner || item.summary || item.tagline || "",
      votes: item.productHunt?.votesCount ?? 0,
      comments: item.productHunt?.commentsCount ?? 0,
    })),
  }

  const renderers = {
    teardown: { cover: tdCover, product: tdProduct, summary: tdSummary },
    swiss: { cover: swissCover, product: swissProduct, summary: swissSummary },
    editorial: { cover: editorialCover, product: editorialProduct, summary: editorialSummary },
  }[style]

  const parts = [renderers.cover(plan, meta, payload)]
  for (const { p, item } of valid) parts.push(renderers.product(p, item, meta, payload))
  parts.push(renderers.summary(plan, meta, payload))
  const postersHtml = parts.join("\n\n")

  // 读种子,设置主题(teardown 只有一套橙,无需替换)
  const seedPath = style === "swiss"
    ? join(ASSETS, "template-swiss-card.html")
    : style === "editorial"
      ? join(ASSETS, "template-editorial-card.html")
      : join(ASSETS, "template-teardown-card.html")
  let html = await readFile(seedPath, "utf8")

  if (style === "swiss") {
    html = html.replace(/(<html[^>]*data-accent=")[^"]*(")/, `$1${theme}$2`)
  } else if (style === "editorial") {
    html = html.replace(/(<html[^>]*data-theme=")[^"]*(")/, `$1${theme}$2`)
  }

  const marker = "<!-- @POSTERS@ -->"
  if (!html.includes(marker)) throw new Error("Seed template missing <!-- @POSTERS@ --> marker")
  html = html.replace(marker, postersHtml)

  const outPath = args.out || `dist/${args.period}/index.html`
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, html, "utf8")

  console.log(`[build] style=${style} theme=${theme} period=${args.period}`)
  console.log(`[build] posters: 1 cover + ${valid.length} products + 1 summary = ${valid.length + 2}`)
  console.log(`[build] saved -> ${outPath}`)
}

main().catch((err) => {
  console.error(`[build] ${err.message}`)
  process.exit(1)
})
