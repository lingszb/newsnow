#!/usr/bin/env node
/*
 * validate.mjs —— 校验组图 index.html 里每个 .poster.xhs 是否符合 Product Hunt 卡硬规则。
 *
 *   node scripts/validate.mjs dist/weekly/index.html
 *
 * 移植自 guizang-social-card-skill 的 validate-social-deck.mjs,瘦身为 producthunt 专用:
 * 只保留 3:4 小红书卡相关的规则,去掉 WeChat 封面 / 地图 / Live Photo 相关。
 *
 * 规则:
 *   R1  overflow          scrollHeight > clientHeight(内容溢出卡面)
 *   R4  min readable font 正文/lead/caption/meta 低于手机可读下限
 *   R5  4-band density    xhs 3:4 总填充 <74.5%,或相邻两横带欠填
 *   R6  h-xl hard cap     展示标题超过 xhs 上限(2 行 / 单行 ≤8 字)
 *   R8  visual bounds     顶部/底部视觉溢出、底部大面积空白
 *   R9  title gap         标题触碰下一内容块
 *
 * 退出码 1 仅在有 FAIL 时。WARN 是建议性,读但不阻塞。
 */
import process from "node:process"
import path from "node:path"
import fs from "node:fs"
import { chromium } from "playwright"

const args = process.argv.slice(2)
let target = null
for (const a of args) {
  if (!target && !a.startsWith("--")) target = a
}
if (!target) {
  console.error("usage: node scripts/validate.mjs <index.html>")
  process.exit(2)
}
const abs = path.resolve(target)
if (!fs.existsSync(abs)) {
  console.error(`not found: ${abs}`)
  process.exit(2)
}

const url = `file://${abs.replace(/\\/g, "/")}`
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1700 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: "networkidle" })
await page.waitForTimeout(1000)

const MIN_FONT = { body: 22, lead: 26, caption: 18, meta: 18 }
const HXL_CAP = { maxLines: 2, maxChars: 8 }
const DISPLAY_CLASSES = ["h-xl", "h-hero", "h-statement", "h-display", "num-mega", "num-xl"]

function overflowFix(px) {
  const n = Math.round(px)
  if (n <= 40) return `仅 ${n}px 超出:上移内容或收紧一个间距 20-40px,不要删内容`
  if (n <= 90) return `${n}px 超出:压缩局部间距/行高,避免裁切文案`
  if (n <= 160) return `${n}px 超出:略微缩小展示标题或压缩一段文字,再考虑删内容`
  return `${n}px 超出:换更高容量的页面配方或主动合并/删减内容`
}

const posters = await page.$$("section.poster.xhs")
const report = []

