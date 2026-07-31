import { createFileRoute, redirect } from "@tanstack/react-router"
import { industryFromPath } from "@shared/industry"
import { IndustryPage } from "~/components/industry"

export const Route = createFileRoute("/industry/$industry")({
  component: IndustryRoute,
  params: {
    parse: (params) => {
      const industry = industryFromPath(params.industry)
      if (!industry) throw new Error(`"${params.industry}" is not a valid industry.`)
      return {
        industry: industry.path,
      }
    },
    stringify: params => params,
  },
  onError: (error) => {
    if (error?.routerCode === "PARSE_PARAMS") {
      throw redirect({
        to: "/industry/$industry",
        params: { industry: "tech" },
      })
    }
  },
})

function IndustryRoute() {
  const { industry: path } = Route.useParams()
  const industry = industryFromPath(path)!
  return <IndustryPage industry={industry.code} />
}
