import process from "node:process"
import { z } from "zod"
import { industryDefinitions } from "@shared/industry"
import type { IndustryCode, IndustryDefinition } from "@shared/industry"
import type { NewsRepository, PendingArticle } from "#/database/news"
import { getNewsRepository } from "#/database/news"
import { getNewsSettingsRepository } from "#/database/settings"
import { JevNewsClassifier } from "./jev-news-classifier"
import { ClassifierArticleIdError, ClassifierTimeoutError, SplittableClassifierError } from "./classifier-errors"

const BATCH_SIZE = 20
const CONFIDENCE_THRESHOLD = 0.60
const DEFAULT_TIMEOUT_MS = 30_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
const DEFAULT_MODEL = "qwen3.6-flash-2026-04-16"
const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
const JEV_MODEL = "typesafe/jev-1.14"

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export interface ClassifierConfig {
  provider?: "qwen" | "jev"
  enabled: boolean
  endpoint: string
  apiKey?: string
  model: string
  timeoutMs: number
}

export interface ClassificationResult {
  articleId: string
  industry: IndustryCode
  confidence: number
}

export type ClassifierFetch = typeof fetch

export interface NewsClassifier {
  classify: (articles: PendingArticle[]) => Promise<ClassificationResult[]>
}

function classifierTimeoutMs(value = process.env.NEWS_CLASSIFIER_TIMEOUT_MS) {
  if (!value?.trim()) return DEFAULT_TIMEOUT_MS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS
}

function nonThinkingRequestOptions(model: string) {
  // MiniMax uses its own thinking switch and does not support JSON mode options.
  if (model.toLowerCase().includes("minimax")) {
    return {
      thinking: { type: "disabled" },
    }
  }
  return {
    temperature: 0,
    enable_thinking: false,
    response_format: {
      type: "json_object",
    },
  }
}

export function getClassifierConfig(): ClassifierConfig {
  const provider = process.env.NEWS_CLASSIFIER_PROVIDER === "jev" ? "jev" : "qwen"
  return {
    provider,
    enabled: process.env.NEWS_CLASSIFIER_ENABLED === "true",
    endpoint: provider === "jev"
      ? process.env.NEWS_JEV_ENDPOINT?.trim() || JEV_ENDPOINT
      : process.env.NEWS_CLASSIFIER_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    apiKey: provider === "jev"
      ? process.env.NEWS_JEV_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined
      : process.env.NEWS_CLASSIFIER_API_KEY?.trim() || undefined,
    model: provider === "jev"
      ? process.env.NEWS_JEV_MODEL?.trim() || JEV_MODEL
      : process.env.NEWS_CLASSIFIER_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: classifierTimeoutMs(),
  }
}

export async function getResolvedClassifierConfig(): Promise<ClassifierConfig> {
  const config = getClassifierConfig()
  const settings = await getNewsSettingsRepository()
  return {
    ...config,
    enabled: await settings.getClassifierEnabled(config.enabled),
    model: config.provider === "jev" ? config.model : await settings.getClassifierModel(config.model),
  }
}

export async function getResolvedIndustryDefinitions() {
  const settings = await getNewsSettingsRepository()
  return await settings.getIndustryDefinitions(industryDefinitions)
}

function classifierPrompt(
  articles: Array<Pick<PendingArticle, "id" | "title" | "summary">>,
  definitions: IndustryDefinition[],
) {
  const categoryText = definitions
    .map(item => `${item.code}: ${item.description}`)
    .join("\n")
  return [
    "请把每条资讯严格归入一个行业，并只返回 JSON。",
    "输出格式：{\"results\":[{\"articleId\":\"原ID\",\"industry\":\"行业代码\",\"confidence\":0到1的小数}]}。",
    "不得遗漏、增加或修改 articleId；industry 只能使用以下代码：",
    categoryText,
    "资讯输入：",
    JSON.stringify(articles.map(article => ({
      articleId: article.id,
      title: article.title,
      ...(article.summary ? { summary: article.summary } : {}),
    }))),
  ].join("\n")
}

function validateArticleIds(articles: Array<{ id: string }>, results: ClassificationResult[]) {
  const expectedIds = new Set(articles.map(article => article.id))
  const actualIds = new Set(results.map(result => result.articleId))
  if (actualIds.size !== results.length)
    throw new ClassifierArticleIdError("Classifier returned duplicate article IDs")
  if (expectedIds.size !== actualIds.size || [...expectedIds].some(id => !actualIds.has(id)))
    throw new ClassifierArticleIdError("Classifier returned missing or unknown article IDs")
}

export class QwenNewsClassifier {
  constructor(
    private readonly config: ClassifierConfig,
    private readonly fetchImpl: ClassifierFetch = fetch,
    private readonly definitions: IndustryDefinition[] = industryDefinitions,
  ) {}

