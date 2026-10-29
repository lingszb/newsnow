import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { describe, expect, it } from "vitest"
import { AgentQuota } from "./agent-quota"

describe("AgentQuota (persistent SQLite)", () => {
  it("isolates users and enforces the per-minute quota", async () => {
    const db = createDatabase(sqlite({ name: ":memory:" }))
    try {
      const quota = new AgentQuota(db)
      await quota.init()
      const t = Date.UTC(2026, 9, 29)
      for (let i = 0; i < 12; i++)
        expect(await quota.consume("user-a", t)).toBe(true)
      expect(await quota.consume("user-a", t)).toBe(false)
      expect(await quota.consume("user-b", t)).toBe(true)
      expect(await quota.consume("user-a", t + 60_000)).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it("enforces the daily cap across multiple quota instances", async () => {
    const db = createDatabase(sqlite({ name: ":memory:" }))
    try {
      const a = new AgentQuota(db)
      const b = new AgentQuota(db)
      await a.init()
      const t = Date.UTC(2026, 9, 29)
      for (let i = 0; i < 200; i++) {
        const quota = i % 2 ? a : b
        expect(await quota.consume("user-a", t + Math.floor(i / 10) * 60_000)).toBe(true)
      }
      expect(await a.consume("user-a", t + 30 * 60_000)).toBe(false)
      expect(await b.consume("user-b", t)).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})
