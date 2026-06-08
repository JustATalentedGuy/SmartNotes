import { useState } from 'react'
import { api } from '@/api/client'
import type { WorkflowState, WorkflowStep, EvalResult } from '@/types'
import { Button, Badge, Alert, Spinner, Card } from '@/components/ui/primitives'
import { cn, scoreColor, scoreBg } from '@/lib/utils'
import {
  Download, BookMarked, RotateCcw, BarChart2,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react'
import { AgentPanel } from '@/components/workflow/AgentPanel'

interface Props {
  ws:      WorkflowState
  update:  (p: Partial<WorkflowState>) => void
  goTo:    (s: WorkflowStep) => void
  onSaved: () => void
  onReset: () => void
}

const METRIC_LABELS: Record<string, string> = {
  coverage:         'Coverage',
  structural:       'Structure',
  key_term_density: 'Key-Term Density',
  length_adequacy:  'Length Adequacy',
  faithfulness:     'Faithfulness',
}

const METRIC_TIPS: Record<string, string> = {
  coverage:         'TF-IDF keyword coverage from source material',
  structural:       'Headings, tables, code blocks, summary, exam sections',
  key_term_density: 'Bold terms + code spans per 100 words',
  length_adequacy:  'Notes length vs source length (ideal: 0.6–1.8×)',
  faithfulness:     'Semantic similarity of notes sentences to source',
}

export function ExportStep({ ws, update, goTo, onSaved, onReset }: Props) {
  const [evalResult,  setEvalResult]  = useState<EvalResult | null>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [pdfLoading,  setPdfLoading]  = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [savedId,     setSavedId]     = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [pdfMsg,      setPdfMsg]      = useState<string | null>(null)
  const [showFlagged, setShowFlagged] = useState(false)
  // Increment to force iframe reload after agent refine
  const [previewKey,  setPreviewKey]  = useState(0)

  const previewUrl = ws.sessionId ? api.sessionPreviewUrl(ws.sessionId) : null

  const runEval = async () => {
    if (!savedId) { setError('Save the note first to run evaluation'); return }
    setEvalLoading(true); setError(null)
    try { setEvalResult(await api.evaluateNote(savedId)) }
    catch (e: any) { setError(e.message) }
    finally { setEvalLoading(false) }
  }

  const saveNote = async () => {
    if (!ws.sessionId) return
    setSaveLoading(true); setError(null)
    try {
      const { note_id } = await api.saveNote(ws.sessionId)
      setSavedId(note_id); setSaved(true)
    }
    catch (e: any) { setError(e.message) }
    finally { setSaveLoading(false) }
  }

  const exportPdf = async () => {
    if (!ws.sessionId) return
    setPdfLoading(true); setPdfMsg(null); setError(null)
    try {
      const data = await api.exportPdf(ws.sessionId)
      const url  = data.pdf_url ?? data.html_url ?? null
      if (url) window.open(url, '_blank')
      if (data.message) setPdfMsg(data.message)
    }
    catch (e: any) { setError(e.message) }
    finally { setPdfLoading(false) }
  }

  const scores = evalResult?.scores

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Notes Ready</h1>
          <p className="text-sm text-muted mt-0.5">{ws.subject} — {ws.unit}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
          {previewUrl && (
            <Button
              variant="ghost" size="sm"
              onClick={() => window.open(previewUrl, '_blank')}
              title="Open notes in a distraction-free full page"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Full Page
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={exportPdf} loading={pdfLoading}>
            <Download className="w-3.5 h-3.5" /> Export PDF
          </Button>
          {!saved
            ? <Button size="sm" onClick={saveNote} loading={saveLoading}>
                <BookMarked className="w-3.5 h-3.5" /> Save to Library
              </Button>
            : <Badge variant="success" className="px-3">✓ Saved</Badge>
          }
        </div>
      </div>

      {pdfMsg && <Alert type="warn">{pdfMsg}</Alert>}
      {error   && <Alert type="error">{error}</Alert>}

      {/* ── Preview + Evaluation ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Preview — 2/3 */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Preview</p>
          <div className="border border-border rounded-xl overflow-hidden" style={{ height: '520px' }}>
            {previewUrl
              ? <iframe
                  key={previewKey}
                  src={previewUrl}
                  className="w-full h-full border-none"
                  title="Notes Preview"
                />
              : <div className="flex items-center justify-center h-full">
                  <Spinner className="w-6 h-6" />
                </div>
            }
          </div>
        </div>

        {/* Evaluation — 1/3 */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">
            Quality Evaluation
          </p>

          {!evalResult ? (
            <Card className="p-5 text-center space-y-3">
              <BarChart2 className="w-8 h-8 text-muted mx-auto" />
              <p className="text-sm text-muted">
                {saved
                  ? 'Run evaluation to measure note quality across 5 metrics.'
                  : 'Save the note first, then run evaluation.'}
              </p>
              <Button className="w-full justify-center" onClick={runEval}
                loading={evalLoading} disabled={!saved} size="sm">
                {evalLoading ? 'Analysing…' : 'Run Evaluation'}
              </Button>
            </Card>
          ) : (
            <Card className="p-4 space-y-4">
              <div className="text-center py-2">
                <div className={cn('text-4xl font-bold', scoreColor(scores!.overall))}>
                  {Math.round(scores!.overall * 100)}
                </div>
                <div className="text-xs text-muted mt-1">Overall Score</div>
              </div>

              <div className="space-y-3">
                {Object.entries(METRIC_LABELS).map(([key, label]) => {
                  const val = (scores as any)[key] as number
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[11px] text-slate-300">{label}</span>
                        <span className={cn('text-[11px] font-bold', scoreColor(val))}>
                          {Math.round(val * 100)}%
                        </span>
                      </div>
                      <div className="metric-bar">
                        <div className={cn('metric-fill', scoreBg(val))}
                          style={{ width: `${val * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-muted">{METRIC_TIPS[key]}</p>
                    </div>
                  )
                })}
              </div>

              {evalResult.checks && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted hover:text-slate-300 font-medium">
                    Structural checks
                  </summary>
                  <div className="mt-2 space-y-1">
                    {Object.entries(evalResult.checks).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1.5">
                        <span className={v ? 'text-success' : 'text-muted'}>{v ? '✓' : '○'}</span>
                        <span className={v ? 'text-slate-300' : 'text-muted'}>
                          {k.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {evalResult.flagged_sentences?.length > 0 && (
                <div>
                  <button onClick={() => setShowFlagged(f => !f)}
                    className="flex items-center gap-1 text-xs text-warning hover:text-warning/80">
                    {showFlagged
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                    }
                    {evalResult.flagged_sentences.length} low-faithfulness sentence(s)
                  </button>
                  {showFlagged && (
                    <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                      {evalResult.flagged_sentences.map((s, i) => (
                        <p key={i} className="text-[10px] text-warning/80 bg-warning/5 px-2 py-1 rounded border border-warning/20">
                          {s}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button size="sm" variant="secondary" className="w-full justify-center"
                onClick={runEval} loading={evalLoading}>
                Re-evaluate
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* ── Agent refinement ─────────────────────────────────────────────── */}
      {ws.sessionId && (
        <AgentPanel
          target="session"
          id={ws.sessionId}
          mode={ws.mode}
          apiKey={ws.apiKey}
          onApplied={() => setPreviewKey(k => k + 1)}
        />
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={() => goTo(4)}>← Back</Button>
        <Button variant="ghost" onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5" /> New Notes
        </Button>
      </div>
    </div>
  )
}
