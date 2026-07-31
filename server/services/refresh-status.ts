export interface RefreshStatus {
  running: boolean
  lastStartedAt?: number
  lastCompletedAt?: number
  successfulSources: number
  failedSources: number
  skippedRuns: number
}

const status: RefreshStatus = {
  running: false,
  successfulSources: 0,
  failedSources: 0,
  skippedRuns: 0,
}

export function getRefreshStatus() {
  return { ...status }
}

export function markRefreshStarted(now = Date.now()) {
  status.running = true
  status.lastStartedAt = now
}

export function markRefreshCompleted(successfulSources: number, failedSources: number, now = Date.now()) {
  status.running = false
  status.lastCompletedAt = now
  status.successfulSources = successfulSources
  status.failedSources = failedSources
}

export function markRefreshSkipped() {
  status.skippedRuns += 1
}
