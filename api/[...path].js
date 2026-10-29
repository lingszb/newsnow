import { Readable } from "node:stream"

/**
 * Vercel -> persistent Nitro/Node proxy.
 * All /api/** requests remain same-origin in the browser.
 * Do not forward /mcp: it is intentionally private-network only.
 */
export default async function handler(req, res) {
  const origin = process.env.NEWSNOW_BACKEND_URL
  if (!origin) {
    res.status(503).json({ message: "NEWSNOW_BACKEND_URL is not configured" })
    return
  }

  let base
  try {
    base = new URL(origin)
    if (!["https:", "http:"].includes(base.protocol)) throw new Error("Invalid protocol")
  } catch {
    res.status(503).json({ message: "Invalid NEWSNOW_BACKEND_URL" })
    return
  }

  const incoming = new URL(req.url || "/api", "http://localhost")
  if (!incoming.pathname.startsWith("/api/")
      || incoming.pathname === "/api/mcp"
      || incoming.pathname.startsWith("/api/mcp/")) {
    // Never publish the private MCP transport through the Vercel proxy.
    res.status(404).end()
    return
  }

  const destination = new URL(incoming.pathname + incoming.search, base.origin)
  const headers = new Headers()
  const skip = new Set([
    "host", "connection", "transfer-encoding", "content-length",
    "accept-encoding", "x-forwarded-host", "x-forwarded-proto",
  ])
  for (const [key, value] of Object.entries(req.headers)) {
    if (skip.has(key.toLowerCase()) || value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value))
  }

  const method = req.method || "GET"
  let body
  if (method !== "GET" && method !== "HEAD") {
    if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
      body = req.body
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body)
      headers.set("content-type", "application/json")
    } else {
      body = req
    }
  }

  try {
    const upstream = await fetch(destination, {
      method,
      headers,
      body,
      ...(body === req ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    })
    res.statusCode = upstream.status
    const ignored = new Set(["connection", "transfer-encoding", "content-length", "content-encoding"])
    for (const [name, value] of upstream.headers) {
      if (!ignored.has(name.toLowerCase())) res.setHeader(name, value)
    }
    if (typeof upstream.headers.getSetCookie === "function") {
      const cookies = upstream.headers.getSetCookie()
      if (cookies.length) res.setHeader("set-cookie", cookies)
    }
    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body).pipe(res)
  } catch {
    if (!res.headersSent)
      res.status(502).json({ message: "NewsNow API backend is unavailable" })
    else
      res.end()
  }
}
