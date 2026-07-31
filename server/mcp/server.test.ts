import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { createNewsNowMcpServer } from "./server"

describe("NewsNow MCP tools", () => {
  const openServers: Array<ReturnType<typeof createNewsNowMcpServer>> = []
  const openClients: Client[] = []

  afterEach(async () => {
    await Promise.all(openClients.splice(0).map(client => client.close()))
    await Promise.all(openServers.splice(0).map(server => server.close()))
  })

  async function connect() {
    const server = createNewsNowMcpServer({
      getSourceFeed: async () => ({
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
})
