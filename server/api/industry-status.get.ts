import type { IndustryStatusResponse } from "@shared/industry"
import { getNewsRepository } from "#/database/news"
import { getResolvedClassifierConfig } from "#/services/news-classifier"
import { getRefreshStatus } from "#/services/refresh-status"

export default defineEventHandler(async (): Promise<IndustryStatusResponse> => {
  const repository = await getNewsRepository()
  const counts = await repository.classificationCounts()
  const classifier = await getResolvedClassifierConfig()
  return {
    ...getRefreshStatus(),
    pendingClassifications: counts.pending,
    failedClassifications: counts.failed,
    classifierEnabled: classifier.enabled,
    classifierConfigured: Boolean(classifier.apiKey),
  }
})
