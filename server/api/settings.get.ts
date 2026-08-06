import type { NewsSettingsResponse } from "@shared/settings"
import { getNewsSettings } from "#/services/news-settings"

export default defineEventHandler(async (): Promise<NewsSettingsResponse> => {
  return await getNewsSettings()
})
