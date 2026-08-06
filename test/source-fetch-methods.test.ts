import { describe, expect, it } from "vitest"
import { genSources } from "../shared/pre-sources"

describe("source fetch methods", () => {
  it("labels every enabled concrete source", () => {
    const sources = genSources()
    const missing = Object.entries(sources)
      .filter(([, source]) => !source.redirect && !source.fetchMethod)
      .map(([id]) => id)

    expect(missing).toEqual([])
  })
})