for (const s of posters) {
  const meta = await s.evaluate((el) => {
    return {
      id: el.id || "(no-id)",
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      clientW: el.clientWidth,
    }
  })
  const fails = []
  const warns = []

  // R1 overflow
  const overflow = meta.scrollH - meta.clientH
  if (overflow > 4) {
    fails.push({ rule: "R1", msg: `溢出 ${overflow}px(scrollH ${meta.scrollH} > clientH ${meta.clientH})`, fix: overflowFix(overflow) })
  }

  // R8 visual bounds
  const vis = await s.evaluate((el) => {
    const er = el.getBoundingClientRect()
    const H = el.clientHeight
    const TRANSPARENT = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:0\s*)?\)|transparent/
    const hasDirectText = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim().length > 0) return true
      }
      return false
    }
    const cssColorVisible = c => c && !TRANSPARENT.test(c)
    const meaningful = []
    for (const n of el.querySelectorAll("*")) {
      if (n.closest("script, style")) continue
      const cs = getComputedStyle(n)
      const r = n.getBoundingClientRect()
      if (r.width < 6 || r.height < 6) continue
      if (n === el) continue
      const isText = hasDirectText(n)
      const isMedia = n.tagName === "IMG" || n.tagName === "CANVAS" || n.tagName === "SVG"
      const isRule = n.tagName === "HR" || (r.height <= 4 && (Number.parseFloat(cs.borderTopWidth) >= 1 || Number.parseFloat(cs.borderBottomWidth) >= 1 || cssColorVisible(cs.backgroundColor)))
      const hasBoxFill = cssColorVisible(cs.backgroundColor) && r.width * r.height >= 1600 && !["MAIN", "SECTION"].includes(n.tagName)
      const hasBorderBox = (Number.parseFloat(cs.borderTopWidth) + Number.parseFloat(cs.borderBottomWidth) + Number.parseFloat(cs.borderLeftWidth) + Number.parseFloat(cs.borderRightWidth)) >= 1 && r.width * r.height >= 1600
      if (!isText && !isMedia && !isRule && !hasBoxFill && !hasBorderBox) continue
      meaningful.push({
        top: r.top - er.top,
        bottom: r.bottom - er.top,
        cls: n.className ? `.${String(n.className).split(" ").filter(Boolean).join(".")}` : n.tagName.toLowerCase(),
        text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 32),
      })
    }
    if (!meaningful.length) return null
    let top = Infinity
    let bottom = -Infinity
    let topNode = null
    let bottomNode = null
    for (const it of meaningful) {
      if (it.top < top) {
        top = it.top
        topNode = it
      }
      if (it.bottom > bottom) {
        bottom = it.bottom
        bottomNode = it
      }
    }
    return {
      top: Math.round(top),
      bottom: Math.round(bottom),
      activeRatio: (bottom - top) / H,
      bottomGap: Math.max(0, Math.round(H - bottom)),
      topOverflow: Math.max(0, Math.round(-top)),
      bottomOverflow: Math.max(0, Math.round(bottom - H)),
      topNode,
      bottomNode,
    }
  })
  if (vis) {
    if (vis.bottomOverflow > 4) {
      fails.push({ rule: "R8", msg: `底部视觉溢出 ${vis.bottomOverflow}px(最低块:${vis.bottomNode.cls}${vis.bottomNode.text ? ` "${vis.bottomNode.text}"` : ""})`, fix: overflowFix(vis.bottomOverflow) })
    }
    if (vis.topOverflow > 4) {
      fails.push({ rule: "R8", msg: `顶部视觉溢出 ${vis.topOverflow}px(最高块:${vis.topNode.cls}${vis.topNode.text ? ` "${vis.topNode.text}"` : ""})`, fix: "把内容组下移溢出量 + 16-24px" })
    }
    if (vis.bottomGap > 190 && vis.activeRatio < 0.78) {
      warns.push({ rule: "R8", msg: `底部空白 ${vis.bottomGap}px;有效内容高度 ${Math.round(vis.activeRatio * 100)}%`, fix: "用测得的空白扩展最后一块或下移内容;修完溢出后别过度收紧" })
    }
  }

  // R4 min readable font
  const textChecks = await s.evaluate((el, MIN) => {
    const out = []
    const seen = new Set()
    const test = (selector, role, min, requireLeaf = true) => {
      for (const n of el.querySelectorAll(selector)) {
        if (seen.has(n)) continue
        seen.add(n)
        if (requireLeaf && n.children.length > 0) continue
        const cs = getComputedStyle(n)
        const size = Number.parseFloat(cs.fontSize)
        const text = n.textContent.trim()
        if (!text) continue
        if (size > 0 && size < min) out.push({ role, min, size: Math.round(size), text: text.slice(0, 30) })
      }
    }
    test(".body, p.body", "body", MIN.body)
    test(".lead", "lead", MIN.lead)
    test(".h-sub, .swiss-img-caption, .img-cap", "caption", MIN.caption)
    test(".meta, .label, .mono, .t-meta, .lbl", "meta", MIN.meta)
    return out
  }, MIN_FONT)
  for (const t of textChecks) {
    warns.push({ rule: "R4", msg: `${t.role} "${t.text}" 为 ${t.size}px < ${t.min}px 下限`, fix: "删文案而不是缩字号(手机缩放后不可读)" })
  }

  // R5 4-band density (xhs 3:4)
  const bands = await s.evaluate((el) => {
    const er = el.getBoundingClientRect()
    const H = el.clientHeight
    const rows = new Uint8Array(H)
    const hasDirectText = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim().length > 0) return true
      }
      return false
    }
    for (const n of el.querySelectorAll("*")) {
      const r = n.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue
      const tag = n.tagName
      const cs = getComputedStyle(n)
      const isText = hasDirectText(n)
      const isImg = tag === "IMG" || tag === "CANVAS" || tag === "SVG" || (cs.backgroundImage && cs.backgroundImage !== "none")
      const isRule = tag === "HR" || (Number.parseFloat(cs.borderTopWidth) >= 1 && r.height < 4)
      const hasFill = cs.backgroundColor && !cs.backgroundColor.match(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:0\s*)?\)/) && cs.backgroundColor !== "transparent"
      if (!isText && !isImg && !isRule && !hasFill) continue
      const top = Math.max(0, Math.floor(r.top - er.top))
      const bot = Math.min(H, Math.ceil(r.bottom - er.top))
      for (let y = top; y < bot; y++) rows[y] = 1
    }
    const BAND = H / 4
    const occ = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      let count = 0
      const bTop = Math.floor(i * BAND)
      const bBot = Math.floor((i + 1) * BAND)
      for (let y = bTop; y < bBot; y++) count += rows[y]
      occ[i] = count / (bBot - bTop)
    }
    return { H, BAND, occ }
  })
  const total = bands.occ.reduce((a, b) => a + b, 0) / 4
  const pct = o => `${Math.round(o * 100)}%`
  if (total < 0.745) {
    warns.push({ rule: "R5", msg: `密度 ${pct(total)}(横带 ${bands.occ.map(pct).join(" / ")})`, fix: "扩充文案或换配方 — 3:4 卡必须吃满画布 ≥75%" })
  }
  for (let i = 0; i < 3; i++) {
    if (bands.occ[i] < 0.15 && bands.occ[i + 1] < 0.15) {
      warns.push({ rule: "R5", msg: `横带 ${i + 1}+${i + 2} 都欠填(${pct(bands.occ[i])} / ${pct(bands.occ[i + 1])}) — 中段 >25% 空洞`, fix: "扩充正文或插入一栏边注" })
      break
    }
  }

  // R6 h-xl hard cap
  const titles = await s.evaluate((el, cls) => {
    const out = []
    for (const c of cls) {
      for (const n of el.querySelectorAll(`.${c}`)) {
        const cs = getComputedStyle(n)
        const size = Number.parseFloat(cs.fontSize)
        const lineH = Number.parseFloat(cs.lineHeight) || size * 1.2
        const lines = Math.round(n.getBoundingClientRect().height / lineH)
        out.push({ cls: c, text: n.textContent.trim(), lines, size: Math.round(size) })
      }
    }
    return out
  }, DISPLAY_CLASSES)
  for (const t of titles) {
    const longestLine = Math.max(...t.text.split(/\s+/).map(w => w.length), t.text.length)
    if (t.lines > HXL_CAP.maxLines) {
      warns.push({ rule: "R6", msg: `.${t.cls} "${t.text}" 渲染 ${t.lines} 行(上限 ${HXL_CAP.maxLines} 行)`, fix: "压缩标题文案或改用封面式配方" })
    } else if (longestLine > HXL_CAP.maxChars + 2) {
      warns.push({ rule: "R6", msg: `.${t.cls} "${t.text}" 单行最长 ${longestLine} 字(建议 ≤${HXL_CAP.maxChars})`, fix: "压缩标题文案" })
    }
  }

  // R9 title gap
  const titleGaps = await s.evaluate((el) => {
    const TRANSPARENT = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:0\s*)?\)|transparent/
    const hasDirectText = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim().length > 0) return true
      }
      return false
    }
    const colorVisible = c => c && !TRANSPARENT.test(c)
    const isMeaningful = (n) => {
      const tag = n.tagName
      const cs = getComputedStyle(n)
      const r = n.getBoundingClientRect()
      if (r.width < 6 || r.height < 6) return false
      if (n === el) return false
      if (hasDirectText(n)) return true
      if (tag === "IMG" || tag === "CANVAS" || tag === "SVG" || tag === "HR") return true
      if (colorVisible(cs.backgroundColor) && r.width * r.height >= 1600 && !["MAIN", "SECTION"].includes(tag)) return true
      const border = Number.parseFloat(cs.borderTopWidth) + Number.parseFloat(cs.borderBottomWidth) + Number.parseFloat(cs.borderLeftWidth) + Number.parseFloat(cs.borderRightWidth)
      return border >= 1 && r.width * r.height >= 1600
    }
    const label = (n) => {
      const cls = n.className ? `.${String(n.className).split(" ").filter(Boolean).join(".")}` : n.tagName.toLowerCase()
      const text = n.textContent.trim().replace(/\s+/g, " ").slice(0, 30)
      return text ? `${cls} "${text}"` : cls
    }
    const nodes = Array.from(el.querySelectorAll("*")).filter(isMeaningful)
    const titles = Array.from(el.querySelectorAll(".h-xl, .h-hero, .h-statement, .h-display, .h-md"))
    const out = []
    for (const title of titles) {
      if (!title.textContent.trim()) continue
      const tr = title.getBoundingClientRect()
      const isLocal = title.matches(".h-md")
      const minGap = isLocal ? 16 : 28
      let nearest = null
      let nearestGap = Infinity
      for (const node of nodes) {
        if (node === title || title.contains(node) || node.contains(title)) continue
        const nr = node.getBoundingClientRect()
        const gap = nr.top - tr.bottom
        if (gap < -2) continue
        const overlap = Math.max(0, Math.min(tr.right, nr.right) - Math.max(tr.left, nr.left))
        const overlapRatio = overlap / Math.min(tr.width, nr.width)
        if (overlapRatio < 0.12 && gap < 96) continue
        if (gap < nearestGap) {
          nearestGap = gap
          nearest = node
        }
      }
      if (nearest && nearestGap < minGap) {
        out.push({ title: label(title), next: label(nearest), gap: Math.round(nearestGap), minGap })
      }
    }
    return out
  })
  for (const g of titleGaps) {
    warns.push({ rule: "R9", msg: `${g.title} 与 ${g.next} 间距仅 ${g.gap}px(最小 ${g.minGap}px)`, fix: "在标题下补足间距,再考虑删文案" })
  }

  report.push({ meta, fails, warns })
}

