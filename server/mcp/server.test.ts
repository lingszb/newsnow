import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import type { SourceResponse } from "@shared/types"
import { createNewsNowMcpServer, resolveMcpSourceId } from "./server"

describe("newsNow MCP tools", () => {
  const openServers: Array<ReturnType<typeof createNewsNowMcpServer>> = []
  const openClients: Client[] = []

  afterEach(async () => {
    await Promise.all(openClients.splice(0).map(client => client.close()))
    await Promise.all(openServers.splice(0).map(server => server.close()))
  })

  async function connect(sourceResponse?: SourceResponse) {
    const server = createNewsNowMcpServer({
      getSourceFeed: async () => sourceResponse ?? ({
        status: "success",
        id: "zhihu",
        updatedTime: Date.now(),
        items: [{
          id: "source-article",
          title: "热点标题",
          url: "https://example.com/hot",
          extra: { hover: "热点摘要" },
        }],
      }),
      queryIndustryNews: async () => ({
        items: [{
          id: "industry-article",
          sourceId: "zhihu",
          sourceName: "知乎",
          title: "行业标题",
          url: "https://example.com/industry",
          publishedAt: Date.now(),
          rank: 1,
          industry: "TECH",
          confidence: 0.9,
        }],
      }),
    })
    const client = new Client({ name: "test-client", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    openServers.push(server)
    openClients.push(client)
    return client
  }

  it("lists and calls all three tools with structured output", async () => {
    const client = await connect()
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual([
      "list_news_sources",
      "get_hottest_latest_news",
      "get_industry_news",
    ])

    const sources = await client.callTool({
      name: "list_news_sources",
      arguments: {},
    })
    expect(sources.structuredContent).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "zhihu", platformName: "知乎" }),
      ]),
    })

    const hottest = await client.callTool({
      name: "get_hottest_latest_news",
      arguments: { id: "zhihu", count: 1 },
    })
    expect(hottest.structuredContent).toMatchObject({
      sourceId: "zhihu",
      items: [expect.objectContaining({ title: "热点标题", rank: 1 })],
    })

    const industry = await client.callTool({
      name: "get_industry_news",
      arguments: { industry: "TECH" },
    })
    expect(industry.structuredContent).toMatchObject({
      industry: "TECH",
      items: [expect.objectContaining({ id: "industry-article" })],
    })
  })

  it("returns an MCP tool error for invalid input", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: "get_industry_news",
      arguments: { industry: "INVALID" },
    })
    expect(result.isError).toBe(true)
  })

  it("resolves a unique source name while preserving source ids", async () => {
    expect(resolveMcpSourceId("zhihu")).toBe("zhihu")
    expect(resolveMcpSourceId("知乎")).toBe("zhihu")

    const client = await connect()
    const hottest = await client.callTool({
      name: "get_hottest_latest_news",
      arguments: { id: "知乎", count: 1 },
    })
    expect(hottest.structuredContent).toMatchObject({ sourceId: "zhihu" })
  })

  it("adds Product Hunt metadata only for Product Hunt sources", async () => {
    const client = await connect({
      status: "success",
      id: "producthunt-weekly",
      updatedTime: Date.now(),
      items: [{
        id: "product-1",
        title: "Product One",
        url: "https://www.producthunt.com/posts/product-one",
        extra: {
          hover: "A useful product",
          info: " △︎ 120",
        },
        productHunt: {
          period: "weekly",
          periodKey: "2026-W32",
          leaderboardUrl: "https://www.producthunt.com/leaderboard/weekly/2026/32",
          timezone: "America/Los_Angeles",
          provenance: "producthunt-api",
          capturedAt: "2026-08-06T12:00:00.000Z",
          leaderboardRank: 1,
          votesCount: 120,
          commentsCount: 8,
          thumbnailUrl: "https://ph-files.example/product-one.png",
          publishedAt: "2026-08-04T08:00:00.000Z",
        },
      }],
    })

    const hottest = await client.callTool({
      name: "get_hottest_latest_news",
      arguments: { id: "producthunt-weekly", count: 1 },
    })

    expect(hottest.structuredContent).toMatchObject({
      sourceId: "producthunt-weekly",
      productHunt: {
        period: "weekly",
        periodKey: "2026-W32",
        provenance: "producthunt-api",
      },
      items: [{
        title: "Product One",
        rank: 1,
        summary: "A useful product",
        productHunt: {
          leaderboardRank: 1,
          votesCount: 120,
          commentsCount: 8,
          thumbnailUrl: "https://ph-files.example/product-one.png",
        },
      }],
    })
  })
})
