import process from "node:process"
import dayjs from "dayjs/esm"
import isoWeekPlugin from "dayjs/esm/plugin/isoWeek"
import timezonePlugin from "dayjs/esm/plugin/timezone"
import utcPlugin from "dayjs/esm/plugin/utc"
import type { NewsItem } from "@shared/types"

dayjs.extend(utcPlugin)
dayjs.extend(timezonePlugin)
dayjs.extend(isoWeekPlugin)

const feed = defineRSSSource("https://www.producthunt.com/feed")
const timezone = "America/Los_Angeles" as const
const productHuntApiUrl = "https://api.producthunt.com/v2/api/graphql"
const productHuntPageSize = 20
const productHuntMaxPages = 50

export type ProductHuntPeriod = "daily" | "weekly" | "monthly"

interface ProductHuntPeriodInfo {
  period: ProductHuntPeriod
  periodKey: string
  leaderboardUrl: string
  postedAfter: string
  postedBefore: string
}

interface ProductHuntPost {
  id?: string
  name?: string
  tagline?: string
  votesCount?: number
  commentsCount?: number
  dailyRank?: number | null
  weeklyRank?: number | null
  monthlyRank?: number | null
  createdAt?: string
  url?: string
  slug?: string
  thumbnail?: {
    url?: string
  } | null
}

interface ProductHuntPostsResponse {
  data?: {
    posts?: {
      edges?: Array<{ node?: ProductHuntPost }>
      pageInfo?: {
        hasNextPage?: boolean
        endCursor?: string | null
      }
    }
  }
  errors?: Array<{ message?: string }>
}

export function getProductHuntPeriodInfo(period: ProductHuntPeriod, now = dayjs()): ProductHuntPeriodInfo {
  const current = now.tz(timezone)
  const start = period === "daily"
    ? current.startOf("day")
    : period === "weekly"
      ? current.startOf("isoWeek").subtract(1, "week")
      : current.startOf("month").subtract(1, "month")
  const end = period === "daily"
    ? start.add(1, "day")
    : period === "weekly"
      ? start.add(1, "week")
      : start.add(1, "month")
  const year = start.year()
  const month = start.month() + 1
  const day = start.date()
  const week = start.isoWeek()
  const periodKey = period === "daily"
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : period === "weekly"
      ? `${start.isoWeekYear()}-W${String(week).padStart(2, "0")}`
      : `${year}-${String(month).padStart(2, "0")}`
  const leaderboardUrl = period === "daily"
    ? `https://www.producthunt.com/leaderboard/daily/${year}/${month}/${day}`
    : period === "weekly"
      ? `https://www.producthunt.com/leaderboard/weekly/${start.isoWeekYear()}/${week}`
      : `https://www.producthunt.com/leaderboard/monthly/${year}/${month}`

  return {
    period,
    periodKey,
    leaderboardUrl,
    postedAfter: start.toISOString(),
    postedBefore: end.toISOString(),
  }
}

function getLeaderboardRank(post: ProductHuntPost, period: ProductHuntPeriod) {
  return period === "daily"
    ? post.dailyRank
    : period === "weekly"
      ? post.weeklyRank
      : post.monthlyRank
}

export function mapProductHuntPosts(
  posts: ProductHuntPost[],
  periodInfo: ProductHuntPeriodInfo,
  capturedAt: string,
): NewsItem[] {
  return posts
    .map((post): NewsItem | undefined => {
      const leaderboardRank = getLeaderboardRank(post, periodInfo.period)
      if (
        !post.id
        || !post.name
        || typeof leaderboardRank !== "number"
        || !Number.isSafeInteger(leaderboardRank)
        || leaderboardRank < 1
      ) {
        return undefined
      }
      return {
        id: post.id,
        title: post.name,
        url: post.url || `https://www.producthunt.com/posts/${post.slug}`,
        fetchMethod: "api",
        productHunt: {
          period: periodInfo.period,
          periodKey: periodInfo.periodKey,
          leaderboardUrl: periodInfo.leaderboardUrl,
          timezone,
          provenance: "producthunt-api",
          capturedAt,
          leaderboardRank,
          votesCount: post.votesCount ?? 0,
          commentsCount: post.commentsCount ?? 0,
          ...(post.thumbnail?.url ? { thumbnailUrl: post.thumbnail.url } : {}),
          ...(post.createdAt ? { publishedAt: post.createdAt } : {}),
        },
        extra: {
          info: ` △︎ ${post.votesCount || 0}`,
          hover: post.tagline,
        },
      }
    })
    .filter((post): post is NewsItem => Boolean(post))
    .sort((a, b) => a.productHunt!.leaderboardRank! - b.productHunt!.leaderboardRank!)
}

async function fetchProductHunt(period: ProductHuntPeriod): Promise<NewsItem[]> {
  const apiToken = process.env.PRODUCTHUNT_API_TOKEN
  if (!apiToken) throw new Error(`PRODUCTHUNT_API_TOKEN is required for Product Hunt ${period} leaderboard`)

  const periodInfo = getProductHuntPeriodInfo(period)
  const query = `
    query($postedAfter: DateTime!, $postedBefore: DateTime!, $cursor: String) {
      posts(first: ${productHuntPageSize}, after: $cursor, order: RANKING, featured: true, postedAfter: $postedAfter, postedBefore: $postedBefore) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            name
            tagline
            votesCount
            commentsCount
            dailyRank
            weeklyRank
            monthlyRank
            createdAt
            url
            slug
            thumbnail {
              url
            }
          }
        }
      }
    }
  `
  const posts = new Map<string, ProductHuntPost>()
  let cursor: string | undefined

  for (let page = 0; page < productHuntMaxPages; page++) {
    const response = await myFetch<ProductHuntPostsResponse>(productHuntApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          postedAfter: periodInfo.postedAfter,
          postedBefore: periodInfo.postedBefore,
          cursor: cursor ?? null,
        },
      }),
    })
    if (response?.errors?.length) {
      const messages = response.errors.map(error => error.message).filter(Boolean).join("; ")
      throw new Error(messages || "Product Hunt API returned GraphQL errors")
    }

    const connection = response?.data?.posts
    for (const edge of connection?.edges || []) {
      const post = edge.node
      if (post?.id) posts.set(post.id, post)
    }

    if (!connection?.pageInfo?.hasNextPage) break
    const nextCursor = connection.pageInfo.endCursor
    if (!nextCursor || nextCursor === cursor) throw new Error("Product Hunt API returned an invalid pagination cursor")
    cursor = nextCursor

    if (page === productHuntMaxPages - 1) {
      throw new Error(`Product Hunt ${period} leaderboard exceeded ${productHuntMaxPages} API pages`)
    }
  }

  const news = mapProductHuntPosts([...posts.values()], periodInfo, dayjs().toISOString())
  if (!news.length) throw new Error(`Product Hunt ${period} leaderboard returned no ranked posts`)
  return news
}

async function fetchDaily() {
  try {
    return await fetchProductHunt("daily")
  } catch {
    const periodInfo = getProductHuntPeriodInfo("daily")
    const capturedAt = dayjs().toISOString()
    return (await feed()).map(item => ({
      ...item,
      productHunt: {
        period: periodInfo.period,
        periodKey: periodInfo.periodKey,
        leaderboardUrl: periodInfo.leaderboardUrl,
        timezone,
        provenance: "producthunt-rss" as const,
        capturedAt,
      },
    }))
  }
}

export default defineSource({
  "producthunt": fetchDaily,
  "producthunt-weekly": () => fetchProductHunt("weekly"),
  "producthunt-monthly": () => fetchProductHunt("monthly"),
})
