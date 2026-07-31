import process from "node:process"
import { afterEach, describe, expect, it } from "vitest"
import {
  isPrivateAddress,
  validateHostAndOrigin,
  validateMcpAccess,
  verifyBearerToken,
} from "./security"

describe("MCP security", () => {
  const previousToken = process.env.MCP_INTERNAL_TOKEN

  afterEach(() => {
    if (previousToken === undefined) delete process.env.MCP_INTERNAL_TOKEN
    else process.env.MCP_INTERNAL_TOKEN = previousToken
  })

  it("recognizes private and public addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true)
    expect(isPrivateAddress("::ffff:192.168.1.20")).toBe(true)
    expect(isPrivateAddress("10.0.0.3")).toBe(true)
    expect(isPrivateAddress("8.8.8.8")).toBe(false)
  })

  it("validates Host, Origin, and bearer tokens", () => {
    expect(validateHostAndOrigin("192.168.1.5:4444", "http://192.168.1.5:4444")).toBe(true)
    expect(validateHostAndOrigin("public.example.com", undefined)).toBe(false)
    expect(verifyBearerToken("Bearer secret", "secret")).toBe(true)
    expect(verifyBearerToken("Bearer wrong", "secret")).toBe(false)
  })

  it("rejects requests outside the private authenticated boundary", () => {
    process.env.MCP_INTERNAL_TOKEN = "secret"
    expect(validateMcpAccess({
      remoteAddress: "8.8.8.8",
      host: "localhost:4444",
      authorization: "Bearer secret",
    })).toMatchObject({ ok: false, statusCode: 403 })
    expect(validateMcpAccess({
      remoteAddress: "127.0.0.1",
      host: "localhost:4444",
      authorization: "Bearer wrong",
    })).toMatchObject({ ok: false, statusCode: 401 })
    expect(validateMcpAccess({
      remoteAddress: "127.0.0.1",
      host: "localhost:4444",
      authorization: "Bearer secret",
    })).toEqual({ ok: true })
  })
})
