import { getCacheTable } from "#/database/cache"
import { getNewsRepository } from "#/database/news"
import { requestClassificationProcessing } from "#/services/news-classifier"
import { refreshSourceNow, refreshableSourceIds } from "#/services/news-refresh"
import {
  markRefreshCompleted,
  markRefreshSkipped,
  markRefreshStarted,
} from "#/services/refresh-status"

const RUN_INTERVAL_MS = 10 * 60 * 1000
const SOURCE_CONCURRENCY = 4

let activeRun: Promise<void> | undefined

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await task(items[index])
    }
  })
  await Promise.all(workers)
}

export async function runBackgroundRefresh() {
  if (activeRun) {
    markRefreshSkipped()
    return activeRun
  }

  activeRun = (async () => {
    markRefreshStarted()
    let successfulSources = 0
    let failedSources = 0
    try {
      const ids = refreshableSourceIds()
      const now = Date.now()
      const cacheTable = await getCacheTable()
      const deletedCaches = cacheTable ? await cacheTable.cleanup(now) : 0
      const repository = await getNewsRepository()
      const deletedArticles = await repository.cleanup(now)
      const caches = cacheTable ? await cacheTable.getEntire(ids) : []
      const cacheUpdatedAt = new Map(caches.map(cache => [cache.id, cache.updated]))
      const dueIds = ids.filter(id =>
        now - (cacheUpdatedAt.get(id) ?? 0) >= sources[id].interval,
      )

      await runWithConcurrency(dueIds, SOURCE_CONCURRENCY, async (id) => {
        try {
          await refreshSourceNow(id)
          successfulSources += 1
        } catch (error) {
          failedSources += 1
          logger.error(`background refresh failed for ${id}`, error)
        }
      })

      await requestClassificationProcessing()
      logger.info(`cleanup expired data: ${deletedArticles} articles, ${deletedCaches} caches`)
    } finally {
      markRefreshCompleted(successfulSources, failedSources)
    }
  })().catch((error) => {
    logger.error("background news refresh failed", error)
  }).finally(() => {
    activeRun = undefined
  })

  return activeRun
}

export default defineNitroPlugin((nitroApp) => {
  const startupTimer = setTimeout(() => void runBackgroundRefresh(), 0)
  const interval = setInterval(() => void runBackgroundRefresh(), RUN_INTERVAL_MS)

  nitroApp.hooks.hook("close", () => {
    clearTimeout(startupTimer)
    clearInterval(interval)
  })
})

export { RUN_INTERVAL_MS, SOURCE_CONCURRENCY }
