import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import type { SourceID, SourceResponse } from "@shared/types"
import type { IndustryCode, IndustryDefinition } from "@shared/industry"
import { createNewsNowMcpServer, resolveMcpSourceId } from "./server"

describe("newsNow MCP tools", () => {
  const openServers: Array<ReturnType<typeof createNewsNowMcpServer>> = []
  const openClients: Client[] = []

  afterEach(async () => {
    await Promise.all(openClients.splice(0).map(client => client.close()))
    await Promise.all(openServers.splice(0).map(server => server.close()))
  })

  async function connect(
    sourceResponse?: SourceResponse,
    availableSourceIds: SourceID[] = [sourceResponse?.id ?? "zhihu"],
    industries: IndustryDefinition[] = [{
      code: "TECH",
      path: "tech",
      name: "科技",
      description: "AI、互联网、软件、硬件、通信、科学技术",
    }],
  ) {
    const server = createNewsNowMcpServer({
      listIndustries: async () => industries,
      listAvailableSourceIds: async () => availableSourceIds,
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
      queryIndustryNews: async input => ({
        items: [{
          id: "industry-article",
          sourceId: "zhihu",
          sourceName: "知乎",
          title: "行业标题",
          url: "https://example.com/industry",
          publishedAt: Date.now(),
          rank: 1,
          industry: String(input.industry) as IndustryCode,
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

  it("lists and calls all four tools with structured output", async () => {
    const client = await connect()
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual([
      "list_news_sources",
      "get_hottest_latest_news",
      "list_industries",
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

    const industries = await client.callTool({
      name: "list_industries",
      arguments: {},
    })
    expect(industries.structuredContent).toMatchObject({
      industries: [
        { code: "TECH", path: "tech", name: "科技", description: "AI、互联网、软件、硬件、通信、科学技术" },
      ],
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

  it("reads changed industry definitions on every list and query call", async () => {
    const industries: IndustryDefinition[] = [{
      code: "TECH",
      path: "tech",
      name: "科技",
      description: "科技内容",
    }]
    const client = await connect(undefined, ["zhihu"], industries)

    const initial = await client.callTool({ name: "list_industries", arguments: {} })
    expect(initial.structuredContent).toEqual({
      industries: [{ code: "TECH", path: "tech", name: "科技", description: "科技内容" }],
    })

    industries.splice(0, industries.length, {
      code: "GAME",
      path: "game",
      name: "游戏",
      description: "游戏行业内容",
    })

    const changed = await client.callTool({ name: "list_industries", arguments: {} })
    expect(changed.structuredContent).toEqual({
      industries: [{ code: "GAME", path: "game", name: "游戏", description: "游戏行业内容" }],
    })

    const game = await client.callTool({
      name: "get_industry_news",
      arguments: { industry: "GAME" },
    })
    expect(game.isError).not.toBe(true)
    expect(game.structuredContent).toMatchObject({ industry: "GAME" })

    const removed = await client.callTool({
      name: "get_industry_news",
      arguments: { industry: "TECH" },
    })
    expect(removed.isError).toBe(true)
  })

  it("hides unavailable sources and rejects direct access to them", async () => {
    const client = await connect(undefined, ["zhihu"])
    const sources = await client.callTool({
      name: "list_news_sources",
      arguments: {},
    })
    expect(sources.structuredContent).toMatchObject({
      sources: expect.not.arrayContaining([
        expect.objectContaining({ id: "kaopu" }),
      ]),
    })

    const result = await client.callTool({
      name: "get_hottest_latest_news",
      arguments: { id: "kaopu" },
    })
    expect(result.isError).toBe(true)
  })

  it("does not expose stale cache results through MCP", async () => {
    const client = await connect({
      status: "cache",
      id: "zhihu",
      updatedTime: Date.now(),
      items: [{
        id: "stale-article",
        title: "过期缓存资讯",
        url: "https://example.com/stale",
      }],
    })
    const result = await client.callTool({
      name: "get_hottest_latest_news",
      arguments: { id: "zhihu" },
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
