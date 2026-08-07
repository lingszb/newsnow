#!/usr/bin/env node
/**
 * screenshot.mjs —— 用 playwright 无头浏览器把组图 index.html 里的每个 .poster 截成竖版 PNG。
 *
 * 用法:
 *   node scripts/screenshot.mjs --html dist/weekly/index.html [--out dist/weekly/png]
 *
 * 依赖:需要 playwright 及 chromium。安装:
 *   pnpm add -D playwright && pnpm exec playwright install chromium
 *
 * 说明:打开 build-deck.mjs 生成的 index.html,按每个 <section class="poster xhs" id="…">
 * 的 id 逐个截图,输出 <out>/<id>.png。使用 file:// 打开(种子与产物均自包含,
 * 字体/图标走公网 CDN,需联网)。
 */
import process from "node:process"
import { mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { chromium } from "playwright"

function parseArgs(argv) {
  const args = { html: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--html") args.html = argv[++i]
    else if (v === "--out") args.out = argv[++i]
  }
  return args
}

async function main() {
  const { html, out } = parseArgs(process.argv.slice(2))
  if (!html) throw new Error("usage: node scripts/screenshot.mjs --html dist/<period>/index.html [--out <dir>]")

  const htmlAbs = resolve(html)
  const url = `file://${htmlAbs.replace(/\\/g, "/")}`
  const pngDir = out || join(dirname(htmlAbs), "png")
  await mkdir(pngDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  })

  let done = 0
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: "load" })
    // 等外链字体/缩略图/图标加载完成
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(600)

    const posters = await page.$$("section.poster.xhs")
    if (!posters.length) throw new Error(`No .poster.xhs sections in ${htmlAbs}`)

    for (const poster of posters) {
      const id = await poster.getAttribute("id")
      const name = id || `poster-${done + 1}`
      const outPath = join(pngDir, `${name}.png`)
      await poster.screenshot({ path: outPath })
      done += 1
      console.log(`[shot] ${name} -> ${outPath}`)
    }
    await page.close()
  } finally {
    await browser.close()
  }
  console.log(`[shot] captured ${done} posters to ${pngDir}`)
  console.log(`[shot] deck: ${basename(htmlAbs)}`)
}

main().catch((err) => {
  console.error(`[shot] ${err.message}`)
  process.exit(1)
})
