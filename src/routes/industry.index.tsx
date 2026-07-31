import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/industry/")({
  beforeLoad: () => {
    throw redirect({
      to: "/industry/$industry",
      params: { industry: "tech" },
    })
  },
})
