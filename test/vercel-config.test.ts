import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  rewrites: Array<{ source: string, destination: string }>
}

describe("Vercel SPA fallback", () => {
  const rewrite = config.rewrites.find(item => item.destination === "/index.html")!
  const matches = new RegExp(`^${rewrite.source}$`)

  it("keeps APIs out of the SPA rewrite", () => {
    expect(matches.test("/api/latest")).toBe(false)
    expect(matches.test("/api/agent/chat")).toBe(false)
    expect(matches.test("/api")).toBe(false)
  })

  it("serves deep-linked app routes", () => {
    expect(matches.test("/")).toBe(true)
    expect(matches.test("/industry/tech")).toBe(true)
    expect(matches.test("/c/focus")).toBe(true)
  })
})
