import type { SourceFetchMethod, SourceID } from "./types"

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
  classifier: {
    enabled: boolean
    configured: boolean
    model: string
    version: string
  }
  sources: SourceSettingItem[]
}

export interface NewsSettingsUpdate {
  classifierModel: string
  sources: Array<{
    id: SourceID
    classificationEnabled: boolean
  }>
}
