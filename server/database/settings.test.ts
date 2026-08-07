import { createDatabase } from "db0"
import sqlite from "db0/connectors/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database } from "db0"
import { industryDefinitions } from "@shared/industry"
import { NewsSettingsRepository } from "./settings"

describe("news settings repository", () => {
  let db: Database
  let repository: NewsSettingsRepository

  beforeEach(async () => {
    db = createDatabase(sqlite({ name: ":memory:" }))
    repository = new NewsSettingsRepository(db)
    await repository.init()
  })

  afterEach(async () => {
    await db.dispose()
  })

  it("uses safe defaults and persists classifier and source settings", async () => {
    await expect(repository.getClassifierModel("default-model")).resolves.toBe("default-model")
    await expect(repository.getClassifierEnabled(false)).resolves.toBe(false)
    await expect(repository.getCacheEnabled(true)).resolves.toBe(true)
    await expect(repository.getIndustryDefinitions(industryDefinitions)).resolves.toEqual(industryDefinitions)
    await expect(repository.isClassificationEnabled("zhihu")).resolves.toBe(true)

    await repository.setClassifierModel("qwen-max", 1_000)
    await repository.setClassifierEnabled(true, 1_000)
    await repository.setCacheEnabled(false, 1_000)
    await repository.setIndustryDefinitions([
      { code: "TECH", path: "tech", name: "科技前沿", description: "科技内容" },
      { code: "OTHER", path: "other", name: "其他", description: "其他内容" },
    ], 1_000)
    await repository.setClassificationEnabled("zhihu", false, 1_000)

    await expect(repository.getClassifierModel("default-model")).resolves.toBe("qwen-max")
    await expect(repository.getClassifierEnabled(false)).resolves.toBe(true)
    await expect(repository.getCacheEnabled(true)).resolves.toBe(false)
    await expect(repository.getIndustryDefinitions(industryDefinitions)).resolves.toEqual([
      { code: "TECH", path: "tech", name: "科技前沿", description: "科技内容" },
      { code: "OTHER", path: "other", name: "其他", description: "其他内容" },
    ])
    await expect(repository.isClassificationEnabled("zhihu")).resolves.toBe(false)
  })

  it("records source fetch status without changing its classification switch", async () => {
    await repository.setClassificationEnabled("zhihu", false, 1_000)
    await repository.markFetchStarted("zhihu", 2_000)
    await repository.markFetchFailed("zhihu", "upstream failed", 3_000)

    const setting = (await repository.listSourceSettings()).get("zhihu")
    expect(setting).toMatchObject({
      classification_enabled: 0,
      fetch_status: "ERROR",
      last_fetch_started_at: 2_000,
      last_fetch_completed_at: 3_000,
    })

    await repository.markFetchCompleted("zhihu", 4_000)
    expect((await repository.listSourceSettings()).get("zhihu")).toMatchObject({
      classification_enabled: 0,
      fetch_status: "SUCCESS",
      last_fetch_completed_at: 4_000,
    })

    await repository.markFetchStarted("zhihu", 5_000)
    expect((await repository.listSourceSettings()).get("zhihu")).toMatchObject({
      fetch_status: "SUCCESS",
      last_fetch_started_at: 5_000,
    })
  })
})
