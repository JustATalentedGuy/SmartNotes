import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '@/api/client'
import type { GenerationMode, RagResult } from '@/types'
import { Button, Textarea, Badge, Alert, Spinner } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { Send, Copy, Check, MessageSquare, Cpu, BookOpen, Trash2 } from 'lucide-react'

interface Props { noteId: string }

interface Message {
  role:      'user' | 'assistant' | 'prompt'
  content:   string
  retrieved?: Array<{ heading: string; snippet: string }> | null
}

export function RagChat({ noteId }: Props) {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [query,     setQuery]     = useState('')
  const [mode,      setMode]      = useState<GenerationMode>('free')
  const [apiKey,    setApiKey]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const [histLoad,  setHistLoad]  = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [copied,    setCopied]    = useState<number | null>(null)
  const bottomRef                  = useRef<HTMLDivElement>(null)
  const pollingRef                 = useRef(false)

  // ── Load persisted history whenever noteId changes ────────────────────────
  useEffect(() => {
    setMessages([])
    setError(null)
    setHistLoad(true)

    api.getMessages(noteId)
      .then(msgs => setMessages(msgs as Message[]))
      .catch(() => null)            // DB may not have table yet on first run
      .finally(() => setHistLoad(false))
  }, [noteId])

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Persist one message to the backend ───────────────────────────────────
  const persist = useCallback(async (msg: Message) => {
    await api.saveMessage(noteId, {
      role:      msg.role,
      content:   msg.content,
      retrieved: msg.retrieved ?? null,
    }).catch(() => null)   // silently ignore DB errors
  }, [noteId])

  // ── Send a query ──────────────────────────────────────────────────────────
  const send = async () => {
    const q = query.trim()
    if (!q || loading) return

    setQuery('')
    setError(null)

    const userMsg: Message = { role: 'user', content: q }
    setMessages(prev => [...prev, userMsg])
    await persist(userMsg)

    setLoading(true)
    try {
      const result: RagResult = await api.ragQuery(
        noteId, q, mode, mode === 'api' ? apiKey : undefined,
      )

      let replyMsg: Message
      if (result.mode === 'api' && result.answer) {
        replyMsg = {
          role:      'assistant',
          content:   result.answer,
          retrieved: result.retrieved,
        }
      } else {
        replyMsg = {
          role:      'prompt',
          content:   result.prompt!,
          retrieved: result.retrieved,
        }
      }

      setMessages(prev => [...prev, replyMsg])
      await persist(replyMsg)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = async () => {
    if (!confirm('Clear all chat history for this note?')) return
    await api.clearMessages(noteId).catch(() => null)
    setMessages([])
  }

  const copyText = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-accent" />
            Ask About These Notes
          </span>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-muted hover:text-danger transition-colors"
                title="Clear chat history"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {/* Mode toggle */}
            <div className="flex gap-1">
              {(['free', 'api'] as GenerationMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                    mode === m
                      ? 'bg-accent text-white'
                      : 'bg-card border border-border text-muted hover:text-slate-200',
                  )}
                >
                  {m === 'free'
                    ? <MessageSquare className="w-2.5 h-2.5" />
                    : <Cpu className="w-2.5 h-2.5" />
                  }
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* API key input */}
        {mode === 'api' && (
          <input
            type="password"
            placeholder="Anthropic API key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-accent/60 transition-colors"
          />
        )}
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {histLoad ? (
          <div className="flex justify-center pt-6">
            <Spinner className="w-4 h-4" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center pt-8 space-y-2 px-3">
            <BookOpen className="w-7 h-7 text-muted mx-auto" />
            <p className="text-xs text-muted leading-relaxed">
              Ask a question to get context-aware answers drawn from your saved notes.
            </p>
            {mode === 'free' && (
              <p className="text-[10px] text-muted/70">
                Free mode: a prompt is generated for you to paste into claude.ai.
              </p>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatBubble
              key={i}
              msg={msg}
              index={i}
              isCopied={copied === i}
              onCopy={text => copyText(text, i)}
            />
          ))
        )}

        {loading && (
          <div className="flex items-center gap-2 text-muted px-1">
            <Spinner className="w-3.5 h-3.5" />
            <span className="text-xs">Retrieving relevant sections…</span>
          </div>
        )}

        {error && <Alert type="error">{error}</Alert>}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-border space-y-1.5">
        <div className="flex gap-2 items-end">
          <Textarea
            placeholder="Ask a question… (Enter to send)"
            rows={2}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            className="flex-1 text-xs"
          />
          <Button
            size="sm"
            onClick={send}
            loading={loading}
            disabled={!query.trim()}
            className="flex-shrink-0 h-9 px-3"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-[10px] text-muted">
          History saved · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual message bubble
// ─────────────────────────────────────────────────────────────────────────────

function ChatBubble({ msg, index, isCopied, onCopy }: {
  msg:     Message
  index:   number
  isCopied: boolean
  onCopy:  (text: string) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-accent/15 border border-accent/30 rounded-xl rounded-tr-sm px-3 py-2 max-w-[88%]">
          <p className="text-xs text-slate-200 whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    )
  }

  // Sources used (shown for both assistant and prompt messages)
  const sourcesEl = msg.retrieved && msg.retrieved.length > 0 && (
    <div className="bg-bg border border-border rounded-lg px-2.5 py-2 mb-1.5">
      <p className="text-[10px] text-muted font-semibold mb-1">Sources retrieved:</p>
      {msg.retrieved.map((r, i) => (
        <div key={i} className="text-[10px]">
          <span className="text-accent font-medium">{r.heading}</span>
          {' — '}
          <span className="text-muted">{r.snippet}…</span>
        </div>
      ))}
    </div>
  )

  if (msg.role === 'assistant') {
    return (
      <div className="space-y-1.5">
        {sourcesEl}
        <div className="bg-card border border-border rounded-xl rounded-tl-sm px-3 py-2">
          <p className="text-xs text-slate-200 whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    )
  }

  // Prompt bubble — free mode
  const preview = msg.content.length > 320
    ? msg.content.slice(0, 320) + '…'
    : msg.content

  return (
    <div className="space-y-1.5">
      {sourcesEl}
      <div className="bg-card border border-warning/30 rounded-xl px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant="warning" className="text-[10px]">
            Paste into claude.ai
          </Badge>
          <button
            onClick={() => onCopy(msg.content)}
            className="text-muted hover:text-slate-200 transition-colors"
            title="Copy prompt"
          >
            {isCopied
              ? <Check className="w-3.5 h-3.5 text-success" />
              : <Copy className="w-3.5 h-3.5" />
            }
          </button>
        </div>
        <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto">
          {preview}
        </pre>
      </div>
    </div>
  )
}
