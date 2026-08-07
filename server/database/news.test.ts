import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database } from "db0"
import { NewsRepository, RETENTION_MS } from "./news"
import { NewsSettingsRepository } from "./settings"

describe("news repository", () => {
  let db: Database
  let repository: NewsRepository
  let settings: NewsSettingsRepository

  beforeEach(async () => {
    db = createDatabase(sqlite({ name: ":memory:" }))
    repository = new NewsRepository(db)
    await repository.init()
    settings = new NewsSettingsRepository(db)
    await settings.init()
    await settings.markFetchCompleted("zhihu")
  })

  afterEach(async () => {
    await db.dispose()
  })

  it("initializes idempotently and only requeues changed content", async () => {
    await repository.init()
    const item = {
      id: "article-1",
      title: "一条科技资讯",
      url: "https://example.com/1",
      extra: { hover: "原摘要" },
    }
    expect(await repository.ingest("zhihu", [item], 1_000)).toBe(1)
    const [pending] = await repository.getPendingClassifications()
    expect(pending.title).toBe(item.title)

    await repository.saveClassification(
      pending,
      { industry: "TECH", confidence: 0.9 },
      { model: "test-model" },
    )
    expect(await repository.getPendingClassifications()).toHaveLength(0)

    expect(await repository.ingest("zhihu", [item], 2_000)).toBe(0)
    expect(await repository.getPendingClassifications()).toHaveLength(0)

    expect(await repository.ingest("zhihu", [{
      ...item,
      extra: { hover: "修改后的摘要" },
    }], 3_000)).toBe(1)
    expect(await repository.getPendingClassifications()).toHaveLength(1)
  })

  it("queries classified articles and removes records older than 8 days", async () => {
    const ingestedAt = Date.UTC(2026, 7, 6, 8)
    const publishedAt = ingestedAt - 60 * 60 * 1000
    await repository.ingest("zhihu", [{
      id: "article-2",
      title: "市场观察",
      url: "https://example.com/2",
      pubDate: publishedAt,
    }], ingestedAt)
    const [pending] = await repository.getPendingClassifications()
    await repository.saveClassification(
      pending,
      { industry: "FINANCE", confidence: 0.88 },
      { model: "test-model" },
    )

    const result = await repository.queryIndustryNews({
      industry: "FINANCE",
      count: 10,
      hours: 24,
      sort: "hot",
      now: ingestedAt,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      sourceId: "zhihu",
      rank: 1,
      industry: "FINANCE",
    })

    expect(await repository.cleanup(publishedAt + RETENTION_MS)).toBe(0)
    expect(await repository.cleanup(publishedAt + RETENTION_MS + 1)).toBe(1)
    expect(await repository.getArticle("zhihu", "article-2")).toBeUndefined()
    expect(await repository.getPendingClassifications()).toHaveLength(0)
  })

  it("uses first seen time as a hard retention limit", async () => {
    const firstSeenAt = Date.UTC(2026, 7, 1)
    const item = {
      id: "article-3",
      title: "持续在榜资讯",
      url: "https://example.com/3",
    }
    expect(await repository.ingest("zhihu", [item], firstSeenAt)).toBe(1)
    expect(await repository.ingest("zhihu", [item], firstSeenAt + RETENTION_MS - 1)).toBe(0)

    expect(await repository.cleanup(firstSeenAt + RETENTION_MS + 1)).toBe(1)
    expect(await repository.getArticle("zhihu", "article-3")).toBeUndefined()
    expect(await repository.getPendingClassifications()).toHaveLength(0)
  })

  it("does not persist articles already older than the retention limit", async () => {
    const ingestedAt = Date.UTC(2026, 7, 10)
    expect(await repository.ingest("zhihu", [{
      id: "article-4",
      title: "过期资讯",
      url: "https://example.com/4",
      pubDate: ingestedAt - RETENTION_MS - 1,
    }], ingestedAt)).toBe(0)

    expect(await repository.getArticle("zhihu", "article-4")).toBeUndefined()
    expect(await repository.getPendingClassifications()).toHaveLength(0)
  })

  it("keeps disabled sources out of classification and industry queries", async () => {
    const item = {
      id: "disabled-source-article",
      title: "不参与行业分类的资讯",
      url: "https://example.com/disabled",
    }
    await settings.setClassificationEnabled("zhihu", false)
    expect(await repository.ingest("zhihu", [item], Date.now(), false)).toBe(1)
    expect(await repository.getPendingClassifications()).toHaveLength(0)

    await settings.setClassificationEnabled("zhihu", true)
    await repository.enqueueSourceForClassification("zhihu")
    const [pending] = await repository.getPendingClassifications()
    expect(pending.title).toBe(item.title)
    await repository.saveClassification(pending, { industry: "TECH", confidence: 0.9 }, { model: "test-model" })
    expect((await repository.queryIndustryNews({
      industry: "TECH",
      count: 10,
      hours: 24,
      sort: "hot",
    })).items).toHaveLength(1)

    await settings.setClassificationEnabled("zhihu", false)
    expect((await repository.queryIndustryNews({
      industry: "TECH",
      count: 10,
      hours: 24,
      sort: "hot",
    })).items).toHaveLength(0)
  })

  it("requeues existing classifications after industry settings change", async () => {
    await repository.ingest("zhihu", [{
      id: "requeue-article",
      title: "需要重新分类的资讯",
      url: "https://example.com/requeue",
    }], Date.now())
    const [pending] = await repository.getPendingClassifications()
    await repository.saveClassification(pending, { industry: "TECH", confidence: 0.9 }, { model: "test-model" })
    expect(await repository.getPendingClassifications()).toHaveLength(0)

    await expect(repository.requeueAllClassifications("industry-v2")).resolves.toBe(1)
    await repository.saveClassification(pending, { industry: "TECH", confidence: 0.8 }, { model: "stale-model" })
    await expect(repository.getPendingClassifications()).resolves.toEqual([
      expect.objectContaining({ id: pending.id, classificationVersion: "industry-v2", retryCount: 0 }),
    ])
  })

  it("clears classification for a removed industry without affecting others", async () => {
    await repository.ingest("zhihu", [
      { id: "tech-article", title: "科技资讯", url: "https://example.com/tech" },
      { id: "other-article", title: "其他资讯", url: "https://example.com/other" },
    ], Date.now())
    const [techPending, otherPending] = await repository.getPendingClassifications()
    await repository.saveClassification(techPending, { industry: "TECH", confidence: 0.9 }, { model: "test-model" })
    await repository.saveClassification(otherPending, { industry: "OTHER", confidence: 0.9 }, { model: "test-model" })

    await expect(repository.clearIndustryClassifications("TECH")).resolves.toBe(1)

    expect((await repository.queryIndustryNews({ industry: "TECH", count: 10, hours: 24, sort: "hot" })).items).toHaveLength(0)
    expect((await repository.queryIndustryNews({ industry: "OTHER", count: 10, hours: 24, sort: "hot" })).items).toHaveLength(1)
  })

  it("keeps unavailable sources out of classification and industry queries", async () => {
    const item = {
      id: "unavailable-source-article",
      title: "来源已经失效的资讯",
      url: "https://example.com/unavailable",
    }
    expect(await repository.ingest("zhihu", [item], Date.now())).toBe(1)
    const [pending] = await repository.getPendingClassifications()
    await repository.saveClassification(pending, { industry: "TECH", confidence: 0.9 }, { model: "test-model" })

    await settings.markFetchFailed("zhihu", "upstream failed")
    expect(await repository.getPendingClassifications()).toHaveLength(0)
    expect((await repository.queryIndustryNews({
      industry: "TECH",
      count: 10,
      hours: 24,
      sort: "hot",
    })).items).toHaveLength(0)
  })
})
