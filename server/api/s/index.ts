import type { SourceResponse } from "@shared/types"
import { getSourceFeed } from "#/services/news-refresh"

export default defineEventHandler(async (event): Promise<SourceResponse> => {
  try {
    const query = getQuery(event)
    const latest = query.latest !== undefined && query.latest !== "false"
    return await getSourceFeed(query.id as string | undefined, {
      latest,
      canForceRefresh: Boolean(event.context.disabledLogin || event.context.user),
    })
  } catch (e: any) {
    logger.error(e)
    throw createError({
      statusCode: e instanceof Error && e.message === "Invalid source id" ? 400 : 500,
      message: e instanceof Error ? e.message : "Internal Server Error",
    })
  }
})
