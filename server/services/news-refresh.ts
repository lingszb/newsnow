import type { SourceID, SourceResponse } from "@shared/types"
import { sources } from "@shared/sources"
import { getters } from "#/getters"
import { getCacheTable } from "#/database/cache"
import { getNewsRepository } from "#/database/news"
import { getNewsSettingsRepository } from "#/database/settings"
import type { CacheInfo } from "#/types"
import { requestClassificationProcessing } from "#/services/news-classifier"

const info = {
  LICENCE: "MIT",
  Github: "https://github.com/ourongxing/newsnow",
  Sponsorship: "If you rely on this service, sponsorship is welcome to help it run for the long term. Scan the QR code https://raw.githubusercontent.com/ourongxing/newsnow/main/screenshots/reward.gif",
}

const inFlightSources = new Map<SourceID, Promise<SourceResponse>>()

export function resolveSourceId(value: string | undefined): SourceID {
  let id = value as SourceID
  const invalid = (candidate: SourceID) => !candidate || !sources[candidate] || !getters[candidate]
  if (invalid(id)) {
    const redirectId = sources?.[id]?.redirect
    if (redirectId) id = redirectId
  }
  if (invalid(id)) throw new Error("Invalid source id")
  return id
}

async function persistArticles(id: SourceID, items: SourceResponse["items"]) {
  try {
    const settings = await getNewsSettingsRepository()
    const classificationEnabled = await settings.isClassificationEnabled(id)
    const repository = await getNewsRepository()
    const changed = await repository.ingest(id, items, Date.now(), classificationEnabled)
    if (changed && classificationEnabled) void requestClassificationProcessing()
  } catch (error) {
    logger.error(`failed to persist articles for ${id}`, error)
  }
}

export function refreshSourceNow(id: SourceID) {
  const existing = inFlightSources.get(id)
  if (existing) return existing

  const refresh = (async (): Promise<SourceResponse> => {
    const now = Date.now()
    const settings = await getNewsSettingsRepository()
    await settings.markFetchStarted(id, now)
    try {
      const items = (await getters[id]()).slice(0, 30)
      const cacheTable = await getCacheTable()
      if (cacheTable && items.length) await cacheTable.set(id, items)
      if (items.length) await persistArticles(id, items)
      await settings.markFetchCompleted(id)
      logger.success(`fetch ${id} latest`)
      return {
        status: "success",
        id,
        updatedTime: now,
        items,
        info,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source fetch failed"
      await settings.markFetchFailed(id, message)
      throw error
    }
  })().finally(() => {
    inFlightSources.delete(id)
  })

  inFlightSources.set(id, refresh)
  return refresh
}

export async function getSourceFeed(
  sourceId: string | undefined,
  options: { latest?: boolean, canForceRefresh?: boolean } = {},
): Promise<SourceResponse> {
  const id = resolveSourceId(sourceId)
  const cacheTable = await getCacheTable()
  const now = Date.now()
  let cache: CacheInfo | undefined

  if (cacheTable) {
    cache = await cacheTable.get(id)
    if (cache && now - cache.updated < sources[id].interval) {
      return {
        status: "success",
        id,
        updatedTime: now,
        items: cache.items,
        info,
      }
    }
    if (
      cache
      && now - cache.updated < TTL
      && (!options.latest || !options.canForceRefresh)
    ) {
      return {
        status: "cache",
        id,
        updatedTime: cache.updated,
        items: cache.items,
        info,
      }
    }
  }

  try {
    return await refreshSourceNow(id)
  } catch (error) {
    if (cache) {
      return {
        status: "cache",
        id,
        updatedTime: cache.updated,
        items: cache.items,
        info,
      }
    }
    throw error
  }
}

export function refreshableSourceIds() {
  return typeSafeObjectEntries(sources)
    .filter(([id, source]) => !source.redirect && Boolean(getters[id]))
    .map(([id]) => id)
}
