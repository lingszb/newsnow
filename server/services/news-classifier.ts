import process from "node:process"
import { z } from "zod"
import { industryCodes, industryDefinitions } from "@shared/industry"
import type { IndustryCode } from "@shared/industry"
import type { NewsRepository, PendingArticle } from "#/database/news"
import { getNewsRepository } from "#/database/news"
import { getNewsSettingsRepository } from "#/database/settings"

const BATCH_SIZE = 20
const CONFIDENCE_THRESHOLD = 0.60
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
const DEFAULT_MODEL = "qwen3.6-flash-2026-04-16"

const classificationResultSchema = z.object({
  articleId: z.string().min(1),
  industry: z.enum(industryCodes),
  confidence: z.number().finite().min(0).max(1),
}).strict()

const classificationResponseSchema = z.object({
  results: z.array(classificationResultSchema).min(1).max(BATCH_SIZE),
}).strict()

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export interface ClassifierConfig {
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

export function getClassifierConfig(): ClassifierConfig {
  return {
    enabled: process.env.NEWS_CLASSIFIER_ENABLED === "true",
    endpoint: process.env.NEWS_CLASSIFIER_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    apiKey: process.env.NEWS_CLASSIFIER_API_KEY?.trim() || undefined,
    model: process.env.NEWS_CLASSIFIER_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}

export async function getResolvedClassifierConfig(): Promise<ClassifierConfig> {
  const config = getClassifierConfig()
  const settings = await getNewsSettingsRepository()
  return {
    ...config,
    model: await settings.getClassifierModel(config.model),
  }
}

function classifierPrompt(articles: PendingArticle[]) {
  const categoryText = industryDefinitions
    .map(item => `${item.code}: ${item.description}`)
    .join("\n")
  return [
    "请把每条资讯严格归入一个行业，并只返回 JSON。",
    "输出格式：{\"results\":[{\"articleId\":\"原ID\",\"industry\":\"行业代码\",\"confidence\":0到1的小数}]}。",
    "不得遗漏、增加或修改 articleId；industry 只能使用以下六个代码：",
    categoryText,
    "资讯输入：",
    JSON.stringify(articles.map(article => ({
      articleId: article.id,
      title: article.title,
      ...(article.summary ? { summary: article.summary } : {}),
    }))),
  ].join("\n")
}

function validateArticleIds(articles: PendingArticle[], results: ClassificationResult[]) {
  const expectedIds = new Set(articles.map(article => article.id))
  const actualIds = new Set(results.map(result => result.articleId))
  if (actualIds.size !== results.length)
    throw new Error("Classifier returned duplicate article IDs")
  if (expectedIds.size !== actualIds.size || [...expectedIds].some(id => !actualIds.has(id)))
    throw new Error("Classifier returned missing or unknown article IDs")
}

export class QwenNewsClassifier {
  constructor(
    private readonly config: ClassifierConfig,
    private readonly fetchImpl: ClassifierFetch = fetch,
  ) {}

  async classify(articles: PendingArticle[]): Promise<ClassificationResult[]> {
    if (articles.length < 1 || articles.length > BATCH_SIZE)
      throw new Error(`Classifier batch size must be between 1 and ${BATCH_SIZE}`)
    if (!this.config.apiKey)
      throw new Error("Classifier API key is not configured")

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
          temperature: 0,
          enable_thinking: false,
          stream: false,
          response_format: {
            type: "json_object",
          },
          messages: [
            {
              role: "system",
              content: "你是资讯行业分类器。必须输出符合指定结构的 JSON，不得输出解释或 Markdown。",
            },
            {
              role: "user",
              content: classifierPrompt(articles),
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
      const validated = classificationResponseSchema.safeParse(parsed)
      if (!validated.success)
        throw new Error("Classifier response failed local schema validation")
      validateArticleIds(articles, validated.data.results)
      return validated.data.results
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("Classifier request timed out")
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Classifier request failed"
}

export async function processPendingClassifications(
  repository: NewsRepository,
  classifier: NewsClassifier,
  model: string,
) {
  let processed = 0
  while (true) {
    const articles = await repository.getPendingClassifications(BATCH_SIZE)
    if (!articles.length) return processed

    let results: ClassificationResult[]
    try {
      results = await classifier.classify(articles)
    } catch (error) {
      await Promise.all(articles.map(article =>
        repository.recordClassificationFailure(article, safeErrorMessage(error)),
      ))
      continue
    }

    const resultsById = new Map(results.map(result => [result.articleId, result]))
    for (const article of articles) {
      const initial = resultsById.get(article.id)!
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
            { industry: "OTHER", confidence: retried.confidence },
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
      const classifier = new QwenNewsClassifier(config)
      processed += await processPendingClassifications(repository, classifier, config.model)
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
  classificationResponseSchema,
}
