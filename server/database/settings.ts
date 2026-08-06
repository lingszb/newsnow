import process from "node:process"
import type { Database } from "db0"
import type { SourceID } from "@shared/types"
import type { SourceFetchStatus } from "@shared/settings"

const CLASSIFIER_MODEL_KEY = "classifier_model"

interface SettingRow {
  value: string
}

interface SourceSettingRow {
  source_id: SourceID
  classification_enabled: number
  fetch_status: SourceFetchStatus
  last_fetch_started_at: number | null
  last_fetch_completed_at: number | null
  last_fetch_error: string | null
}

function rowsFromResult<T>(result: T[] | { results?: T[] }) {
  return Array.isArray(result) ? result : result.results ?? []
}

export class NewsSettingsRepository {
  constructor(private readonly db: Database) {}

  async init() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS news_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS news_source_setting (
        source_id TEXT PRIMARY KEY,
        classification_enabled INTEGER NOT NULL DEFAULT 1
          CHECK(classification_enabled IN (0, 1)),
        fetch_status TEXT NOT NULL DEFAULT 'NEVER'
          CHECK(fetch_status IN ('NEVER', 'FETCHING', 'SUCCESS', 'ERROR')),
        last_fetch_started_at INTEGER,
        last_fetch_completed_at INTEGER,
        last_fetch_error TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
  }

  async getClassifierModel(fallback: string) {
    const row = await this.db.prepare(
      `SELECT value FROM news_setting WHERE key = ?`,
    ).get(CLASSIFIER_MODEL_KEY) as SettingRow | undefined
    return row?.value || fallback
  }

  async setClassifierModel(model: string, now = Date.now()) {
    await this.db.prepare(`
      INSERT INTO news_setting (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(CLASSIFIER_MODEL_KEY, model, now)
  }

  async isClassificationEnabled(sourceId: SourceID) {
    const row = await this.db.prepare(
      `SELECT classification_enabled FROM news_source_setting WHERE source_id = ?`,
    ).get(sourceId) as Pick<SourceSettingRow, "classification_enabled"> | undefined
    return row ? Boolean(row.classification_enabled) : true
  }

  async setClassificationEnabled(sourceId: SourceID, enabled: boolean, now = Date.now()) {
    await this.db.prepare(`
      INSERT INTO news_source_setting (source_id, classification_enabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        classification_enabled = excluded.classification_enabled,
        updated_at = excluded.updated_at
    `).run(sourceId, enabled ? 1 : 0, now)
  }

  async listSourceSettings() {
    const result = await this.db.prepare(`
      SELECT source_id, classification_enabled, fetch_status,
        last_fetch_started_at, last_fetch_completed_at, last_fetch_error
      FROM news_source_setting
    `).all() as SourceSettingRow[] | { results?: SourceSettingRow[] }
    return new Map(rowsFromResult(result).map(row => [row.source_id, row]))
  }

  async markFetchStarted(sourceId: SourceID, now = Date.now()) {
    await this.db.prepare(`
      INSERT INTO news_source_setting (
        source_id, classification_enabled, fetch_status, last_fetch_started_at,
        last_fetch_error, updated_at
      ) VALUES (?, 1, 'FETCHING', ?, NULL, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        fetch_status = 'FETCHING',
        last_fetch_started_at = excluded.last_fetch_started_at,
        last_fetch_error = NULL,
        updated_at = excluded.updated_at
    `).run(sourceId, now, now)
  }

  async markFetchCompleted(sourceId: SourceID, now = Date.now()) {
    await this.db.prepare(`
      INSERT INTO news_source_setting (
        source_id, classification_enabled, fetch_status, last_fetch_started_at,
        last_fetch_completed_at, last_fetch_error, updated_at
      ) VALUES (?, 1, 'SUCCESS', ?, ?, NULL, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        fetch_status = 'SUCCESS',
        last_fetch_completed_at = excluded.last_fetch_completed_at,
        last_fetch_error = NULL,
        updated_at = excluded.updated_at
    `).run(sourceId, now, now, now)
  }

  async markFetchFailed(sourceId: SourceID, error: string, now = Date.now()) {
    await this.db.prepare(`
      INSERT INTO news_source_setting (
        source_id, classification_enabled, fetch_status, last_fetch_started_at,
        last_fetch_completed_at, last_fetch_error, updated_at
      ) VALUES (?, 1, 'ERROR', ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        fetch_status = 'ERROR',
        last_fetch_completed_at = excluded.last_fetch_completed_at,
        last_fetch_error = excluded.last_fetch_error,
        updated_at = excluded.updated_at
    `).run(sourceId, now, now, error.slice(0, 500), now)
  }
}

let settingsRepositoryPromise: Promise<NewsSettingsRepository> | undefined

export function getNewsSettingsRepository() {
  settingsRepositoryPromise ??= (async () => {
    const repository = new NewsSettingsRepository(useDatabase())
    if (process.env.INIT_TABLE !== "false") await repository.init()
    return repository
  })()
  return settingsRepositoryPromise
}

export function resetNewsSettingsRepositoryForTests() {
  settingsRepositoryPromise = undefined
}
