import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "db0"
import { NewsRepository } from "#/database/news"
import {
  QwenNewsClassifier,
  processPendingClassifications,
} from "./news-classifier"

const article = {
  id: "article-id",
  title: "测试标题",
  inputHash: "input-hash",
  retryCount: 0,
}

function response(content: unknown) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: typeof content === "string" ? content : JSON.stringify(content),
      },
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("QwenNewsClassifier", () => {
  it("uses JSON mode, omits missing summaries, and validates the result", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.temperature).toBe(0)
      expect(body.enable_thinking).toBe(false)
      expect(body.response_format).toEqual({ type: "json_object" })
      expect(body.messages[1].content).not.toContain("\"summary\"")
      return response({
        results: [{
          articleId: article.id,
          industry: "TECH",
          confidence: 0.91,
        }],
      })
    })
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 100,
    }, fetchMock as typeof fetch)

    await expect(classifier.classify([article])).resolves.toEqual([{
      articleId: article.id,
      industry: "TECH",
      confidence: 0.91,
    }])
  })

  it.each([
    ["invalid JSON", "{not-json"],
    ["illegal industry", {
      results: [{ articleId: article.id, industry: "UNKNOWN", confidence: 0.8 }],
    }],
    ["missing article", {
      results: [{ articleId: "another-id", industry: "TECH", confidence: 0.8 }],
    }],
  ])("rejects %s", async (_name, content) => {
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 100,
    }, vi.fn(async () => response(content)) as typeof fetch)
    await expect(classifier.classify([article])).rejects.toThrow()
  })

  it("aborts after the configured timeout", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      }))
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 5,
    }, fetchMock as typeof fetch)
    await expect(classifier.classify([article])).rejects.toThrow("timed out")
  })
})

describe("classification queue", () => {
  let db: Database

  afterEach(async () => {
    await db?.dispose()
  })

  async function createPendingRepository() {
    db = createDatabase(sqlite({ name: ":memory:" }))
    const repository = new NewsRepository(db)
    await repository.init()
    await repository.ingest("zhihu", [{
      id: "queue-article",
      title: "一条模糊资讯",
      url: "https://example.com/queue",
    }], Date.now())
    return repository
  }

  it("retries low confidence once and falls back to OTHER", async () => {
    const repository = await createPendingRepository()
    const classify = vi.fn(async (articles: Array<{ id: string }>) =>
      articles.map(item => ({
        articleId: item.id,
        industry: "TECH" as const,
        confidence: 0.4,
      })))
    await processPendingClassifications(repository, { classify }, "test-model")
    expect(classify).toHaveBeenCalledTimes(2)

    const result = await repository.queryIndustryNews({
      industry: "OTHER",
      count: 10,
      hours: 24,
      sort: "hot",
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].confidence).toBe(0.4)
  })

  it("marks an article failed after three request failures", async () => {
    const repository = await createPendingRepository()
    const classify = vi.fn(async () => {
      throw new Error("request failed")
    })
    await processPendingClassifications(repository, { classify }, "test-model")
    expect(classify).toHaveBeenCalledTimes(3)
    await expect(repository.classificationCounts()).resolves.toEqual({
      pending: 0,
      failed: 1,
    })
  })
})
