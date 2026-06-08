import { useState, useEffect, useRef } from 'react'
import { api } from '@/api/client'
import type { WorkflowState, WorkflowStep } from '@/types'
import { Button, Textarea, Input, Label, Alert, Badge, Spinner } from '@/components/ui/primitives'
import { Copy, Check, Cpu, MessageSquare } from 'lucide-react'
import { sleep } from '@/lib/utils'

interface Props {
  ws: WorkflowState
  update: (p: Partial<WorkflowState>) => void
  goTo:   (s: WorkflowStep) => void
}

export function GenerateStep({ ws, update, goTo }: Props) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Generate Notes</h1>
        <p className="text-sm text-muted mt-1">
          Using <strong className="text-accent">{ws.mode === 'free' ? 'Free Mode' : 'API Mode'}</strong>
          {' '}for <span className="text-slate-300">{ws.subject} — {ws.unit}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fallback"
          checked={ws.useFallback}
          onChange={e => update({ useFallback: e.target.checked })}
          className="accent-accent"
        />
        <label htmlFor="fallback" className="text-sm text-slate-300 cursor-pointer">
          Auto-position images Claude drops (keyword-based fallback)
        </label>
      </div>

      {ws.mode === 'free'
        ? <FreeMode ws={ws} update={update} goTo={goTo} />
        : <ApiMode  ws={ws} update={update} goTo={goTo} />
      }
    </div>
  )
}

// ── Free mode ───────────────────────────────────────────────────────────────

function FreeMode({ ws, update, goTo }: Props) {
  const [buildLoading, setBuildLoading] = useState(false)
  const [procLoading,  setProcLoading]  = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [response,     setResponse]     = useState('')
  const [error,        setError]        = useState<string | null>(null)
  const [stats,        setStats]        = useState<{ placed: number; dropped: number } | null>(null)

  const buildPrompt = async () => {
    setBuildLoading(true)
    setError(null)
    try {
      const data = await api.buildPrompt(ws.sessionId!)
      update({ prompt: data.prompt })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBuildLoading(false)
    }
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(ws.prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const processResponse = async () => {
    if (!response.trim()) { setError('Paste Claude\'s response first'); return }
    setProcLoading(true)
    setError(null)
    try {
      const data = await api.processResponse(ws.sessionId!, response, ws.useFallback)
      setStats({ placed: data.placed, dropped: data.dropped })
      update({ previewHtml: data.preview_html })
      setTimeout(() => goTo(5), 800)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Step 1: Build prompt */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent">Step 1</Badge>
          <span className="text-sm font-medium text-slate-200">Build & copy the prompt</span>
        </div>
        {!ws.prompt ? (
          <Button onClick={buildPrompt} loading={buildLoading} className="w-full justify-center">
            Build Prompt
          </Button>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={ws.prompt}
              readOnly
              rows={8}
              className="text-[11px] bg-bg"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {ws.session?.token_estimate?.toLocaleString()} tokens
              </span>
              <Button size="sm" variant="secondary" onClick={copyPrompt}>
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Paste response */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent">Step 2</Badge>
          <span className="text-sm font-medium text-slate-200">
            Paste Claude's response from claude.ai
          </span>
        </div>
        <Textarea
          placeholder="Paste Claude's complete response here…"
          rows={10}
          value={response}
          onChange={e => setResponse(e.target.value)}
        />
        {stats && (
          <Alert type="info">
            ✅ {stats.placed} image(s) placed
            {stats.dropped > 0 && ` · ${stats.dropped} auto-positioned`}
          </Alert>
        )}
        <Button
          className="w-full justify-center"
          onClick={processResponse}
          loading={procLoading}
          disabled={!ws.prompt || !response.trim()}
        >
          Process Response & Preview →
        </Button>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      <Button variant="secondary" onClick={() => goTo(3)}>← Back</Button>
    </div>
  )
}

// ── API mode ────────────────────────────────────────────────────────────────

function ApiMode({ ws, update, goTo }: Props) {
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollingRef            = useRef(false)

  const generate = async () => {
    if (!ws.apiKey.trim()) { setError('Enter your Anthropic API key'); return }
    setLoading(true)
    setError(null)
    try {
      await api.generateApi(ws.sessionId!, ws.apiKey, ws.useFallback)
      // Poll for completion
      pollingRef.current = true
      while (pollingRef.current) {
        await sleep(2000)
        const data = await api.pollSession(ws.sessionId!)
        update({ session: data })
        if (data.status === 'complete' && data.has_notes) {
          goTo(5)   // ExportStep fetches preview via GET /sessions/{id}/preview
          break
        }
        if (data.status === 'error') {
          setError(data.error ?? 'Generation failed')
          break
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      pollingRef.current = false
    }
  }

  useEffect(() => () => { pollingRef.current = false }, [])

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <Label htmlFor="apikey">Anthropic API Key</Label>
        <Input
          id="apikey"
          type="password"
          placeholder="sk-ant-…"
          value={ws.apiKey}
          onChange={e => update({ apiKey: e.target.value })}
        />
        <p className="text-xs text-muted">Used only for this request. Never stored on disk.</p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-4">
          <Spinner className="w-5 h-5" />
          <span className="text-sm text-slate-300">
            Calling Claude API — this may take 30–60 seconds for large notes…
          </span>
        </div>
      )}

      {error && <Alert type="error">{error}</Alert>}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => goTo(3)}>← Back</Button>
        <Button
          className="flex-1 justify-center"
          onClick={generate}
          loading={loading}
          disabled={!ws.apiKey.trim()}
        >
          <Cpu className="w-4 h-4" /> Generate via API
        </Button>
      </div>
    </div>
  )
}
