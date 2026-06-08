/**
 * AgentPanel.tsx
 * Shared "Refine Notes" agent UI used in both ExportStep (session) and NoteViewer (note).
 * Supports free-mode (copy-paste) and API-mode (direct call).
 */
import { useState } from 'react'
import { api } from '@/api/client'
import type { GenerationMode } from '@/types'
import { Button, Textarea, Input, Label, Alert, Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import {
  Bot, Wand2, RotateCcw, Copy, Check,
  MessageSquare, Cpu, ChevronDown, ChevronUp,
} from 'lucide-react'

interface AgentPanelProps {
  /** 'session' uses sessionId; 'note' uses noteId */
  target:    'session' | 'note'
  id:        string
  mode:      GenerationMode
  apiKey?:   string
  onApplied: () => void   // called after changes are applied (to reload preview)
}

const EXAMPLE_PROMPTS = [
  'Add more examples for this topic',
  'Add a simple intuitive explanation',
  'Make this section more concise',
  'Expand this section with more detail',
  'Add a comparison table',
  'Clarify the definition of key terms',
]

export function AgentPanel({ target, id, mode, apiKey, onApplied }: AgentPanelProps) {
  const [open,        setOpen]       = useState(false)
  const [userPrompt,  setUserPrompt] = useState('')
  const [agentMode,   setAgentMode]  = useState<GenerationMode>(mode)
  const [agentApiKey, setApiKey]     = useState(apiKey ?? '')

  const [loading,     setLoading]    = useState(false)
  const [result,      setResult]     = useState<{
    prompt?:   string
    scope:     string
    section:   string | null
    applied:   boolean
  } | null>(null)

  const [response,    setResponse]   = useState('')
  const [error,       setError]      = useState<string | null>(null)
  const [copied,      setCopied]     = useState(false)
  const [canUndo,     setCanUndo]    = useState(false)

  const copyPrompt = async () => {
    if (!result?.prompt) return
    await navigator.clipboard.writeText(result.prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const buildPrompt = async () => {
    if (!userPrompt.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setResponse('')

    try {
      const fn = target === 'session'
        ? () => api.buildRefinePrompt(id, userPrompt, agentMode, agentApiKey || undefined)
        : () => api.buildNoteRefinePrompt(id, userPrompt, agentMode, agentApiKey || undefined)

      const data = await fn()

      if (data.mode === 'applied') {
        setResult({ scope: data.scope, section: data.section, applied: true })
        setCanUndo(true)
        onApplied()
      } else {
        setResult({ prompt: data.prompt, scope: data.scope, section: data.section, applied: false })
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const applyPastedResponse = async () => {
    if (!response.trim()) { setError('Paste the response first'); return }
    setLoading(true)
    setError(null)
    try {
      const fn = target === 'session'
        ? () => api.applyRefine(id, response)
        : () => api.applyNoteRefine(id, response)
      await fn()
      setResult(prev => prev ? { ...prev, applied: true } : null)
      setCanUndo(true)
      onApplied()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const undo = async () => {
    if (target !== 'session') return   // undo only supported on session for now
    setLoading(true)
    try {
      await api.undoRefine(id)
      setCanUndo(false)
      setResult(null)
      setResponse('')
      onApplied()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resetAll = () => {
    setResult(null); setResponse(''); setError(null); setUserPrompt('')
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-card/80 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Bot className="w-4 h-4 text-accent" />
          Agent Refinement
          {canUndo && <Badge variant="warning" className="text-[10px] ml-1">Modified</Badge>}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted" />
          : <ChevronDown className="w-4 h-4 text-muted" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 bg-bg space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-3">
            <Label>Mode</Label>
            <div className="flex gap-1">
              {(['free', 'api'] as GenerationMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setAgentMode(m)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                    agentMode === m
                      ? 'bg-accent text-white'
                      : 'bg-card border border-border text-muted hover:text-slate-200',
                  )}
                >
                  {m === 'free'
                    ? <MessageSquare className="w-2.5 h-2.5" />
                    : <Cpu className="w-2.5 h-2.5" />
                  }
                  {m === 'free' ? 'Free' : 'API'}
                </button>
              ))}
            </div>
          </div>

          {agentMode === 'api' && (
            <div className="space-y-1">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="sk-ant-…"
                value={agentApiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </div>
          )}

          {/* Prompt input */}
          <div className="space-y-1.5">
            <Label>Change Request</Label>
            <Textarea
              placeholder="Describe what to change, e.g. 'Add more examples for the pumping lemma section'"
              rows={3}
              value={userPrompt}
              onChange={e => setUserPrompt(e.target.value)}
            />
            {/* Example chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {EXAMPLE_PROMPTS.map(ex => (
                <button
                  key={ex}
                  onClick={() => setUserPrompt(ex)}
                  className="text-[10px] bg-card border border-border rounded-full px-2.5 py-0.5 text-muted hover:text-accent hover:border-accent/50 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Scope indicator */}
          {result && !result.applied && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Wand2 className="w-3.5 h-3.5 text-accent" />
              <span>
                Scope detected:{' '}
                <span className="text-slate-300 font-medium">
                  {result.section ? `Section — ${result.section}` : 'Full document'}
                </span>
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1 justify-center"
              onClick={buildPrompt}
              loading={loading}
              disabled={!userPrompt.trim() || (agentMode === 'api' && !agentApiKey.trim())}
              size="sm"
            >
              <Wand2 className="w-3.5 h-3.5" />
              {agentMode === 'api' ? 'Refine via API' : 'Build Prompt'}
            </Button>
            {canUndo && target === 'session' && (
              <Button variant="secondary" size="sm" onClick={undo} loading={loading}>
                <RotateCcw className="w-3.5 h-3.5" /> Undo
              </Button>
            )}
          </div>

          {error && <Alert type="error">{error}</Alert>}

          {/* Applied confirmation */}
          {result?.applied && (
            <Alert type="info">
              ✅ Changes applied.{' '}
              <button className="underline text-xs ml-1" onClick={resetAll}>Make another change</button>
            </Alert>
          )}

          {/* Free mode: prompt + paste area */}
          {result && !result.applied && result.prompt && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Prompt — paste into claude.ai</Label>
                  <button onClick={copyPrompt} className="text-muted hover:text-slate-200 transition-colors">
                    {copied
                      ? <Check className="w-3.5 h-3.5 text-success" />
                      : <Copy className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
                <Textarea
                  readOnly
                  rows={6}
                  value={result.prompt}
                  className="text-[11px] bg-card font-mono"
                />
                <p className="text-[10px] text-muted">
                  ~{result.prompt ? Math.round(result.prompt.length / 4).toLocaleString() : 0} tokens
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Paste Claude's Response</Label>
                <Textarea
                  placeholder="Paste the modified content Claude returns…"
                  rows={7}
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                />
              </div>

              <Button
                className="w-full justify-center"
                onClick={applyPastedResponse}
                loading={loading}
                disabled={!response.trim()}
                size="sm"
              >
                Apply Changes
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
