import { useQuery } from "@tanstack/react-query"
import { Navigate, createFileRoute } from "@tanstack/react-router"
import type { IndustryCount } from "@shared/industry"

export const Route = createFileRoute("/industry/")({
  component: IndustryIndex,
})

function IndustryIndex() {
  const query = useQuery<IndustryCount[]>({
    queryKey: ["industries", 24, ""],
    queryFn: () => myFetch("/industries", { query: { hours: 24 } }),
  })
  const first = query.data?.[0]
  if (first) {
    return <Navigate to="/industry/$industry" params={{ industry: first.path }} replace />
  }
  return (
    <div className="min-h-64 flex items-center justify-center text-sm op-60">
      {query.isError ? "行业分类读取失败" : "正在读取行业分类…"}
    </div>
  )
}
