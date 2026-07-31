import { createHash } from "node:crypto"
import process from "node:process"
import type { Database } from "db0"
import type { NewsItem, SourceID } from "@shared/types"
import type { IndustryArticle, IndustryCode, IndustryCount, IndustrySort } from "@shared/industry"
import { industryByCode, industryDefinitions } from "@shared/industry"
import { sources } from "@shared/sources"

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface ArticleRow {
  id: string
  source_id: SourceID
  source_item_id: string
  title: string
  url: string
  mobile_url: string | null
  summary: string | null
  published_at: number | null
  source_rank: number
  first_seen_at: number
  last_seen_at: number
  content_hash: string
}

interface PendingArticleRow {
  id: string
  title: string
  summary: string | null
  input_hash: string
  retry_count: number
}

interface CountRow {
  industry_code: IndustryCode
  count: number
}

interface IndustryArticleRow {
  id: string
  source_id: SourceID
  title: string
  url: string
  mobile_url: string | null
  summary: string | null
  published_at: number | null
  first_seen_at: number
  source_rank: number
  industry_code: IndustryCode
  confidence: number
}

export interface PendingArticle {
  id: string
  title: string
  summary?: string
  inputHash: string
  retryCount: number
}

export interface IndustryQuery {
  industry: IndustryCode
  hours: number
  sort: IndustrySort
  count: number
  source?: SourceID
  offset?: number
  now?: number
}

export function articleId(sourceId: SourceID, sourceItemId: string) {
  return createHash("sha256").update(`${sourceId}\0${sourceItemId}`).digest("hex")
}

export function articleContentHash(title: string, summary?: string) {
  return createHash("sha256").update(`${title.trim()}\0${summary?.trim() ?? ""}`).digest("hex")
}

function rowsFromResult<T>(result: T[] | { results?: T[] }) {
  return Array.isArray(result) ? result : result.results ?? []
}

