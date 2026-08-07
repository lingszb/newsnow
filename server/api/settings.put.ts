import { z } from "zod"
import type { H3Event } from "h3"
import { sources } from "@shared/sources"
import { isConfigurableSourceId, updateNewsSettings } from "#/services/news-settings"

const modelPattern = /^[\w./:-]+$/
const industrySchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[A-Z][A-Z0-9_]*$/),
  path: z.string().trim().min(1).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(24),
  description: z.string().trim().min(1).max(200),
}).strict()

const updateSchema = z.object({
  cacheEnabled: z.boolean(),
  classifierEnabled: z.boolean(),
  classifierModel: z.string().trim().min(1).max(120).regex(modelPattern),
  industries: z.array(industrySchema).min(2).max(20),
  sources: z.array(z.object({
    id: z.string().refine(isConfigurableSourceId, "Unknown source id"),
    classificationEnabled: z.boolean(),
  }).strict()).max(Object.keys(sources).length),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>()
  for (const [index, source] of value.sources.entries()) {
    if (ids.has(source.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate source id",
        path: ["sources", index, "id"],
      })
    }
    ids.add(source.id)
  }
  const industryCodes = new Set<string>()
  const industryPaths = new Set<string>()
  for (const [index, industry] of value.industries.entries()) {
    if (industryCodes.has(industry.code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate industry code",
        path: ["industries", index, "code"],
      })
    }
    if (industryPaths.has(industry.path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate industry path",
        path: ["industries", index, "path"],
      })
    }
    industryCodes.add(industry.code)
    industryPaths.add(industry.path)
  }
})

function assertWriteAccess(event: H3Event) {
  if (event.context.user) return
  const url = getRequestURL(event)
  const origin = getHeader(event, "Origin")
  const fetchSite = getHeader(event, "Sec-Fetch-Site")
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  const sameOrigin = origin === url.origin || fetchSite === "same-origin"
  if (event.context.disabledLogin && localHost && sameOrigin) return
  throw createError({ statusCode: 403, message: "Settings can only be changed by an authenticated user or from localhost" })
}

export default defineEventHandler(async (event) => {
  assertWriteAccess(event)
  const parsed = updateSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: "Invalid settings",
      data: parsed.error.flatten(),
    })
  }
  return await updateNewsSettings(parsed.data)
})
