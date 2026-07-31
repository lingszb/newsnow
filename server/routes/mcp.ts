import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createNewsNowMcpServer } from "#/mcp/server"
import { validateMcpAccess } from "#/mcp/security"

function jsonRpcError(message: string, code = -32000) {
  return {
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  }
}

export default defineEventHandler(async (event) => {
  const access = validateMcpAccess({
    remoteAddress: event.node.req.socket.remoteAddress,
    host: getHeader(event, "host"),
    origin: getHeader(event, "origin"),
    authorization: getHeader(event, "authorization"),
  })
  if (!access.ok) {
    setResponseStatus(event, access.statusCode)
    if (access.statusCode === 401)
      setHeader(event, "WWW-Authenticate", "Bearer")
    return jsonRpcError(access.message)
  }

  if (event.method !== "POST") {
    setResponseStatus(event, 405)
    setHeader(event, "Allow", "POST")
    return jsonRpcError("Method not allowed")
  }

  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return jsonRpcError("Invalid JSON request body", -32700)
  }

  const server = createNewsNowMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(event.node.req, event.node.res, body)
  } catch (error) {
    logger.error("MCP request failed", error)
    if (!event.node.res.headersSent) {
      setResponseStatus(event, 500)
      return jsonRpcError("Internal MCP error", -32603)
    }
  } finally {
    await transport.close()
    await server.close()
  }
})