function normalizePublishedAt(value: NewsItem["pubDate"] | NonNullable<NewsItem["extra"]>["date"]) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric) && String(numeric) === value.trim()) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export class NewsRepository {
  constructor(private readonly db: Database) {}

  async init() {
    await this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS news_article (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        mobile_url TEXT,
        summary TEXT,
        published_at INTEGER,
        source_rank INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        UNIQUE(source_id, source_item_id)
      );

      CREATE TABLE IF NOT EXISTS news_classification (
        article_id TEXT PRIMARY KEY,
        industry_code TEXT,
        confidence REAL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'CLASSIFIED', 'FAILED')),
        model_name TEXT,
        classification_version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        classified_at INTEGER,
        FOREIGN KEY(article_id) REFERENCES news_article(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_news_article_last_seen
        ON news_article(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_news_article_source_time
        ON news_article(source_id, published_at);
      CREATE INDEX IF NOT EXISTS idx_news_classification_query
        ON news_classification(status, industry_code);
    `)
  }

  async ingest(sourceId: SourceID, items: NewsItem[], now = Date.now()) {
    let changed = 0
    for (const [index, item] of items.entries()) {
      const sourceItemId = String(item.id)
      const id = articleId(sourceId, sourceItemId)
      const summary = item.extra?.hover?.trim() || undefined
      const contentHash = articleContentHash(item.title, summary)
      const existing = await this.db.prepare(
        `SELECT id, content_hash FROM news_article WHERE source_id = ? AND source_item_id = ?`,
      ).get(sourceId, sourceItemId) as Pick<ArticleRow, "id" | "content_hash"> | undefined

      if (!existing) {
        await this.db.prepare(`
          INSERT INTO news_article (
            id, source_id, source_item_id, title, url, mobile_url, summary,
            published_at, source_rank, first_seen_at, last_seen_at, content_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          sourceId,
          sourceItemId,
          item.title,
          item.url,
          item.mobileUrl ?? null,
          summary ?? null,
          normalizePublishedAt(item.pubDate ?? item.extra?.date),
          index + 1,
          now,
          now,
          contentHash,
        )
        await this.db.prepare(`
          INSERT INTO news_classification (
            article_id, status, classification_version, input_hash, retry_count
          ) VALUES (?, 'PENDING', ?, ?, 0)
        `).run(id, classificationVersion(), contentHash)
        changed += 1
        continue
      }

      await this.db.prepare(`
        UPDATE news_article SET
          title = ?, url = ?, mobile_url = ?, summary = ?, published_at = ?,
          source_rank = ?, last_seen_at = ?, content_hash = ?
        WHERE id = ?
      `).run(
        item.title,
        item.url,
        item.mobileUrl ?? null,
        summary ?? null,
        normalizePublishedAt(item.pubDate ?? item.extra?.date),
        index + 1,
        now,
        contentHash,
        existing.id,
      )

      if (existing.content_hash !== contentHash) {
        await this.db.prepare(`
          INSERT INTO news_classification (
            article_id, status, classification_version, input_hash, retry_count
          ) VALUES (?, 'PENDING', ?, ?, 0)
          ON CONFLICT(article_id) DO UPDATE SET
            industry_code = NULL,
            confidence = NULL,
            status = 'PENDING',
            model_name = NULL,
            classification_version = excluded.classification_version,
            input_hash = excluded.input_hash,
            retry_count = 0,
            error_message = NULL,
            classified_at = NULL
        `).run(existing.id, classificationVersion(), contentHash)
        changed += 1
      }
    }
    return changed
  }

  async getPendingClassifications(limit = 20): Promise<PendingArticle[]> {
    const result = await this.db.prepare(`
      SELECT a.id, a.title, a.summary, c.input_hash, c.retry_count
      FROM news_article a
      INNER JOIN news_classification c ON c.article_id = a.id
      WHERE c.status = 'PENDING' AND c.retry_count < 3
      ORDER BY a.first_seen_at ASC, a.id ASC
      LIMIT ?
    `).all(limit) as PendingArticleRow[] | { results?: PendingArticleRow[] }
    return rowsFromResult(result).map(row => ({
      id: row.id,
      title: row.title,
      summary: row.summary ?? undefined,
      inputHash: row.input_hash,
      retryCount: row.retry_count,
    }))
  }

  async saveClassification(
    article: PendingArticle,
    result: { industry: IndustryCode, confidence: number },
    options: { model: string, lowConfidence?: boolean, retryAttempted?: boolean } ,
  ) {
    const errorMessage = options.lowConfidence ? "LOW_CONFIDENCE" : null
    await this.db.prepare(`
      UPDATE news_classification SET
        industry_code = ?,
        confidence = ?,
        status = 'CLASSIFIED',
        model_name = ?,
        classification_version = ?,
        retry_count = retry_count + ?,
        error_message = ?,
        classified_at = ?
      WHERE article_id = ? AND input_hash = ? AND status = 'PENDING'
    `).run(
      result.industry,
      result.confidence,
      options.model,
      classificationVersion(),
      options.retryAttempted || options.lowConfidence ? 1 : 0,
      errorMessage,
      Date.now(),
      article.id,
      article.inputHash,
    )
  }

  async recordClassificationFailure(article: PendingArticle, message: string) {
    const nextRetryCount = article.retryCount + 1
    await this.db.prepare(`
      UPDATE news_classification SET
        status = ?,
        retry_count = ?,
        error_message = ?
      WHERE article_id = ? AND input_hash = ? AND status = 'PENDING'
    `).run(
      nextRetryCount >= 3 ? "FAILED" : "PENDING",
      nextRetryCount,
      message.slice(0, 500),
      article.id,
      article.inputHash,
    )
  }

  async classificationCounts() {
    const pending = await this.db.prepare(
      `SELECT COUNT(*) AS count FROM news_classification WHERE status = 'PENDING'`,
    ).get() as { count: number }
    const failed = await this.db.prepare(
      `SELECT COUNT(*) AS count FROM news_classification WHERE status = 'FAILED'`,
    ).get() as { count: number }
    return {
      pending: Number(pending?.count ?? 0),
      failed: Number(failed?.count ?? 0),
    }
  }

  async industryCounts(hours = 24, source?: SourceID, now = Date.now()): Promise<IndustryCount[]> {
    const params: Array<string | number> = [now - hours * 60 * 60 * 1000]
    let sourceClause = ""
    if (source) {
      sourceClause = "AND a.source_id = ?"
      params.push(source)
    }
    const result = await this.db.prepare(`
      SELECT c.industry_code, COUNT(*) AS count
      FROM news_article a
      INNER JOIN news_classification c ON c.article_id = a.id
      WHERE c.status = 'CLASSIFIED'
        AND COALESCE(a.published_at, a.first_seen_at) >= ?
        ${sourceClause}
      GROUP BY c.industry_code
    `).all(...params) as CountRow[] | { results?: CountRow[] }
    const counts = new Map(rowsFromResult(result).map(row => [row.industry_code, Number(row.count)]))
    return industryDefinitions.map(definition => ({
      code: definition.code,
      path: definition.path,
      name: definition.name,
      count: counts.get(definition.code) ?? 0,
    }))
  }

  async queryIndustryNews(query: IndustryQuery) {
    const now = query.now ?? Date.now()
    const params: Array<string | number> = [
      query.industry,
      now - query.hours * 60 * 60 * 1000,
    ]
    let sourceClause = ""
    if (query.source) {
      sourceClause = "AND a.source_id = ?"
      params.push(query.source)
    }
    const orderBy = query.sort === "latest"
      ? "COALESCE(a.published_at, a.first_seen_at) DESC, a.source_rank ASC, a.id ASC"
      : "a.source_rank ASC, COALESCE(a.published_at, a.first_seen_at) DESC, a.id ASC"
    params.push(query.count + 1, query.offset ?? 0)

    const result = await this.db.prepare(`
      SELECT
        a.id, a.source_id, a.title, a.url, a.mobile_url, a.summary,
        a.published_at, a.first_seen_at, a.source_rank,
        c.industry_code, c.confidence
      FROM news_article a
      INNER JOIN news_classification c ON c.article_id = a.id
      WHERE c.status = 'CLASSIFIED'
        AND c.industry_code = ?
        AND COALESCE(a.published_at, a.first_seen_at) >= ?
        ${sourceClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params) as IndustryArticleRow[] | { results?: IndustryArticleRow[] }

    const rows = rowsFromResult(result)
    const hasMore = rows.length > query.count
    const items: IndustryArticle[] = rows.slice(0, query.count).map(row => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: sources[row.source_id]?.name ?? row.source_id,
      sourceTitle: sources[row.source_id]?.title,
      title: row.title,
      url: row.url,
      mobileUrl: row.mobile_url ?? undefined,
      summary: row.summary ?? undefined,
      publishedAt: Number(row.published_at ?? row.first_seen_at),
      rank: Number(row.source_rank),
      industry: row.industry_code,
      confidence: Number(row.confidence),
    }))
    return { items, hasMore }
  }

  async cleanup(now = Date.now()) {
    const threshold = now - RETENTION_MS
    await this.db.prepare(`
      DELETE FROM news_classification
      WHERE article_id IN (
        SELECT id FROM news_article WHERE last_seen_at < ?
      )
    `).run(threshold)
    const result = await this.db.prepare(
      `DELETE FROM news_article WHERE last_seen_at < ?`,
    ).run(threshold) as { changes?: number }
    return Number(result.changes ?? 0)
  }

  async getArticle(sourceId: SourceID, sourceItemId: string) {
    return await this.db.prepare(`
      SELECT * FROM news_article WHERE source_id = ? AND source_item_id = ?
    `).get(sourceId, sourceItemId) as ArticleRow | undefined
  }
}

export function classificationVersion() {
  return process.env.NEWS_CLASSIFICATION_VERSION?.trim() || "industry-v1"
}

let repositoryPromise: Promise<NewsRepository> | undefined

export function getNewsRepository() {
  repositoryPromise ??= (async () => {
    const repository = new NewsRepository(useDatabase())
    if (process.env.INIT_TABLE !== "false") await repository.init()
    return repository
  })()
  return repositoryPromise
}

export function resetNewsRepositoryForTests() {
  repositoryPromise = undefined
}

export { RETENTION_MS, industryByCode }
