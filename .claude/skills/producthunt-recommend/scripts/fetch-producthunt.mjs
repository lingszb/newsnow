#!/usr/bin/env node
/**
 * fetch-producthunt.mjs —— 通过 newsnow 的 HTTP /mcp 拉取 Product Hunt 榜单数据。
 *
 * 用法:
 *   node scripts/fetch-producthunt.mjs --period weekly [--count 5] [--out dist/weekly/data.json]
 *
 * 环境变量:
 *   BASE_URL             newsnow 服务地址,默认 http://127.0.0.1:4444
 *   MCP_INTERNAL_TOKEN   必填,newsnow /mcp 的 Bearer token
 *   MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS  可选,与 newsnow 部署一致
 *
 * 说明:直接以 JSON-RPC 2.0 调用 newsnow 的 Streamable HTTP /mcp 端点,
 * 不依赖 @modelcontextprotocol/sdk,保证 skill 与 newsnow 项目解耦。
 * 流程:initialize → notifications/initialized → tools/call(get_hottest_latest_news)。
 */
import process from "node:process"
import { mkdir, writeFile } from "node:fs/promises"

const PERIODS = {
  daily: "producthunt",
  weekly: "producthunt-weekly",
  monthly: "producthunt-monthly",
}

function parseArgs(argv) {
  const args = { period: "weekly", count: 5 }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--period") args.period = argv[++i]
    else if (v === "--count") args.count = Number(argv[++i])
    else if (v === "--out") args.out = argv[++i]
  }
  return args
}

function baseUrl() {
  return (process.env.BASE_URL || "http://127.0.0.1:4444").replace(/\/$/, "")
}

function authHeaders() {
  const token = process.env.MCP_INTERNAL_TOKEN?.trim()
  if (!token) throw new Error("MCP_INTERNAL_TOKEN is required")
  return { Authorization: `Bearer ${token}` }
}

let rpcId = 0
async function rpc(endpoint, method, params) {
  const res = await fetch(`${baseUrl()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`MCP request failed with HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const payload = await res.json()
  if (payload.error) throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`)
  return payload
}

async function main() {
  const { period, count, out } = parseArgs(process.argv.slice(2))
  const sourceId = PERIODS[period]
  if (!sourceId) throw new Error(`Unknown period "${period}"; expected daily|weekly|monthly`)

  // 1. initialize(建立 MCP 会话,获取协议信息)
  await rpc("/mcp", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "producthunt-recommend", version: "1.0.0" },
  })

  // 2. 通知 initialized
  await rpc("/mcp", "notifications/initialized", {})

  // 3. 调用工具
  const result = await rpc("/mcp", "tools/call", {
    name: "get_hottest_latest_news",
    arguments: { id: sourceId, count },
  })

  const content = result.result?.content ?? []
  const text = content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("\n")
  const structured = result.result?.structuredContent
  if (!structured) throw new Error("MCP tool did not return structuredContent")

  // 4. 输出
  const outputDir = out
    ? out.substring(0, out.lastIndexOf("/") || out.lastIndexOf("\\"))
    : `dist/${period}`
  await mkdir(outputDir, { recursive: true })
  const outPath = out || `dist/${period}/data.json`
  await writeFile(outPath, JSON.stringify(structured, null, 2), "utf8")

  console.log(`[fetch] period=${period} source=${sourceId} count=${count}`)
  console.log(`[fetch] sourceName=${structured.sourceName} items=${(structured.items ?? []).length}`)
  console.log(`[fetch] saved -> ${outPath}`)
  if (structured.productHunt) {
    console.log(`[fetch] leaderboard: ${structured.productHunt.period} ${structured.productHunt.periodKey}`)
  }
  if (text) console.log(`[fetch] text preview:\n${text.split("\n").slice(0, 5).join("\n")}`)
}

main().catch((err) => {
  console.error(`[fetch] ${err.message}`)
  process.exit(1)
})
