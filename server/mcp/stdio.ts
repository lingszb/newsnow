import process from "node:process"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { IndustryNewsResponse } from "@shared/industry"
import type { NewsSettingsResponse } from "@shared/settings"
import type { SourceID, SourceResponse } from "@shared/types"
import { createNewsNowMcpServer } from "./server"
import { CACHE_RETENTION_MS } from "#/database/cache"

const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:4444"

async function getJson<T>(path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  if (!response.ok) throw new Error(`NewsNow request failed with HTTP ${response.status}`)
  return await response.json() as T
}

const server = createNewsNowMcpServer({
  listIndustries: async () => {
    const settings = await getJson<NewsSettingsResponse>("/api/settings")
    return settings.industries
  },
  listAvailableSourceIds: async () => {
    const settings = await getJson<NewsSettingsResponse>("/api/settings")
    const now = Date.now()
    return settings.sources
      .filter(source => source.fetchStatus === "SUCCESS")
      .filter(source => source.lastFetchCompletedAt && now - source.lastFetchCompletedAt <= CACHE_RETENTION_MS)
      .map(source => source.id as SourceID)
  },
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
