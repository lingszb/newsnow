import type { Database } from "db0"

const MINUTE_LIMIT = 12
const DAY_LIMIT = 200

/** Persistent quotas shared across all Node instances using the same database. */
export class AgentQuota {
  constructor(private readonly db: Database) {}

  async init() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_usage (
        user_id TEXT NOT NULL,
        period TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        requests INTEGER NOT NULL,
        PRIMARY KEY (user_id, period, window_start)
      );
    `)
  }

  private async consumeWindow(userId: string, period: string, start: number, limit: number) {
    // SQLite INSERT ... RETURNING is atomic, including concurrent writers.
    const row = await this.db.prepare(`
      INSERT INTO agent_usage (user_id, period, window_start, requests)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, period, window_start)
      DO UPDATE SET requests = agent_usage.requests + 1
      WHERE agent_usage.requests < ?
      RETURNING requests
    `).get(userId, period, start, limit) as { requests: number } | undefined
    return Boolean(row)
  }

  async consume(userId: string, now = Date.now()) {
    const minute = Math.floor(now / 60_000) * 60_000
    const day = Math.floor(now / 86_400_000) * 86_400_000
    // Checking the shorter window first avoids burning daily quota on minute-limit rejections.
    if (!await this.consumeWindow(userId, "minute", minute, MINUTE_LIMIT)) return false
    if (!await this.consumeWindow(userId, "day", day, DAY_LIMIT)) return false
    return true
  }

  async cleanup(now = Date.now()) {
    await this.db.prepare("DELETE FROM agent_usage WHERE window_start < ?")
      .run(now - 3 * 86_400_000)
  }
}

let quotaPromise: Promise<AgentQuota> | undefined

export function getAgentQuota() {
  quotaPromise ??= (async () => {
    const quota = new AgentQuota(useDatabase())
    await quota.init()
    return quota
  })().catch((error) => {
    quotaPromise = undefined
    throw error
  })
  return quotaPromise
}
