/**
 * THESIS: 把跨平台行业热点呈现为一张可快速扫描的实时编辑台。
 * VISUAL: 继承 NewsNow 的中性底色、红色主色、圆角控件与紧凑信息密度。
 * COMPOSITION: 行业标签统领筛选，连续列表承担内容，状态信息退居页尾。
 * MOTION: 只用状态与交互过渡，不让资讯阅读被装饰动画打断。
 * RESPONSIVE: 桌面强调横向元数据，移动端改为标题优先的纵向条目。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link, Navigate } from "@tanstack/react-router"
import { useTitle, useWindowSize } from "react-use"
import type {
  IndustryCount,
  IndustryNewsResponse,
  IndustrySort,
  IndustryStatusResponse,
} from "@shared/industry"
import type { SourceID } from "@shared/types"
import { NavBar } from "../navbar"

const selectableSources = typeSafeObjectEntries(sources)
  .filter(([, source]) => !source.redirect)
  .map(([id, source]) => ({
    id,
    label: source.title ? `${source.name} · ${source.title}` : source.name,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="op-60 whitespace-nowrap">{label}</span>
      <select
        className={$(
          "h-9 rounded-lg bg-neutral-400/10 px-3 outline-none cursor-pointer",
          "focus-visible:ring-2 focus-visible:ring-primary/60",
        )}
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  )
}

function IndustryTabs({
  counts,
  current,
}: {
  counts?: IndustryCount[]
  current: string
}) {
  const countMap = new Map(counts?.map(item => [item.code, item.count]))
  return (
    <nav aria-label="行业分类">
      <p className="mb-2 flex md:hidden items-center justify-end gap-1 text-xs op-45">
        <span className="i-ph:arrows-horizontal-duotone" aria-hidden="true" />
        左右滑动查看全部行业
      </p>
      <div className="industry-tabs-scroll overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          {counts?.map(industry => (
            <Link
              key={industry.code}
              to="/industry/$industry"
              params={{ industry: industry.path }}
              className={$(
                "h-10 px-4 inline-flex items-center gap-2 rounded-xl text-sm cursor-pointer",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                current === industry.code
                  ? "bg-primary color-white font-bold"
                  : "bg-neutral-400/10 hover:bg-neutral-400/20",
              )}
            >
              <span>{industry.name}</span>
              <span className={$(
                "min-w-5 text-center text-xs",
                current === industry.code ? "color-white/80" : "op-55",
              )}
              >
                {countMap.get(industry.code) ?? "—"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}

function LoadingRows() {
  return (
    <div aria-label="正在加载行业资讯" className="divide-y divide-neutral-400/15 animate-pulse">
      {["one", "two", "three", "four", "five", "six"].map(key => (
        <div key={key} className="py-5 flex gap-4">
          <span className="h-8 w-8 rounded-lg bg-neutral-400/15" />
          <span className="flex-1">
            <span className="block h-5 max-w-2xl rounded bg-neutral-400/15" />
            <span className="mt-3 block h-3 max-w-md rounded bg-neutral-400/10" />
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  status,
  onRetry,
}: {
  status?: IndustryStatusResponse
  onRetry: () => void
}) {
  let title = "这个范围内还没有资讯"
  let description = "可以扩大时间范围或清除来源筛选后再试。"
  if (status && !status.classifierEnabled) {
    title = "行业分类尚未启用"
    description = "服务端已在积累资讯，配置并启用分类模型后会在这里显示结果。"
  } else if (status?.pendingClassifications) {
    title = "资讯正在分类"
    description = `还有 ${status.pendingClassifications} 条待处理，完成后会自动进入对应行业。`
  }
  return (
    <div className="min-h-72 flex flex-col items-center justify-center text-center px-6">
      <span className="i-ph:newspaper-clipping-duotone text-4xl color-primary op-70" />
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-2 max-w-md text-sm op-60">{description}</p>
      <button
        type="button"
        className="mt-5 h-9 px-4 rounded-lg bg-neutral-400/10 hover:bg-neutral-400/20 cursor-pointer"
        onClick={onRetry}
      >
        重新加载
      </button>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="min-h-72 flex flex-col items-center justify-center text-center px-6">
      <span className="i-ph:warning-circle-duotone text-4xl color-primary" />
      <h2 className="mt-4 text-lg font-bold">行业资讯加载失败</h2>
      <p className="mt-2 text-sm op-60">请检查内网服务状态，然后重新加载。</p>
      <button
        type="button"
        className="mt-5 h-9 px-4 rounded-lg bg-primary color-white cursor-pointer"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  )
}

function NewsRow({
  item,
  compact,
}: {
  item: IndustryNewsResponse["items"][number]
  compact: boolean
}) {
  const relative = useRelativeTime(item.publishedAt)
  const href = compact ? item.mobileUrl || item.url : item.url
  return (
    <article className="py-4 md:py-5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={$(
          "group grid gap-3 cursor-pointer [&_*]:cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl",
          "md:grid-cols-[44px_minmax(0,1fr)_180px] md:items-start",
        )}
      >
        <span className="h-8 min-w-8 px-1 rounded-lg bg-neutral-400/10 inline-flex items-center justify-center text-sm font-bold op-65 justify-self-start">
          {item.rank}
        </span>
        <span className="min-w-0">
          <span className="block text-base md:text-lg font-bold line-height-snug group-hover:color-primary transition-colors">
            {item.title}
          </span>
          {item.summary && (
            <span className="mt-2 block text-sm line-height-relaxed op-60 line-clamp-2 select-text">
              {item.summary}
            </span>
          )}
        </span>
        <span className="flex md:flex-col items-center md:items-end gap-2 md:gap-1 text-xs op-60">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-5 w-5 rounded-full bg-cover"
              style={{ backgroundImage: `url(/icons/${item.sourceId.split("-")[0]}.png)` }}
            />
            <span>{`${item.sourceName}${item.sourceTitle ? ` · ${item.sourceTitle}` : ""}`}</span>
          </span>
          <time dateTime={new Date(item.publishedAt).toISOString()}>
            {relative || new Date(item.publishedAt).toLocaleString("zh-CN")}
          </time>
        </span>
      </a>
      <button
        type="button"
        className="mt-2 text-xs px-2 py-1 rounded-md color-primary hover:bg-primary/10 cursor-pointer"
        onClick={() => window.dispatchEvent(new CustomEvent("newsnow:ask", { detail: { id: item.id, title: item.title } }))}
      >
        AI 解读
      </button>
    </article>
  )
}

export function IndustryPage({ industryPath }: { industryPath: string }) {
  const { width } = useWindowSize()
  const [sort, setSort] = useState<IndustrySort>("hot")
  const [hours, setHours] = useState(24)
  const [source, setSource] = useState<SourceID | "">("")
  const countsQuery = useQuery<IndustryCount[]>({
    queryKey: ["industries", hours, source],
    queryFn: () => myFetch("/industries", {
      query: {
        hours,
        ...(source ? { source } : {}),
      },
    }),
    refetchInterval: 60_000,
  })
  const definition = countsQuery.data?.find(item => item.path === industryPath)
  const industry = definition?.code
  useTitle(definition ? `NewsNow | ${definition.name}` : "NewsNow | 行业")

  const statusQuery = useQuery<IndustryStatusResponse>({
    queryKey: ["industry-status"],
    queryFn: () => myFetch("/industry-status"),
    refetchInterval: 30_000,
  })

  const newsQuery = useInfiniteQuery<IndustryNewsResponse>({
    queryKey: ["industry-news", industry ?? industryPath, hours, source, sort],
    queryFn: ({ pageParam }) => myFetch("/industry-news", {
      query: {
        industry: industry!,
        hours,
        sort,
        count: 20,
        ...(source ? { source } : {}),
        ...(pageParam ? { cursor: String(pageParam) } : {}),
      },
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor,
    enabled: Boolean(industry),
  })

  const items = newsQuery.data?.pages.flatMap(page => page.items) ?? []
  const lastRefresh = useRelativeTime(statusQuery.data?.lastCompletedAt ?? "")
  const retry = () => {
    void Promise.all([
      newsQuery.refetch(),
      countsQuery.refetch(),
      statusQuery.refetch(),
    ])
  }

  if (countsQuery.isSuccess && !definition && countsQuery.data[0]) {
    return (
      <Navigate
        to="/industry/$industry"
        params={{ industry: countsQuery.data[0].path }}
        replace
      />
    )
  }

  return (
    <section className="mx-auto max-w-6xl px-1 md:px-5">
      <div className="flex justify-center md:hidden mb-6">
        <NavBar />
      </div>

      <header className="mb-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-[-0.02em]">行业资讯</h1>
            <p className="mt-2 text-sm op-60">{definition?.description ?? "正在读取行业分类…"}</p>
          </div>
          <p className="text-xs op-55">
            {statusQuery.data?.running
              ? "后台正在刷新"
              : lastRefresh
                ? `${lastRefresh}完成刷新`
                : "等待首次刷新"}
            {statusQuery.data?.failedSources
              ? ` · ${statusQuery.data.failedSources} 个来源失败`
              : ""}
          </p>
        </div>
        <div className="mt-5">
          <IndustryTabs counts={countsQuery.data} current={industry ?? ""} />
        </div>
      </header>

      <div className="mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="inline-flex self-start rounded-xl bg-neutral-400/10 p-1" aria-label="排序方式">
          {([
            ["hot", "热度"],
            ["latest", "最新"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              className={$(
                "h-8 px-4 rounded-lg text-sm cursor-pointer transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                sort === value ? "bg-base font-bold color-primary" : "op-60 hover:op-100",
              )}
              onClick={() => setSort(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <FilterSelect
            label="来源"
            value={source}
            onChange={value => setSource(value as SourceID | "")}
          >
            <option value="">全部来源</option>
            {selectableSources.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="时间"
            value={hours}
            onChange={value => setHours(Number(value))}
          >
            <option value={24}>24 小时</option>
            <option value={72}>3 天</option>
            <option value={168}>7 天</option>
          </FilterSelect>
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-400/5 px-4 md:px-6">
        {countsQuery.isPending || newsQuery.isPending
          ? <LoadingRows />
          : countsQuery.isError || newsQuery.isError
            ? <ErrorState onRetry={retry} />
            : items.length
              ? (
                  <div className="divide-y divide-neutral-400/15">
                    {items.map(item => <NewsRow key={item.id} item={item} compact={width < 768} />)}
                  </div>
                )
              : <EmptyState status={statusQuery.data} onRetry={retry} />}
      </div>

      {newsQuery.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            disabled={newsQuery.isFetchingNextPage}
            className={$(
              "h-10 px-6 rounded-xl bg-neutral-400/10 hover:bg-neutral-400/20 cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "disabled:op-50 disabled:cursor-not-allowed",
            )}
            onClick={() => void newsQuery.fetchNextPage()}
          >
            {newsQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-between gap-2 text-xs op-50">
        <span>仅显示已完成分类的资讯</span>
        <span>
          {`待分类 ${statusQuery.data?.pendingClassifications ?? "—"}`}
          {" · "}
          {`分类失败 ${statusQuery.data?.failedClassifications ?? "—"}`}
        </span>
      </div>
    </section>
  )
}
