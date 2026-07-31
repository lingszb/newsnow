import { queryIndustryCounts } from "#/services/industry-news"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  return await queryIndustryCounts({
    hours: query.hours,
    source: query.source,
  })
})
