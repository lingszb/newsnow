import { queryIndustryNews } from "#/services/industry-news"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  return await queryIndustryNews({
    industry: query.industry,
    count: query.count,
    hours: query.hours,
    sort: query.sort,
    source: query.source,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
  })
})
