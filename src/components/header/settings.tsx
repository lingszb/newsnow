import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createPortal } from "react-dom"
import type { NewsSettingsResponse, NewsSettingsUpdate, SourceFetchStatus } from "@shared/settings"
import type { IndustryDefinition } from "@shared/industry"

interface EditableIndustry extends IndustryDefinition {
  editorId: number
}

const statusMetadata: Record<SourceFetchStatus, { label: string, className: string }> = {
  NEVER: { label: "尚未抓取", className: "bg-neutral-400/10 op-60" },
  FETCHING: { label: "抓取中", className: "bg-blue-500/10 color-blue-600 dark:color-blue-300" },
  SUCCESS: { label: "正常", className: "bg-green-500/10 color-green-700 dark:color-green-300" },
  ERROR: { label: "失败", className: "bg-red-500/10 color-red-700 dark:color-red-300" },
}

function formatInterval(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`
}

function formatTime(value?: number) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—"
}

function Switch({ checked, onChange, label }: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={$(
        "relative h-6 w-11 rounded-full cursor-pointer transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        checked ? "bg-primary" : "bg-neutral-400/30",
      )}
      onClick={() => onChange(!checked)}
    >
      <span className={$(
        "absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-5" : "translate-x-0",
      )}
      />
    </button>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { enableLogin, loggedIn, login } = useLogin()
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const nextIndustryId = useRef(0)
  const [search, setSearch] = useState("")
  const [classifierEnabled, setClassifierEnabled] = useState(false)
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [model, setModel] = useState("")
  const [industries, setIndustries] = useState<EditableIndustry[]>([])
  const [sourceSettings, setSourceSettings] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState("")
  const settingsQuery = useQuery<NewsSettingsResponse>({
    queryKey: ["news-settings"],
    queryFn: () => myFetch("/settings"),
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setClassifierEnabled(settingsQuery.data.classifier.enabled)
    setCacheEnabled(settingsQuery.data.features.cacheEnabled)
    setModel(settingsQuery.data.classifier.model)
    setIndustries(settingsQuery.data.industries.map(industry => ({
      ...industry,
      editorId: nextIndustryId.current++,
    })))
    setSourceSettings(Object.fromEntries(
      settingsQuery.data.sources.map(source => [source.id, source.classificationEnabled]),
    ))
  }, [settingsQuery.data])

  useEffect(() => {
    closeButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key !== "Tab" || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
      )]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  const mutation = useMutation<NewsSettingsResponse, Error, NewsSettingsUpdate>({
    mutationFn: async body => await myFetch("/settings", {
      method: "PUT",
      headers: {
        ...(safeParseString(localStorage.getItem("jwt"))
          ? { Authorization: `Bearer ${safeParseString(localStorage.getItem("jwt"))}` }
          : {}),
      },
      body,
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(["news-settings"], data)
      void queryClient.invalidateQueries({
        predicate: query => ["industry-news", "industries", "industry-status"].includes(String(query.queryKey[0])),
      })
      onClose()
    },
    onError: error => setSaveError(error.message || "保存失败"),
  })

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleSources = settingsQuery.data?.sources.filter((source) => {
    if (!normalizedSearch) return true
    return [source.id, source.name, source.title].some(value => value?.toLocaleLowerCase().includes(normalizedSearch))
  }) ?? []
  const normalizedIndustries = industries.map(industry => ({
    code: industry.code.trim().toUpperCase(),
    path: industry.path.trim().toLowerCase(),
    name: industry.name.trim(),
    description: industry.description.trim(),
  }))
  const industryCodes = normalizedIndustries.map(industry => industry.code)
  const industryPaths = normalizedIndustries.map(industry => industry.path)
  const industriesValid = normalizedIndustries.length >= 2
    && normalizedIndustries.every(industry => (
      /^[A-Z][A-Z0-9_]{1,31}$/.test(industry.code)
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(industry.path)
      && Boolean(industry.name)
      && Boolean(industry.description)
    ))
    && new Set(industryCodes).size === industryCodes.length
    && new Set(industryPaths).size === industryPaths.length

  const updateIndustry = (index: number, field: keyof IndustryDefinition, value: string) => {
    setIndustries(current => current.map((industry, itemIndex) => (
      itemIndex === index ? { ...industry, [field]: value } : industry
    )))
  }
  const moveIndustry = (index: number, direction: -1 | 1) => {
    setIndustries((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const submit = () => {
    if (!settingsQuery.data || !model.trim() || !industriesValid) return
    setSaveError("")
    mutation.mutate({
      cacheEnabled,
      classifierEnabled,
      classifierModel: model.trim(),
      industries: normalizedIndustries,
      sources: settingsQuery.data.sources.map(source => ({
        id: source.id,
        classificationEnabled: sourceSettings[source.id] ?? true,
      })),
    })
  }

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/45 p-3 md:p-6"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl bg-base color-base shadow-2xl flex flex-col"
      >
        <header className="flex items-start justify-between gap-4 border-b border-neutral-400/15 px-5 py-4 md:px-6">
          <div>
            <h2 id="settings-title" className="text-xl font-bold">设置</h2>
            <p className="mt-1 text-sm op-60">管理运行时功能、行业分类和各数据源状态。</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="关闭设置"
            className="i-ph:x-duotone btn text-xl"
            onClick={onClose}
          />
        </header>

        {settingsQuery.isPending
          ? (
              <div className="min-h-96 flex items-center justify-center gap-2 op-60">
                <span className="i-ph:circle-dashed-duotone animate-spin text-xl" />
                正在读取设置
              </div>
            )
          : settingsQuery.isError
            ? (
                <div role="alert" className="min-h-96 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="i-ph:warning-circle-duotone text-3xl color-primary" />
                  <p className="font-bold">设置读取失败</p>
                  <button type="button" className="h-9 rounded-lg bg-neutral-400/10 px-4 cursor-pointer" onClick={() => void settingsQuery.refetch()}>
                    重新读取
                  </button>
                </div>
              )
            : (
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
                  <section aria-labelledby="feature-settings-title">
                    <h3 id="feature-settings-title" className="font-bold">功能开关</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-400/15 px-4 py-3">
                        <div>
                          <p className="text-sm font-bold">行业分类服务</p>
                          <p className="mt-1 text-xs op-60">控制分类队列是否调用模型；关闭后保留现有分类结果。</p>
                        </div>
                        <Switch checked={classifierEnabled} label="启用行业分类服务" onChange={setClassifierEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-400/15 px-4 py-3">
                        <div>
                          <p className="text-sm font-bold">数据缓存</p>
                          <p className="mt-1 text-xs op-60">控制 SQLite 热点缓存；关闭后数据源请求会直接刷新。</p>
                        </div>
                        <Switch checked={cacheEnabled} label="启用数据缓存" onChange={setCacheEnabled} />
                      </div>
                    </div>
                  </section>

                  <section className="mt-7" aria-labelledby="classifier-settings-title">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id="classifier-settings-title" className="font-bold">分类模型 · {settingsQuery.data?.classifier.provider === "jev" ? "JEV Decisions" : "Qwen / Chat Completions"}</h3>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className={$(
                          "rounded-full px-2 py-1",
                          classifierEnabled
                            ? "bg-green-500/10 color-green-700 dark:color-green-300"
                            : "bg-amber-500/10 color-amber-700 dark:color-amber-300",
                        )}
                        >
                          {classifierEnabled ? "分类服务将启用" : "分类服务将关闭"}
                        </span>
                        <span className="rounded-full bg-neutral-400/10 px-2 py-1 op-70">
                          {settingsQuery.data?.classifier.configured ? "API Key 已配置" : "API Key 未配置"}
                        </span>
                      </div>
                    </div>
                    <label className="mt-3 block">
                      <span className="text-sm op-65">模型名称</span>
                      <input
                        value={model}
                        disabled={settingsQuery.data?.classifier.provider === "jev"}
                        maxLength={120}
                        spellCheck={false}
                        className="mt-2 h-10 w-full rounded-xl bg-neutral-400/10 px-3 outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                        placeholder="例如 qwen-max"
                        onChange={event => setModel(event.target.value)}
                      />
                    </label>
                    {classifierEnabled && !settingsQuery.data?.classifier.configured && (
                      <p className="mt-2 text-xs color-amber-700 dark:color-amber-300">
                        {settingsQuery.data?.classifier.provider === "jev" ? "NEWS_JEV_API_KEY / OPENROUTER_API_KEY" : "NEWS_CLASSIFIER_API_KEY"} 尚未配置；开关会保存，但分类队列暂时无法调用模型。
                      </p>
                    )}
                    <p className="mt-2 text-xs op-55">
                      {settingsQuery.data?.classifier.provider === "jev" ? "JEV 模型通过 NEWS_JEV_MODEL 环境变量设置；需切换 NEWS_CLASSIFIER_PROVIDER 才能切换分类器。" : "API Key、请求端点和分类版本仍由环境变量管理，避免在页面和设置接口中"}暴露敏感或部署级配置。
                    </p>
                    {enableLogin && !loggedIn && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-neutral-400/10 px-3 py-2 text-xs">
                        <span className="op-65">当前服务要求登录后才能保存设置。</span>
                        <button type="button" className="shrink-0 color-primary font-bold cursor-pointer" onClick={login}>前往登录</button>
                      </div>
                    )}
                  </section>

                  <section className="mt-7" aria-labelledby="industry-settings-title">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 id="industry-settings-title" className="font-bold">行业分类</h3>
                        <p className="mt-1 text-xs op-60">可编辑名称、模型代码、页面路径和分类说明；顺序同时决定页面标签顺序。</p>
                      </div>
                      <button
                        type="button"
                        disabled={industries.length >= 20}
                        className="h-9 rounded-lg bg-neutral-400/10 px-3 text-sm cursor-pointer disabled:op-45 disabled:cursor-not-allowed"
                        onClick={() => setIndustries(current => [...current, {
                          code: "",
                          path: "",
                          name: "",
                          description: "",
                          editorId: nextIndustryId.current++,
                        }])}
                      >
                        添加行业
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {industries.map((industry, index) => (
                        <fieldset key={industry.editorId} className="rounded-xl border border-neutral-400/15 p-3 md:p-4">
                          <legend className="sr-only">{`第 ${index + 1} 个行业分类`}</legend>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                            <label>
                              <span className="text-xs op-60">显示名称</span>
                              <input
                                value={industry.name}
                                maxLength={24}
                                className="mt-1 h-9 w-full rounded-lg bg-neutral-400/10 px-3 text-sm outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                                placeholder="例如 科技"
                                onChange={event => updateIndustry(index, "name", event.target.value)}
                              />
                            </label>
                            <label>
                              <span className="text-xs op-60">模型代码</span>
                              <input
                                value={industry.code}
                                maxLength={32}
                                spellCheck={false}
                                className="mt-1 h-9 w-full rounded-lg bg-neutral-400/10 px-3 text-sm uppercase outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                                placeholder="例如 TECH"
                                onChange={event => updateIndustry(index, "code", event.target.value.toUpperCase())}
                              />
                            </label>
                            <label>
                              <span className="text-xs op-60">页面路径</span>
                              <input
                                value={industry.path}
                                maxLength={50}
                                spellCheck={false}
                                className="mt-1 h-9 w-full rounded-lg bg-neutral-400/10 px-3 text-sm lowercase outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                                placeholder="例如 tech"
                                onChange={event => updateIndustry(index, "path", event.target.value.toLowerCase())}
                              />
                            </label>
                            <div className="flex gap-1">
                              <button type="button" aria-label={`上移${industry.name || `第 ${index + 1} 项`}`} disabled={index === 0} className="btn disabled:op-30" onClick={() => moveIndustry(index, -1)}>
                                <span className="i-ph:arrow-up-duotone" />
                              </button>
                              <button type="button" aria-label={`下移${industry.name || `第 ${index + 1} 项`}`} disabled={index === industries.length - 1} className="btn disabled:op-30" onClick={() => moveIndustry(index, 1)}>
                                <span className="i-ph:arrow-down-duotone" />
                              </button>
                              <button type="button" aria-label={`删除${industry.name || `第 ${index + 1} 项`}`} disabled={industries.length <= 2} className="h-9 px-3 rounded-lg border border-color-primary/40 text-sm color-primary cursor-pointer transition-colors hover:bg-color-primary/10 disabled:op-30 disabled:cursor-not-allowed" onClick={() => setIndustries(current => current.filter((_, itemIndex) => itemIndex !== index))}>
                                删除
                              </button>
                            </div>
                          </div>
                          <label className="mt-3 block">
                            <span className="text-xs op-60">分类说明</span>
                            <textarea
                              value={industry.description}
                              maxLength={200}
                              rows={2}
                              className="mt-1 w-full resize-y rounded-lg bg-neutral-400/10 px-3 py-2 text-sm outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                              placeholder="描述该行业应包含的资讯范围"
                              onChange={event => updateIndustry(index, "description", event.target.value)}
                            />
                          </label>
                        </fieldset>
                      ))}
                    </div>
                    {!industriesValid && (
                      <p role="alert" className="mt-2 text-xs color-primary">
                        至少保留 2 个行业；代码需为大写字母、数字或下划线，路径需为小写英文、数字或连字符，且代码和路径不能重复。
                      </p>
                    )}
                    <p className="mt-2 text-xs op-55">修改行业后，现有可用数据源中的资讯会重新进入分类队列。</p>
                  </section>

                  <section className="mt-7" aria-labelledby="source-settings-title">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 id="source-settings-title" className="font-bold">数据源</h3>
                        <p className="mt-1 text-xs op-60">
                          开启分类后可进入 MCP 行业工具；关闭后仍可通过 MCP 数据源工具按来源 ID 或名称获取。
                        </p>
                      </div>
                      <label className="relative block sm:w-64">
                        <span className="sr-only">搜索数据源</span>
                        <span className="i-ph:magnifying-glass-duotone absolute left-3 top-2.5 op-45" />
                        <input
                          value={search}
                          className="h-9 w-full rounded-xl bg-neutral-400/10 pl-9 pr-3 text-sm outline-none select-text focus-visible:ring-2 focus-visible:ring-primary/60"
                          placeholder="搜索名称或 ID"
                          onChange={event => setSearch(event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="mt-3 overflow-hidden rounded-xl border border-neutral-400/15">
                      <div className="hidden md:grid grid-cols-[minmax(0,1.5fr)_100px_120px_180px_92px] gap-3 bg-neutral-400/8 px-4 py-2 text-xs op-55">
                        <span>数据源</span>
                        <span>状态</span>
                        <span>抓取间隔</span>
                        <span>最近抓取</span>
                        <span className="text-right">进入分类</span>
                      </div>
                      <div className="divide-y divide-neutral-400/15">
                        {visibleSources.map((source) => {
                          const status = statusMetadata[source.fetchStatus]
                          return (
                            <div key={source.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_100px_120px_180px_92px] md:items-center">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold">
                                  {source.name}
                                  {source.title ? ` · ${source.title}` : ""}
                                </p>
                                <p className="mt-0.5 truncate text-xs op-45">
                                  {source.id}
                                  {" "}
                                  ·
                                  {" "}
                                  {source.fetchMethod.toUpperCase()}
                                </p>
                              </div>
                              <div>
                                <span className={$("inline-flex rounded-full px-2 py-1 text-xs", status.className)}>{status.label}</span>
                              </div>
                              <p className="text-xs op-65">
                                <span className="md:hidden">抓取间隔：</span>
                                {formatInterval(source.interval)}
                              </p>
                              <p className="text-xs op-65">
                                <span className="md:hidden">最近抓取：</span>
                                {formatTime(source.lastFetchCompletedAt)}
                              </p>
                              <div className="flex items-center justify-between gap-3 md:justify-end">
                                <span className="text-xs op-55 md:hidden">进入行业分类</span>
                                <Switch
                                  checked={sourceSettings[source.id] ?? true}
                                  label={`${source.name}${source.title ? ` ${source.title}` : ""}进入行业分类`}
                                  onChange={value => setSourceSettings(current => ({ ...current, [source.id]: value }))}
                                />
                              </div>
                            </div>
                          )
                        })}
                        {!visibleSources.length && <p className="px-4 py-10 text-center text-sm op-55">没有匹配的数据源</p>}
                      </div>
                    </div>
                  </section>
                </div>
              )}

        {!settingsQuery.isPending && !settingsQuery.isError && (
          <footer className="flex items-center justify-between gap-3 border-t border-neutral-400/15 px-5 py-4 md:px-6">
            <p role="alert" className="min-w-0 truncate text-xs color-primary">{saveError}</p>
            <div className="ml-auto flex gap-2">
              <button type="button" className="h-9 rounded-lg px-4 cursor-pointer hover:bg-neutral-400/10" onClick={onClose}>取消</button>
              <button
                type="button"
                disabled={mutation.isPending || !model.trim() || !industriesValid}
                className="h-9 rounded-lg bg-primary px-4 color-white cursor-pointer disabled:op-45 disabled:cursor-not-allowed"
                onClick={submit}
              >
                {mutation.isPending ? "保存中…" : "保存设置"}
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  )
}

export function Settings() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="设置"
        aria-label="打开设置"
        className="i-ph:gear-six-duotone btn"
        onClick={() => setOpen(true)}
      />
      {open && createPortal(<SettingsDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}
