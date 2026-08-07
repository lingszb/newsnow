import process from "node:process"
import mcpHandler from "../routes/mcp"

export default defineEventHandler(async (event) => {
  if (process.env.NEWSNOW_VITE_DEV_MCP !== "true")
    throw createError({ statusCode: 404, message: "Not found" })
  return await mcpHandler(event)
})
