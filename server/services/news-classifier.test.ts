import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "db0"
import {
  QwenNewsClassifier,
  getClassifierConfig,
  processPendingClassifications,
} from "./news-classifier"
import { NewsRepository } from "#/database/news"
import { NewsSettingsRepository } from "#/database/settings"

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

describe("qwen news classifier", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses JSON mode, omits missing summaries, and validates the result", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.temperature).toBe(0)
      expect(body.enable_thinking).toBe(false)
      expect(body.thinking).toBeUndefined()
      expect(body.response_format).toEqual({ type: "json_object" })
      expect(body.messages[1].content).not.toContain("\"summary\"")
      expect(body.messages[1].content).not.toContain(article.id)
      expect(body.messages[1].content).toContain("\"articleId\":\"0\"")
      return response({
        results: [{
          articleId: "0",
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
    "deepseek-v4-flash",
    "glm-5.2",
    "kimi-k2.6",
    "stepfun/step-3.7-flash",
  ])("disables thinking for %s", async (model) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.enable_thinking).toBe(false)
      expect(body.thinking).toBeUndefined()
      return response({
        results: [{ articleId: "0", industry: "TECH", confidence: 0.9 }],
      })
    })
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model,
      timeoutMs: 100,
    }, fetchMock as typeof fetch)

    await expect(classifier.classify([article])).resolves.toHaveLength(1)
  })

  it("uses the MiniMax non-thinking parameter without unsupported JSON mode options", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.thinking).toEqual({ type: "disabled" })
      expect(body.enable_thinking).toBeUndefined()
      expect(body.temperature).toBeUndefined()
      expect(body.response_format).toBeUndefined()
      return response({
        results: [{ articleId: "0", industry: "TECH", confidence: 0.9 }],
      })
    })
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "MiniMax/MiniMax-M3",
      timeoutMs: 100,
    }, fetchMock as typeof fetch)

    await expect(classifier.classify([article])).resolves.toHaveLength(1)
  })

  it("reads a bounded timeout from the environment", () => {
    vi.stubEnv("NEWS_CLASSIFIER_TIMEOUT_MS", "45000")
    expect(getClassifierConfig().timeoutMs).toBe(45_000)

    vi.stubEnv("NEWS_CLASSIFIER_TIMEOUT_MS", "0")
    expect(getClassifierConfig().timeoutMs).toBe(30_000)

    vi.stubEnv("NEWS_CLASSIFIER_TIMEOUT_MS", "not-a-number")
    expect(getClassifierConfig().timeoutMs).toBe(30_000)
  })

  it.each([
    ["invalid JSON", "{not-json"],
    ["illegal industry", {
      results: [{ articleId: "0", industry: "UNKNOWN", confidence: 0.8 }],
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

  it("uses the configured industry definitions for prompts and validation", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.messages[1].content).toContain("ENERGY: 能源与电力")
      return response({
        results: [{ articleId: "0", industry: "ENERGY", confidence: 0.9 }],
      })
    })
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "qwen3.7-flash",
      timeoutMs: 100,
    }, fetchMock as typeof fetch, [
      { code: "ENERGY", path: "energy", name: "能源", description: "能源与电力" },
      { code: "OTHER", path: "other", name: "其他", description: "其他内容" },
    ])

    await expect(classifier.classify([article])).resolves.toEqual([
      { articleId: article.id, industry: "ENERGY", confidence: 0.9 },
    ])
  })
})

describe("classification queue", () => {
  let db: Database

  afterEach(async () => {
    await db?.dispose()
  })

  async function createPendingRepository(items = [{
    id: "queue-article",
    title: "一条模糊资讯",
    url: "https://example.com/queue",
  }]) {
    db = createDatabase(sqlite({ name: ":memory:" }))
    const repository = new NewsRepository(db)
    await repository.init()
    const settings = new NewsSettingsRepository(db)
    await settings.init()
    await settings.markFetchCompleted("zhihu")
    await repository.ingest("zhihu", items, Date.now())
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

  it.each(["timeout", "article IDs"])("retries a recoverable %s failure in smaller batches", async (failure) => {
    const repository = await createPendingRepository([{
      id: "queue-article-a",
      title: "第一条资讯",
      url: "https://example.com/queue-a",
    }, {
      id: "queue-article-b",
      title: "第二条资讯",
      url: "https://example.com/queue-b",
    }])
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = String(body.messages[1].content)
      const inputs = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as Array<{ articleId: string }>
      if (inputs.length > 1 && failure === "timeout") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          })
        })
      }
      if (inputs.length > 1) {
        return Promise.resolve(response({
          results: [{ articleId: "unknown", industry: "TECH", confidence: 0.9 }],
        }))
      }
      return Promise.resolve(response({
        results: inputs.map(input => ({
          articleId: input.articleId,
          industry: "TECH",
          confidence: 0.9,
        })),
      }))
    })
    const classifier = new QwenNewsClassifier({
      enabled: true,
      endpoint: "https://example.com/chat/completions",
      apiKey: "test-key",
      model: "qwen3.7-flash",
      timeoutMs: 5,
    }, fetchMock as typeof fetch)

    await processPendingClassifications(repository, classifier, "test-model")

    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(repository.classificationCounts()).resolves.toEqual({
      pending: 0,
      failed: 0,
    })
    const result = await repository.queryIndustryNews({
      industry: "TECH",
      count: 10,
      hours: 24,
      sort: "hot",
    })
    expect(result.items).toHaveLength(2)
  })
})
