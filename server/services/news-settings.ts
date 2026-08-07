import process from "node:process"
import type { NewsSettingsResponse, NewsSettingsUpdate, SourceFetchStatus } from "@shared/settings"
import type { SourceID } from "@shared/types"
import { industryDefinitions } from "@shared/industry"
import { sources } from "@shared/sources"
import { typeSafeObjectEntries } from "@shared/type.util"
import { CACHE_RETENTION_MS, getCacheTable } from "#/database/cache"
import { classificationVersion, getNewsRepository } from "#/database/news"
import { getNewsSettingsRepository } from "#/database/settings"
import { getResolvedClassifierConfig, requestClassificationProcessing } from "#/services/news-classifier"

export async function getNewsSettings(): Promise<NewsSettingsResponse> {
  const repository = await getNewsSettingsRepository()
  const sourceSettings = await repository.listSourceSettings()
  const cacheEnabled = await repository.getCacheEnabled(process.env.ENABLE_CACHE !== "false")
  const industries = await repository.getIndustryDefinitions(industryDefinitions)
  const sourceIds = typeSafeObjectEntries(sources)
    .filter(([, source]) => !source.redirect)
    .map(([id]) => id)
  const cacheTable = await getCacheTable()
  const caches = cacheTable ? await cacheTable.getEntire(sourceIds) : []
  const cacheTimes = new Map(caches.map(cache => [cache.id, Number(cache.updated)]))
  const classifier = await getResolvedClassifierConfig()
  const now = Date.now()

  return {
    features: {
      cacheEnabled,
    },
    classifier: {
      enabled: classifier.enabled,
      configured: Boolean(classifier.apiKey),
      model: classifier.model,
      version: classificationVersion(industries),
    },
    industries,
    sources: sourceIds.map((id) => {
      const source = sources[id]
      const setting = sourceSettings.get(id)
      const cacheTime = cacheTimes.get(id)
      let fetchStatus: SourceFetchStatus = setting?.fetch_status ?? (cacheTime ? "SUCCESS" : "NEVER")
      if (
        fetchStatus === "FETCHING"
        && setting?.last_fetch_started_at
        && now - setting.last_fetch_started_at > Math.max(source.interval * 2, 5 * 60 * 1000)
      ) {
        fetchStatus = "ERROR"
      }
      const lastFetchCompletedAt = Math.max(setting?.last_fetch_completed_at ?? 0, cacheTime ?? 0) || undefined
      return {
        id,
        name: source.name,
        ...(source.title ? { title: source.title } : {}),
        fetchMethod: source.fetchMethod,
        interval: source.interval,
        classificationEnabled: setting ? Boolean(setting.classification_enabled) : true,
        fetchStatus,
        ...(setting?.last_fetch_started_at ? { lastFetchStartedAt: setting.last_fetch_started_at } : {}),
        ...(lastFetchCompletedAt ? { lastFetchCompletedAt } : {}),
      }
    }),
  }
}

export async function getAvailableSourceIds(now = Date.now()) {
  const sourceIds = typeSafeObjectEntries(sources)
    .filter(([, source]) => !source.redirect)
    .map(([id]) => id)
  const repository = await getNewsSettingsRepository()
  const sourceSettings = await repository.listSourceSettings()
  const cacheTable = await getCacheTable()
  if (!cacheTable) {
    return sourceIds.filter(id => sourceSettings.get(id)?.fetch_status === "SUCCESS")
  }
  const caches = await cacheTable.getEntire(sourceIds)
  const cacheById = new Map(caches.map(cache => [cache.id, cache]))
  return sourceIds.filter((id) => {
    const cache = cacheById.get(id)
    return sourceSettings.get(id)?.fetch_status === "SUCCESS"
      && Boolean(cache?.items.length)
      && now - Number(cache?.updated) <= CACHE_RETENTION_MS
  })
}

export async function updateNewsSettings(update: NewsSettingsUpdate) {
  const settings = await getNewsSettingsRepository()
  const news = await getNewsRepository()
  const previousClassifierEnabled = (await getResolvedClassifierConfig()).enabled
  const previousIndustries = await settings.getIndustryDefinitions(industryDefinitions)
  const industriesChanged = JSON.stringify(previousIndustries) !== JSON.stringify(update.industries)

  await settings.setCacheEnabled(update.cacheEnabled)
  await settings.setClassifierEnabled(update.classifierEnabled)
  await settings.setClassifierModel(update.classifierModel)
  await settings.setIndustryDefinitions(update.industries)
  const version = classificationVersion(update.industries)
  let shouldProcessClassifications = false

  if (industriesChanged) {
    await news.requeueAllClassifications(version)
    shouldProcessClassifications = true
  } else if (!previousClassifierEnabled && update.classifierEnabled) {
    shouldProcessClassifications = true
  }

  for (const item of update.sources) {
    const wasEnabled = await settings.isClassificationEnabled(item.id)
    await settings.setClassificationEnabled(item.id, item.classificationEnabled)
    if (!wasEnabled && item.classificationEnabled) {
      await news.enqueueSourceForClassification(item.id, version)
      shouldProcessClassifications = true
    }
  }

  if (shouldProcessClassifications) void requestClassificationProcessing()
  return await getNewsSettings()
}

export function isConfigurableSourceId(value: string): value is SourceID {
  const source = sources[value as SourceID]
  return Boolean(source && !source.redirect)
}
