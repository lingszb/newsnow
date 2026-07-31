import { timingSafeEqual } from "node:crypto"
import process from "node:process"

function splitConfig(value?: string) {
  return new Set(
    value?.split(",").map(item => item.trim().toLowerCase()).filter(Boolean) ?? [],
  )
}

function normalizeAddress(address?: string) {
  if (!address) return ""
  return address.toLowerCase().replace(/^::ffff:/, "")
}

export function isPrivateAddress(address?: string) {
  const normalized = normalizeAddress(address)
  if (normalized === "::1" || normalized === "127.0.0.1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"))
    return true

  const parts = normalized.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
    return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254)
    || parts[0] === 127
}

function parseHostname(host: string) {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return ""
  }
}

export function validateHostAndOrigin(
  hostHeader: string | undefined,
  originHeader: string | undefined,
  allowedHosts = splitConfig(process.env.MCP_ALLOWED_HOSTS),
  allowedOrigins = splitConfig(process.env.MCP_ALLOWED_ORIGINS),
) {
  if (!hostHeader) return false
  const hostname = parseHostname(hostHeader)
  if (!hostname) return false
  const hostAllowed = hostname === "localhost"
    || isPrivateAddress(hostname)
    || allowedHosts.has(hostname)
    || allowedHosts.has(hostHeader.toLowerCase())
  if (!hostAllowed) return false
  if (!originHeader) return true

  try {
    const origin = new URL(originHeader)
    return origin.host.toLowerCase() === hostHeader.toLowerCase()
      || allowedOrigins.has(origin.origin.toLowerCase())
  } catch {
    return false
  }
}

export function verifyBearerToken(authorization: string | undefined, expectedToken: string | undefined) {
  if (!authorization || !expectedToken) return false
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  const actual = Buffer.from(match[1])
  const expected = Buffer.from(expectedToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function validateMcpAccess(input: {
  remoteAddress?: string
  host?: string
  origin?: string
  authorization?: string
}) {
  const token = process.env.MCP_INTERNAL_TOKEN?.trim()
  if (!token) {
    return {
      ok: false as const,
      statusCode: 503,
      message: "MCP_INTERNAL_TOKEN is not configured",
    }
  }
  if (!isPrivateAddress(input.remoteAddress)) {
    return {
      ok: false as const,
      statusCode: 403,
      message: "MCP is only available from the private network",
    }
  }
  if (!validateHostAndOrigin(input.host, input.origin)) {
    return {
      ok: false as const,
      statusCode: 403,
      message: "Invalid MCP Host or Origin",
    }
  }
  if (!verifyBearerToken(input.authorization, token)) {
    return {
      ok: false as const,
      statusCode: 401,
      message: "Invalid MCP bearer token",
    }
  }
  return { ok: true as const }
}
