import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { type IndustryCode, type IndustryNewsResponse, type IndustrySort, industryCodes } from "@shared/industry"
import type { SourceID, SourceResponse } from "@shared/types"
import { columns } from "@shared/metadata"
import { sources } from "@shared/sources"
import { typeSafeObjectEntries } from "@shared/type.util"

interface McpDependencies {
  getSourceFeed: (
    sourceId: string | undefined,
    options?: { latest?: boolean, canForceRefresh?: boolean },
  ) => Promise<SourceResponse>
  queryIndustryNews: (input: {
    industry?: unknown
    count?: unknown
    hours?: unknown
    sort?: IndustrySort
    maximumCount?: number
  }) => Promise<IndustryNewsResponse>
}

const defaultDependencies: McpDependencies = {
  getSourceFeed: async (...args) => {
    const { getSourceFeed } = await import("#/services/news-refresh")
    return await getSourceFeed(...args)
  },
  queryIndustryNews: async (input) => {
    const { queryIndustryNews } = await import("#/services/industry-news")
    return await queryIndustryNews(input)
  },
}

const sourceSchema = z.object({
  id: z.string(),
  platformName: z.string(),
  listName: z.string().optional(),
  column: z.string().optional(),
})

const sourceNewsItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  url: z.string(),
  mobileUrl: z.string().optional(),
  publishedAt: z.union([z.string(), z.number()]).optional(),
  summary: z.string().optional(),
  rank: z.number().int().positive(),
  productHunt: z.object({
    leaderboardRank: z.number().int().positive(),
    votesCount: z.number().int().nonnegative(),
    commentsCount: z.number().int().nonnegative(),
    thumbnailUrl: z.string().optional(),
    publishedAt: z.string().optional(),
  }).optional(),
})

const productHuntLeaderboardSchema = z.object({
  period: z.enum(["daily", "weekly", "monthly"]),
  periodKey: z.string(),
  leaderboardUrl: z.string(),
  timezone: z.literal("America/Los_Angeles"),
  provenance: z.enum(["producthunt-api", "producthunt-rss"]),
  capturedAt: z.string(),
})

const industryNewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  industry: z.enum(industryCodes),
  rank: z.number().int().positive(),
  publishedAt: z.number(),
  summary: z.string().optional(),
})

function textAndStructured(structuredContent: Record<string, unknown>, text?: string) {
  return {
    content: [{
      type: "text" as const,
      text: text ?? JSON.stringify(structuredContent, null, 2),
    }],
    structuredContent,
  }
}

function normalizeSourceLookup(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s·._-]+/g, "")
}

export function resolveMcpSourceId(value: string): SourceID | undefined {
  const direct = value.trim() as SourceID
  if (sources[direct] && !sources[direct].redirect) return direct
  const lookup = normalizeSourceLookup(value)
  const matches = typeSafeObjectEntries(sources)
    .filter(([, source]) => !source.redirect)
    .filter(([, source]) => {
      const aliases = [
        source.name,
        source.title,
        source.title ? `${source.name} ${source.title}` : undefined,
      ].filter(Boolean) as string[]
      return aliases.some(alias => normalizeSourceLookup(alias) === lookup)
    })
    .map(([id]) => id)
  return matches.length === 1 ? matches[0] : undefined
}

