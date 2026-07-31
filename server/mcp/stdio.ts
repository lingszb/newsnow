import process from "node:process"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { IndustryNewsResponse } from "@shared/industry"
import type { SourceResponse } from "@shared/types"
import { createNewsNowMcpServer } from "./server"

const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:4444"

async function getJson<T>(path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  if (!response.ok) throw new Error(`NewsNow request failed with HTTP ${response.status}`)
  return await response.json() as T
}

const server = createNewsNowMcpServer({
  getSourceFeed: async (sourceId) => {
    const query = new URLSearchParams({ id: sourceId ?? "" })
    return await getJson<SourceResponse>(`/api/s?${query}`)
  },
  queryIndustryNews: async (input) => {
    const query = new URLSearchParams({
      industry: String(input.industry ?? "TECH"),
      count: String(input.count ?? 10),
      hours: String(input.hours ?? 24),
      sort: input.sort ?? "hot",
    })
    return await getJson<IndustryNewsResponse>(`/api/industry-news?${query}`)
  },
})
const transport = new StdioServerTransport()

await server.connect(transport)
