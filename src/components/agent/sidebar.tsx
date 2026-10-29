import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouterState } from "@tanstack/react-router"
import { myFetch } from "~/utils"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  sources?: Array<{ id: string, index: number, title: string, url: string, source: string }>
}

interface ChatResponse {
  answer: string
  sources: NonNullable<ChatMessage["sources"]>
}

const suggestions = ["总结目前的热点新闻", "这些新闻之间有什么联系？", "有哪些值得关注的趋势？"]

function SourceLinks({ message }: { message: ChatMessage }) {
  const matches = [...message.content.matchAll(/\[(\d+)\]/g)]
  const mentioned = new Set(matches.map(match => Number(match[1])))
  const filtered = message.sources?.filter(source => mentioned.has(source.index)) ?? []
  const referenced = filtered
  if (!referenced.length) return <p className="mt-2 text-xs op-55">本次回答没有可核验的新闻引用。</p>
  return (
    <div className="mt-3 pt-3 border-t border-neutral-400/20 text-xs">
      <p className="mb-2 op-55">参考新闻</p>
      <div className="flex flex-col gap-2">
        {referenced.slice(0, 6).map(source => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:color-primary line-height-snug"
          >
            <span className="op-55">[{source.index}] {source.source} · </span>
            {source.title}
          </a>
        ))}
      </div>
    </div>
  )
}

export function AgentSidebar() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const industryPath = pathname.startsWith("/industry/")
    ? pathname.split("/")[2]
    : undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [targetArticleId, setTargetArticleId] = useState<string | undefined>()
  const { loggedIn, enableLogin, login } = useLogin()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.title !== "string") return
      setTargetArticleId(typeof event.detail.id === "string" ? event.detail.id : undefined)
      setMessages([])
      setDraft(`请解读这条新闻，并说明相关背景与影响：${event.detail.title.slice(0, 200)}`)
      setOpen(true)
    }
    window.addEventListener("newsnow:ask", handler)
    return () => window.removeEventListener("newsnow:ask", handler)
  }, [])

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading, open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  async function send(value = draft) {
    const question = value.trim()
    if (!question || loading) return
    if (!loggedIn) {
      setError(enableLogin ? "请先使用 GitHub 登录，再使用资讯助手。" : "管理员尚未启用 GitHub 登录，Agent 暂不可用。")
      return
    }
    const next: ChatMessage[] = [...messages, { role: "user", content: question }]
    setMessages(next)
    setDraft("")
    setError("")
    setLoading(true)
    try {
      const response = await myFetch<ChatResponse>("/agent/chat", {
        method: "POST",
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${safeParseString(localStorage.getItem("jwt")) || ""}`,
        },
        body: {
          // Send at most six turns; the backend also validates the message history.
          messages: next.slice(-11).map(({ role, content }) => ({ role, content })),
          ...(industryPath ? { industryPath } : {}),
          ...(targetArticleId ? { articleId: targetArticleId } : {}),
        },
      })
      setMessages(current => [...current, {
        role: "assistant",
        content: response.answer,
        sources: response.sources,
      }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "问答请求失败，请重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        title="NewsNow AI"
        aria-label="打开 AI 资讯助手"
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-neutral-400/10 cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <span className="i-ph:sparkle-duotone" aria-hidden="true" />
        <span className="hidden sm:inline text-sm font-bold">AI</span>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-100 flex justify-end" role="presentation">
          <button
            type="button"
            aria-label="关闭 AI 助手"
            className="absolute inset-0 bg-black/45"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="NewsNow AI 资讯助手"
            className="relative flex flex-col h-full w-full sm:w-[440px] max-w-full bg-base shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-400/20 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span className="i-ph:sparkle-duotone color-primary" aria-hidden="true" />
                  NewsNow AI
                </h2>
                <p className="mt-1 text-xs op-60">
                  {industryPath ? `当前行业：${industryPath}` : "跨行业热点问答"} · 基于已收录新闻
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  title="清空对话"
                  className="p-2 rounded-lg hover:bg-neutral-400/10 cursor-pointer"
                  onClick={() => { setMessages([]); setError(""); setTargetArticleId(undefined) }}
                >
                  <span className="i-ph:arrow-counter-clockwise-duotone" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="关闭面板"
                  className="p-2 rounded-lg hover:bg-neutral-400/10 cursor-pointer"
                  onClick={() => setOpen(false)}
                >
                  <span className="i-ph:x-bold" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              {!messages.length && (
                <div className="flex flex-col gap-5">
                  <div className="rounded-2xl bg-neutral-400/10 p-4">
                    <p className="font-bold mb-2">询问今天的新闻</p>
                    <p className="text-sm op-70 line-height-relaxed">
                      可以总结热点、比较观点，或分析行业趋势。回答基于已收录的新闻摘要，并附原始来源。
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        className="text-left text-sm rounded-xl border border-neutral-400/20 px-4 py-3 hover:border-primary/40 cursor-pointer"
                        onClick={() => void send(suggestion)}
                        disabled={loading}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-4">
                {!loggedIn && enableLogin && (
                  <button type="button" onClick={login} className="mb-4 rounded-xl bg-primary color-white px-4 py-3 text-sm cursor-pointer">GitHub 登录后开启 AI 问答</button>
                )}
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`rounded-2xl p-4 text-sm line-height-relaxed ${message.role === "user" ? "ml-8 bg-primary/10" : "mr-4 bg-neutral-400/10"}`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    {message.role === "assistant" && <SourceLinks message={message} />}
                  </div>
                ))}
                {loading && <p className="text-sm op-60 px-2" role="status">正在分析新闻…</p>}
                {error && <p role="alert" className="text-sm color-red-500 px-2">{error}</p>}
                <div ref={bottom} />
              </div>
            </div>

            <form
              className="border-t border-neutral-400/20 p-4"
              onSubmit={(event) => { event.preventDefault(); void send() }}
            >
              <textarea
                aria-label="向 NewsNow AI 提问"
                rows={3}
                maxLength={2500}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder="问问最近发生了什么…"
                className="block w-full resize-none rounded-xl bg-neutral-400/10 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              />
              <div className="mt-3 flex justify-between items-center">
                <p className="text-xs op-45">Enter 发送 · Shift+Enter 换行</p>
                <button
                  type="submit"
                  disabled={loading || !draft.trim()}
                  className="px-4 py-2 rounded-lg bg-primary color-white text-sm font-bold disabled:op-50 cursor-pointer"
                >
                  发送
                </button>
              </div>
            </form>
          </section>
        </div>, document.body)}
    </>
  )
}
