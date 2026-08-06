import dayjs from "dayjs/esm"
import { afterEach, describe, expect, it, vi } from "vitest"
import productHuntSources, { getProductHuntPeriodInfo, mapProductHuntPosts } from "../server/sources/producthunt"

const myFetchMock = vi.hoisted(() => vi.fn())

vi.mock("../server/utils/fetch", () => ({
  myFetch: myFetchMock,
}))

describe("product hunt leaderboards", () => {
  const now = dayjs("2026-08-06T12:00:00.000Z")

  afterEach(() => {
    vi.unstubAllEnvs()
    myFetchMock.mockReset()
  })

  it("uses the current day, previous complete week and previous complete month in Product Hunt Pacific time", () => {
    expect(getProductHuntPeriodInfo("daily", now)).toEqual({
      period: "daily",
      periodKey: "2026-08-06",
      leaderboardUrl: "https://www.producthunt.com/leaderboard/daily/2026/8/6",
      postedAfter: "2026-08-06T07:00:00.000Z",
      postedBefore: "2026-08-07T07:00:00.000Z",
    })
    expect(getProductHuntPeriodInfo("weekly", now)).toEqual({
      period: "weekly",
      periodKey: "2026-W31",
      leaderboardUrl: "https://www.producthunt.com/leaderboard/weekly/2026/31",
      postedAfter: "2026-07-27T07:00:00.000Z",
      postedBefore: "2026-08-03T07:00:00.000Z",
    })
    expect(getProductHuntPeriodInfo("monthly", now)).toEqual({
      period: "monthly",
      periodKey: "2026-07",
      leaderboardUrl: "https://www.producthunt.com/leaderboard/monthly/2026/7",
      postedAfter: "2026-07-01T07:00:00.000Z",
      postedBefore: "2026-08-01T07:00:00.000Z",
    })
  })

  it("keeps only ranked posts and sorts by the official period rank", () => {
    const period = getProductHuntPeriodInfo("monthly", now)
    const items = mapProductHuntPosts([
      {
        id: "second",
        name: "Second",
        tagline: "Second product",
        monthlyRank: 2,
        votesCount: 20,
        commentsCount: 3,
        slug: "second",
      },
      {
        id: "unranked",
        name: "Unranked",
        monthlyRank: null,
        url: "https://www.producthunt.com/posts/unranked",
      },
      {
        id: "first",
        name: "First",
        tagline: "First product",
        monthlyRank: 1,
        votesCount: 30,
        commentsCount: 4,
        createdAt: "2026-08-01T08:00:00.000Z",
        url: "https://www.producthunt.com/posts/first",
        thumbnail: { url: "https://ph-files.example/first.png" },
      },
    ], period, "2026-08-06T12:00:00.000Z")

    expect(items.map(item => item.id)).toEqual(["first", "second"])
    expect(items[0]).toMatchObject({
      title: "First",
      extra: {
        info: " △︎ 30",
        hover: "First product",
      },
      productHunt: {
        period: "monthly",
        periodKey: "2026-07",
        provenance: "producthunt-api",
        leaderboardRank: 1,
        votesCount: 30,
        commentsCount: 4,
        thumbnailUrl: "https://ph-files.example/first.png",
        publishedAt: "2026-08-01T08:00:00.000Z",
      },
    })
  })

  it("loads every API page before filtering and sorting leaderboard ranks", async () => {
    vi.stubEnv("PRODUCTHUNT_API_TOKEN", "developer-token")
    myFetchMock
      .mockResolvedValueOnce({
        data: {
          posts: {
            pageInfo: { hasNextPage: true, endCursor: "page-2" },
            edges: [
              { node: { id: "second", name: "Second", monthlyRank: 2, votesCount: 20 } },
              { node: { id: "unranked", name: "Unranked", monthlyRank: null } },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          posts: {
            pageInfo: { hasNextPage: false, endCursor: "page-2" },
            edges: [
              { node: { id: "first", name: "First", monthlyRank: 1, votesCount: 30 } },
            ],
          },
        },
      })

    const items = await productHuntSources["producthunt-monthly"]!()

    expect(items.map(item => item.id)).toEqual(["first", "second"])
    expect(myFetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(myFetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { cursor: null },
    })
    expect(JSON.parse(myFetchMock.mock.calls[1][1].body)).toMatchObject({
      variables: { cursor: "page-2" },
    })
  })
})
