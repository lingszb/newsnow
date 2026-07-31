import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database } from "db0"
import { NewsRepository, RETENTION_MS } from "./news"

describe("NewsRepository", () => {
  let db: Database
  let repository: NewsRepository

  beforeEach(async () => {
    db = createDatabase(sqlite({ name: ":memory:" }))
    repository = new NewsRepository(db)
    await repository.init()
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

  it("queries classified articles and removes records older than 30 days", async () => {
    await repository.ingest("zhihu", [{
      id: "article-2",
      title: "市场观察",
      url: "https://example.com/2",
      pubDate: 10_000,
    }], 10_000)
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
      now: 10_000,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      sourceId: "zhihu",
      rank: 1,
      industry: "FINANCE",
    })

    expect(await repository.cleanup(10_000 + RETENTION_MS + 1)).toBe(1)
    expect(await repository.getArticle("zhihu", "article-2")).toBeUndefined()
  })
})
