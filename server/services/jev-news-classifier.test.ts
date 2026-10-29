import { afterEach, describe, expect, it, vi } from "vitest"
import { getClassifierConfig } from "./news-classifier"
import { JevNewsClassifier } from "./jev-news-classifier"

const article = { id: "original-article-id", title: "新一代 AI 芯片发布", inputHash: "hash", retryCount: 0 }

function jevResponse(answers: Record<string, unknown>) {
  return new Response(JSON.stringify({ answers }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("jev news classifier", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("uses the Decisions API and matches answer IDs back to original articles", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("typesafe/jev-1.14")
      expect(body.messages).toBeUndefined()
      expect(body.state.articles).toEqual([
        { alias: 0, title: article.title },
        { alias: 1, title: "某款游戏上线", summary: "游戏发行" },
      ])
      expect(body.questions.article_0.type).toBe("choice")
      expect(body.questions.article_0.criteria.TECH).toBeDefined()
      expect(body.questions.article_0.instructions).toContain("alias is 0")
      return jevResponse({
        article_0: { type: "choice", choice: "TECH", confidence: 0.95, probabilities: { TECH: 0.95 } },
        article_1: { type: "choice", choice: "ENTERTAINMENT_SPORTS", confidence: 0.87 },
      })
    })
    const classifier = new JevNewsClassifier({
      provider: "jev",
      enabled: true,
      endpoint: "https://openrouter.ai/api/alpha/decisions",
      apiKey: "test-key",
      model: "typesafe/jev-1.14",
      timeoutMs: 1000,
    }, fetchMock as typeof fetch)
    await expect(classifier.classify([
      article,
      { ...article, id: "game-id", title: "某款游戏上线", summary: "游戏发行" },
    ])).resolves.toEqual([
      { articleId: article.id, industry: "TECH", confidence: 0.95 },
      { articleId: "game-id", industry: "ENTERTAINMENT_SPORTS", confidence: 0.87 },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a missing or unknown category", async () => {
    const classifier = new JevNewsClassifier({
      provider: "jev",
      enabled: true,
      endpoint: "https://example.com/decisions",
      apiKey: "test-key",
      model: "typesafe/jev-1.14",
      timeoutMs: 1000,
    }, vi.fn(async () => jevResponse({
      article_0: { type: "choice", choice: "NOT_A_CATEGORY", confidence: 0.99 },
    })) as typeof fetch)
    await expect(classifier.classify([article])).rejects.toThrow("missing or invalid")
  })

  it("uses an isolated OpenRouter credential and ignores the Qwen endpoint", () => {
    vi.stubEnv("NEWS_CLASSIFIER_PROVIDER", "jev")
    vi.stubEnv("OPENROUTER_API_KEY", "jev-test-key")
    vi.stubEnv("NEWS_CLASSIFIER_API_KEY", "qwen-test-key")
    const config = getClassifierConfig()
    expect(config.provider).toBe("jev")
    expect(config.apiKey).toBe("jev-test-key")
    expect(config.endpoint).toBe("https://openrouter.ai/api/alpha/decisions")
    expect(config.model).toBe("typesafe/jev-1.14")
  })
})
