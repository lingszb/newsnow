import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database } from "db0"
import { CACHE_RETENTION_MS, Cache } from "./cache"

describe("cache", () => {
  let db: Database
  let cache: Cache

  beforeEach(async () => {
    db = createDatabase(sqlite({ name: ":memory:" }))
    cache = new Cache(db)
    await cache.init()
  })

  afterEach(async () => {
    await db.dispose()
  })

  it("removes cache entries older than 24 hours", async () => {
    const now = Date.UTC(2026, 7, 6, 8)
    const data = JSON.stringify([{ id: "1", title: "资讯", url: "https://example.com" }])
    await db.prepare(
      `INSERT INTO cache (id, data, updated) VALUES (?, ?, ?)`,
    ).run("expired", data, now - CACHE_RETENTION_MS - 1)
    await db.prepare(
      `INSERT INTO cache (id, data, updated) VALUES (?, ?, ?)`,
    ).run("boundary", data, now - CACHE_RETENTION_MS)
    await db.prepare(
      `INSERT INTO cache (id, data, updated) VALUES (?, ?, ?)`,
    ).run("fresh", data, now - CACHE_RETENTION_MS + 1)

    expect(await cache.cleanup(now)).toBe(1)
    expect(await cache.get("expired")).toBeUndefined()
    expect(await cache.get("boundary")).toBeDefined()
    expect(await cache.get("fresh")).toBeDefined()
  })
})
