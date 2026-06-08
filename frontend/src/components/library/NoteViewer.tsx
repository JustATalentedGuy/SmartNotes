import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { NoteOut, EvalResult } from '@/types'
import { Button, Badge, Spinner, Alert } from '@/components/ui/primitives'
import { cn, formatDate, scoreColor, scoreBg } from '@/lib/utils'
import {
  BarChart2, Download, ArrowLeft,
  MessageSquare, Bot, ExternalLink,
} from 'lucide-react'
import { RagChat }    from '@/components/rag/RagChat'
import { AgentPanel } from '@/components/workflow/AgentPanel'

interface Props {
  noteId: string
  onBack: () => void
}

type RightTab = 'qa' | 'refine'

const METRIC_LABELS: Record<string, string> = {
  coverage:         'Coverage',
  structural:       'Structure',
  key_term_density: 'Density',
  length_adequacy:  'Length',
  faithfulness:     'Faithful',
}

export function NoteViewer({ noteId, onBack }: Props) {
  const [note,       setNote]       = useState<NoteOut | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [evalRes,    setEvalRes]    = useState<EvalResult | null>(null)
  const [evalLoad,   setEvalLoad]   = useState(false)
  const [rightTab,   setRightTab]   = useState<RightTab>('qa')
  const [error,      setError]      = useState<string | null>(null)
  // Increment to force iframe reload after agent refinement
  const [previewKey, setPreviewKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setNote(null)
    setEvalRes(null)
    setError(null)
    api.getNote(noteId)
      .then(n => {
        setNote(n)
        if (n.eval_scores) {
          setEvalRes({ scores: n.eval_scores, checks: {}, flagged_sentences: [] })
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [noteId])

  const runEval = async () => {
    setEvalLoad(true)
    try { setEvalRes(await api.evaluateNote(noteId)) }
    catch (e: any) { setError(e.message) }
    finally { setEvalLoad(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Spinner className="w-6 h-6" />
    </div>
  )
  if (error) return <div className="p-6"><Alert type="error">{error}</Alert></div>
  if (!note)  return null

  const scores     = evalRes?.scores
  const previewUrl = api.notePreviewUrl(noteId)

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-surface flex items-center gap-3">
        <button onClick={onBack}
          className="text-muted hover:text-slate-200 transition-colors p-1">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="accent" className="text-[10px]">{note.subject}</Badge>
            {scores && (
              <span className={cn('text-[10px] font-bold', scoreColor(scores.overall))}>
                {Math.round(scores.overall * 100)}% quality
              </span>
            )}
            <span className="text-[10px] text-muted">{formatDate(note.created_at)}</span>
          </div>
          <h1 className="text-sm font-semibold text-slate-100 truncate">{note.unit}</h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Open notes in distraction-free full page */}
          <Button
            size="sm" variant="ghost"
            onClick={() => window.open(previewUrl, '_blank')}
            title="Open notes in a distraction-free full page"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Full Page
          </Button>
          <Button
            size="sm" variant="secondary"
            onClick={() => window.open(api.exportNotePdf(noteId), '_blank')}
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </Button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: notes iframe */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="flex-1 overflow-hidden">
            <iframe
              key={previewKey}
              src={previewUrl}
              className="w-full h-full border-none"
              title="Notes"
            />
          </div>

          {/* Eval metrics strip */}
          {scores ? (
            <div className="flex-shrink-0 border-t border-border bg-surface px-4 py-2">
              <div className="flex items-center gap-4 overflow-x-auto">
                {Object.entries(METRIC_LABELS).map(([key, label]) => {
                  const val = (scores as any)[key] as number
                  return (
                    <div key={key} className="flex-shrink-0 space-y-1 min-w-[68px]">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] text-muted">{label}</span>
                        <span className={cn('text-[9px] font-bold', scoreColor(val))}>
                          {Math.round(val * 100)}%
                        </span>
                      </div>
                      <div className="metric-bar w-full">
                        <div className={cn('metric-fill', scoreBg(val))}
                          style={{ width: `${val * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
                <Button size="sm" variant="ghost" onClick={runEval} loading={evalLoad}
                  className="flex-shrink-0 ml-auto text-[11px]">
                  <BarChart2 className="w-3 h-3" />
                  {evalLoad ? 'Scoring…' : 'Re-evaluate'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-shrink-0 border-t border-border bg-surface px-4 py-2 flex justify-end">
              <Button size="sm" variant="ghost" onClick={runEval} loading={evalLoad}>
                <BarChart2 className="w-3 h-3" /> Run Evaluation
              </Button>
            </div>
          )}
        </div>

        {/* Right: tabbed panel */}
        <div className="w-80 flex-shrink-0 border-l border-border flex flex-col min-h-0">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex border-b border-border">
            <TabBtn
              label="Q&A"
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              active={rightTab === 'qa'}
              onClick={() => setRightTab('qa')}
            />
            <TabBtn
              label="Refine"
              icon={<Bot className="w-3.5 h-3.5" />}
              active={rightTab === 'refine'}
              onClick={() => setRightTab('refine')}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'qa' && <RagChat noteId={noteId} />}

            {rightTab === 'refine' && (
              <div className="h-full overflow-y-auto p-3 space-y-3">
                <p className="text-xs text-muted leading-relaxed">
                  Ask the agent to make targeted changes. Changes are saved to the
                  library and the preview reloads automatically.
                </p>
                <AgentPanel
                  target="note"
                  id={noteId}
                  mode="free"
                  onApplied={() => setPreviewKey(k => k + 1)}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

function TabBtn({ label, icon, active, onClick }: {
  label:   string
  icon:    React.ReactNode
  active:  boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium',
        'transition-colors border-b-2',
        active
          ? 'border-accent text-accent bg-accent/5'
          : 'border-transparent text-muted hover:text-slate-300 hover:bg-card/50',
      )}
    >
      {icon} {label}
    </button>
  )
}
