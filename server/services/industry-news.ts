import { Buffer } from "node:buffer"
import type { SourceID } from "@shared/types"
import { sources } from "@shared/sources"
import type { IndustryCode, IndustryDefinition, IndustryNewsResponse, IndustrySort } from "@shared/industry"
import { getNewsRepository } from "#/database/news"
import { getResolvedIndustryDefinitions } from "#/services/news-classifier"

interface CursorPayload {
  offset: number
}

function decodeCursor(cursor?: string) {
  if (!cursor) return 0
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload
    if (!Number.isSafeInteger(payload.offset) || payload.offset < 0) throw new Error("Invalid cursor offset")
    return payload.offset
  } catch {
    throw createError({ statusCode: 400, message: "Invalid cursor" })
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url")
}

export function parseIndustryCode(value: unknown, definitions: IndustryDefinition[], fallback?: IndustryCode) {
  const code = String(value ?? fallback ?? definitions[0]?.code ?? "").toUpperCase() as IndustryCode
  if (!definitions.some(item => item.code === code))
    throw createError({ statusCode: 400, message: "Invalid industry" })
  return code
}

export function parseHours(value: unknown, fallback = 24) {
  const hours = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(hours) || hours < 1 || hours > 168)
    throw createError({ statusCode: 400, message: "hours must be an integer between 1 and 168" })
  return hours
}

export function parseCount(value: unknown, fallback = 10, maximum = 50) {
  const count = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(count) || count < 1 || count > maximum)
    throw createError({ statusCode: 400, message: `count must be an integer between 1 and ${maximum}` })
  return count
}

export function parseSort(value: unknown, fallback: IndustrySort = "hot") {
  const sort = String(value ?? fallback) as IndustrySort
  if (sort !== "hot" && sort !== "latest")
    throw createError({ statusCode: 400, message: "sort must be hot or latest" })
  return sort
}

export function parseSource(value: unknown) {
  if (value === undefined || value === "") return undefined
  const source = String(value) as SourceID
  if (!sources[source] || sources[source].redirect)
    throw createError({ statusCode: 400, message: "Invalid source" })
  return source
}

export async function queryIndustryNews(input: {
  industry?: unknown
  count?: unknown
  hours?: unknown
  sort?: unknown
  source?: unknown
  cursor?: string
  maximumCount?: number
}): Promise<IndustryNewsResponse> {
  const definitions = await getResolvedIndustryDefinitions()
  const industry = parseIndustryCode(input.industry, definitions)
  const count = parseCount(input.count, 10, input.maximumCount ?? 50)
  const hours = parseHours(input.hours)
  const sort = parseSort(input.sort)
  const source = parseSource(input.source)
  const offset = decodeCursor(input.cursor)
  const repository = await getNewsRepository()
  const result = await repository.queryIndustryNews({
    industry,
    count,
    hours,
    sort,
    source,
    offset,
  })
  return {
    items: result.items,
    ...(result.hasMore ? { nextCursor: encodeCursor(offset + count) } : {}),
  }
}

export async function queryIndustryCounts(input: { hours?: unknown, source?: unknown }) {
  const hours = parseHours(input.hours)
  const source = parseSource(input.source)
  const repository = await getNewsRepository()
  const definitions = await getResolvedIndustryDefinitions()
  return await repository.industryCounts(hours, source, Date.now(), definitions)
}
