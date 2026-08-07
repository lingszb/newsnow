import type { SourceFetchMethod, SourceID } from "./types"
import type { IndustryDefinition } from "./industry"

export type SourceFetchStatus = "NEVER" | "FETCHING" | "SUCCESS" | "ERROR"

export interface SourceSettingItem {
  id: SourceID
  name: string
  title?: string
  fetchMethod: SourceFetchMethod
  interval: number
  classificationEnabled: boolean
  fetchStatus: SourceFetchStatus
  lastFetchStartedAt?: number
  lastFetchCompletedAt?: number
  lastFetchError?: string
}

export interface NewsSettingsResponse {
  features: {
    cacheEnabled: boolean
  }
  classifier: {
    enabled: boolean
    configured: boolean
    model: string
    version: string
  }
  industries: IndustryDefinition[]
  sources: SourceSettingItem[]
}

export interface NewsSettingsUpdate {
  cacheEnabled: boolean
  classifierEnabled: boolean
  classifierModel: string
  industries: IndustryDefinition[]
  sources: Array<{
    id: SourceID
    classificationEnabled: boolean
  }>
}
