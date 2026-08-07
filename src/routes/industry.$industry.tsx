import { createFileRoute } from "@tanstack/react-router"
import { IndustryPage } from "~/components/industry"

export const Route = createFileRoute("/industry/$industry")({
  component: IndustryRoute,
})

function IndustryRoute() {
  const { industry } = Route.useParams()
  return <IndustryPage industryPath={industry.toLowerCase()} />
}