export function createNewsNowMcpServer(dependencies: McpDependencies = defaultDependencies) {
  const server = new McpServer({
    name: "newsnow",
    version: "1.0.0",
  })

  server.registerTool("list_news_sources", {
    title: "列出新闻来源",
    description: "返回 NewsNow 当前可用的来源 ID、平台名称、榜单名称和平台栏目。",
    outputSchema: {
      sources: z.array(sourceSchema),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  }, async () => {
    const items = typeSafeObjectEntries(sources)
      .filter(([, source]) => !source.redirect)
      .map(([id]) => {
        const source = sources[id]
        return {
          id,
          platformName: source.name,
          ...(source.title ? { listName: source.title } : {}),
          ...(source.column ? { column: columns[source.column].zh } : {}),
        }
      })
    return textAndStructured({ sources: items })
  })

  server.registerTool("get_hottest_latest_news", {
    title: "获取来源热点资讯",
    description: "按 NewsNow 来源 ID 或唯一来源名称获取最新热点；是否参与行业分类不影响此工具。",
    inputSchema: {
      id: z.string().min(1).refine(
        id => Boolean(resolveMcpSourceId(id)),
        "Unknown or ambiguous NewsNow source id/name",
      ),
      count: z.number().int().min(1).max(20).default(10),
    },
    outputSchema: {
      sourceId: z.string(),
      sourceName: z.string(),
      productHunt: productHuntLeaderboardSchema.optional(),
      items: z.array(sourceNewsItemSchema),
    },
    annotations: {
      readOnlyHint: true,
    },
  }, async ({ id, count }) => {
    const source = resolveMcpSourceId(id)!
    const response = await dependencies.getSourceFeed(source, {
      latest: true,
      canForceRefresh: true,
    })
    const sourceId = response.id
    const items = response.items.slice(0, count).map((item, index) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      ...(item.mobileUrl ? { mobileUrl: item.mobileUrl } : {}),
      ...((item.pubDate ?? item.extra?.date) !== undefined
        ? { publishedAt: item.pubDate ?? item.extra?.date }
        : {}),
      ...(item.extra?.hover ? { summary: item.extra.hover } : {}),
      rank: index + 1,
      ...(item.productHunt?.leaderboardRank !== undefined
        ? {
            productHunt: {
              leaderboardRank: item.productHunt.leaderboardRank,
              votesCount: item.productHunt.votesCount ?? 0,
              commentsCount: item.productHunt.commentsCount ?? 0,
              ...(item.productHunt.thumbnailUrl ? { thumbnailUrl: item.productHunt.thumbnailUrl } : {}),
              ...(item.productHunt.publishedAt ? { publishedAt: item.productHunt.publishedAt } : {}),
            },
          }
        : {}),
    }))
    const productHuntItem = response.items.find(item => item.productHunt)?.productHunt
    const structuredContent = {
      sourceId,
      sourceName: sources[sourceId].name,
      ...(productHuntItem
        ? {
            productHunt: {
              period: productHuntItem.period,
              periodKey: productHuntItem.periodKey,
              leaderboardUrl: productHuntItem.leaderboardUrl,
              timezone: productHuntItem.timezone,
              provenance: productHuntItem.provenance,
              capturedAt: productHuntItem.capturedAt,
            },
          }
        : {}),
      items,
    }
    const text = items.map((item, index) => `${index + 1}. [${item.title}](${item.url})`).join("\n")
    return textAndStructured(structuredContent, text)
  })

  server.registerTool("get_industry_news", {
    title: "获取行业资讯",
    description: "按行业、时间范围和排序获取已完成分类的跨平台资讯。",
    inputSchema: {
      industry: z.enum(industryCodes),
      count: z.number().int().min(1).max(20).default(10),
      hours: z.number().int().min(1).max(168).default(24),
      sort: z.enum(["hot", "latest"]).default("hot"),
    },
    outputSchema: {
      industry: z.enum(industryCodes),
      items: z.array(industryNewsItemSchema),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  }, async ({ industry, count, hours, sort }) => {
    const result = await dependencies.queryIndustryNews({
      industry,
      count,
      hours,
      sort,
      maximumCount: 20,
    })
    const items = result.items.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      industry: item.industry,
      rank: item.rank,
      publishedAt: item.publishedAt,
      ...(item.summary ? { summary: item.summary } : {}),
    }))
    return textAndStructured({
      industry: industry as IndustryCode,
      items,
    })
  })

  return server
}

export type { McpDependencies }