await browser.close()

let totalFail = 0
let totalWarn = 0
const ruleCounts = new Map()
for (const { fails, warns } of report) {
  totalFail += fails.length
  totalWarn += warns.length
  for (const v of [...fails, ...warns]) ruleCounts.set(v.rule, (ruleCounts.get(v.rule) || 0) + 1)
}
const cleanCount = report.filter(r => r.fails.length === 0 && r.warns.length === 0).length

const lines = []
lines.push("==== validate ====")
lines.push(`target:   ${path.relative(process.cwd(), abs)}`)
lines.push(`posters:  ${report.length}  ·  ${cleanCount} clean  ·  ${totalFail} fails  ·  ${totalWarn} warns`)
if (ruleCounts.size) {
  lines.push(`rules:    ${[...ruleCounts.entries()].sort().map(([r, c]) => `${r}=${c}`).join("  ")}`)
}
lines.push("")

const fixCache = new Map()
for (const { meta, fails, warns } of report) {
  if (fails.length === 0 && warns.length === 0) {
    lines.push(`[PASS]  ${meta.id}`)
    continue
  }
  const tag = fails.length ? "[FAIL]" : "[WARN]"
  lines.push(`${tag}  ${meta.id} · ${meta.clientW}×${meta.clientH}`)
  for (const v of [...fails, ...warns]) {
    const sev = fails.includes(v) ? "FAIL" : "WARN"
    lines.push(`  ${sev} · ${v.rule}  ${v.msg}`)
    if (!fixCache.has(v.rule)) {
      lines.push(`         fix: ${v.fix}`)
      fixCache.set(v.rule, true)
    }
  }
}

lines.push("")
lines.push("Legend: R1 overflow · R4 min font · R5 4-band density · R6 h-xl cap · R8 visual bounds · R9 title gap")
lines.push("Exit code 1 only on FAIL. Warnings are advisory.")
console.log(lines.join("\n"))
process.exit(totalFail > 0 ? 1 : 0)
