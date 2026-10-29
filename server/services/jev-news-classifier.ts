import { z } from "zod"
import { industryDefinitions } from "@shared/industry"
import type { IndustryDefinition } from "@shared/industry"
import type { PendingArticle } from "#/database/news"
import type { ClassifierConfig, ClassifierFetch, ClassificationResult, NewsClassifier } from "./news-classifier"

const MAX_BATCH_SIZE = 20

const jevResponseSchema = z.object({
  answers: z.record(z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().finite().min(0).max(1),
    probabilities: z.record(z.number().finite().min(0).max(1)).optional(),
  }).passthrough()),
}).passthrough()

/**
 * Batch industry classification through OpenRouter's Decisions API.
 * One typed choice question is sent for each article in a shared state.
 * API keys remain on the server. No free-form LLM output needs parsing.
 */
export class JevNewsClassifier implements NewsClassifier {
  constructor(
    private readonly config: ClassifierConfig,
    private readonly fetchImpl: ClassifierFetch = fetch,
    private readonly definitions: IndustryDefinition[] = industryDefinitions,
  ) {}

  async classify(articles: PendingArticle[]): Promise<ClassificationResult[]> {
    if (articles.length < 1 || articles.length > MAX_BATCH_SIZE)
      throw new Error(`Classifier batch size must be between 1 and ${MAX_BATCH_SIZE}`)
    if (!this.config.apiKey)
      throw new Error("Jev API key is not configured")

    const criteria = Object.fromEntries(this.definitions.map(item => [item.code, item.description]))
    const allowedCodes = new Set(this.definitions.map(item => item.code))
    const state = {
      articles: articles.map((article, index) => ({
        alias: index,
        title: article.title,
        ...(article.summary ? { summary: article.summary } : {}),
      })),
    }
    const questions = Object.fromEntries(articles.map((_article, index) => [
      `article_${index}`,
      {
        type: "choice",
        instructions: `Classify ONLY the article whose alias is ${index} in state. Based on its title and optional summary, choose the single best-fitting industry code. If none fits, choose OTHER when available.`,
        criteria,
      },
    ]))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          state,
          questions,
        }),
      })
      if (!response.ok)
        throw new Error(`Jev request failed with HTTP ${response.status}`)

      const parsed = jevResponseSchema.safeParse(await response.json())
      if (!parsed.success)
        throw new Error("Jev response failed local schema validation")

      return articles.map((article, index) => {
        const answer = parsed.data.answers[`article_${index}`]
        if (!answer || !allowedCodes.has(answer.choice))
          throw new Error(`Jev response missing or invalid article_${index} choice`)
        return {
          articleId: article.id,
          industry: answer.choice,
          confidence: answer.confidence,
        }
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("Jev request timed out")
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