  async classify(articles: PendingArticle[]): Promise<ClassificationResult[]> {
    if (articles.length < 1 || articles.length > BATCH_SIZE)
      throw new Error(`Classifier batch size must be between 1 and ${BATCH_SIZE}`)
    if (!this.config.apiKey)
      throw new Error("Classifier API key is not configured")

    const articleIdsByAlias = new Map<string, string>()
    const promptArticles = articles.map((article, index) => {
      const alias = String(index)
      articleIdsByAlias.set(alias, article.id)
      return {
        id: alias,
        title: article.title,
        ...(article.summary ? { summary: article.summary } : {}),
      }
    })
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
          ...nonThinkingRequestOptions(this.config.model),
          stream: false,
          messages: [
            {
              role: "system",
              content: "你是资讯行业分类器。必须输出符合指定结构的 JSON，不得输出解释或 Markdown。",
            },
            {
              role: "user",
              content: classifierPrompt(promptArticles, this.definitions),
            },
          ],
        }),
      })
      if (!response.ok)
        throw new Error(`Classifier request failed with HTTP ${response.status}`)

      const payload = await response.json() as ChatCompletionResponse
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error("Classifier response content is empty")

      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch {
        throw new Error("Classifier returned invalid JSON")
      }
      const allowedIndustries = new Set(this.definitions.map(item => item.code))
      const classificationResponseSchema = z.object({
        results: z.array(z.object({
          articleId: z.string().min(1),
          industry: z.string().refine(code => allowedIndustries.has(code), "Unknown industry code"),
          confidence: z.number().finite().min(0).max(1),
        }).strict()).min(1).max(BATCH_SIZE),
      }).strict()
      const validated = classificationResponseSchema.safeParse(parsed)
      if (!validated.success)
        throw new Error("Classifier response failed local schema validation")
      validateArticleIds(promptArticles, validated.data.results)
      return validated.data.results.map(result => ({
        ...result,
        articleId: articleIdsByAlias.get(result.articleId)!,
      }))
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new ClassifierTimeoutError("Classifier request timed out")
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Classifier request failed"
}

interface ClassificationAttempt {
  results: ClassificationResult[]
  failures: Array<{ article: PendingArticle, error: unknown }>
}

async function classifyWithSmallerRetry(
  classifier: NewsClassifier,
  articles: PendingArticle[],
): Promise<ClassificationAttempt> {
  try {
    return {
      results: await classifier.classify(articles),
      failures: [],
    }
  } catch (error) {
    if (!(error instanceof SplittableClassifierError) || articles.length < 2) {
      return { results: [], failures: articles.map(article => ({ article, error })) }
    }

    const middle = Math.ceil(articles.length / 2)
    // Recurse to a single record so one malformed answer does not fail its neighbors.
    const left = await classifyWithSmallerRetry(classifier, articles.slice(0, middle))
    const right = await classifyWithSmallerRetry(classifier, articles.slice(middle))
    return {
      results: [...left.results, ...right.results],
      failures: [...left.failures, ...right.failures],
    }
  }
}

export async function processPendingClassifications(
  repository: NewsRepository,
  classifier: NewsClassifier,
  model: string,
  fallbackIndustry: IndustryCode = "OTHER",
) {
  let processed = 0
  while (true) {
    const articles = await repository.getPendingClassifications(BATCH_SIZE)
    if (!articles.length) return processed

    const attempt = await classifyWithSmallerRetry(classifier, articles)
    await Promise.all(attempt.failures.map(({ article, error }) =>
      repository.recordClassificationFailure(article, safeErrorMessage(error)),
    ))

    const resultsById = new Map(attempt.results.map(result => [result.articleId, result]))
    for (const article of articles) {
      const initial = resultsById.get(article.id)
      if (!initial) continue
      if (initial.confidence >= CONFIDENCE_THRESHOLD) {
        await repository.saveClassification(article, initial, { model })
        processed += 1
        continue
      }

      try {
        const [retried] = await classifier.classify([article])
        if (retried.confidence >= CONFIDENCE_THRESHOLD) {
          await repository.saveClassification(article, retried, {
            model,
            retryAttempted: true,
          })
        } else {
          await repository.saveClassification(
            article,
            { industry: fallbackIndustry, confidence: retried.confidence },
            { model, lowConfidence: true },
          )
        }
        processed += 1
      } catch (error) {
        await repository.recordClassificationFailure(article, safeErrorMessage(error))
      }
    }
  }
}

let classificationRun: Promise<number> | undefined
let classificationRequested = false

export function requestClassificationProcessing() {
  classificationRequested = true
  if (classificationRun) return classificationRun

  classificationRun = (async () => {
    let processed = 0
    while (classificationRequested) {
      classificationRequested = false
      const config = await getResolvedClassifierConfig()
      if (!config.enabled || !config.apiKey) continue
      const repository = await getNewsRepository()
      const definitions = await getResolvedIndustryDefinitions()
      const classifier: NewsClassifier = config.provider === "jev"
        ? new JevNewsClassifier(config, fetch, definitions)
        : new QwenNewsClassifier(config, fetch, definitions)
      const fallbackIndustry = definitions.find(item => item.code === "OTHER")?.code
        ?? definitions.at(-1)?.code
        ?? "OTHER"
      processed += await processPendingClassifications(repository, classifier, config.model, fallbackIndustry)
    }
    return processed
  })().catch((error) => {
    logger.error("failed to process news classification queue", safeErrorMessage(error))
    return 0
  }).finally(() => {
    classificationRun = undefined
    if (classificationRequested) void requestClassificationProcessing()
  })

  return classificationRun
}

export {
  BATCH_SIZE,
  CONFIDENCE_THRESHOLD,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
}
