import { useState, useRef } from 'react'
import { Upload, FileText, X, Cpu, MessageSquare } from 'lucide-react'
import { api } from '@/api/client'
import type { WorkflowState, WorkflowStep, GenerationMode } from '@/types'
import { Button, Input, Label, Alert } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

interface Props {
  ws: WorkflowState
  update: (p: Partial<WorkflowState>) => void
  goTo:   (s: WorkflowStep) => void
}

const ACCEPT = '.pdf,.pptx,.ppt'

export function UploadStep({ ws, update, goTo }: Props) {
  const [files, setFiles]       = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter(f =>
      /\.(pdf|pptx|ppt)$/i.test(f.name)
    )
    if (valid.length < incoming.length)
      setError('Only PDF and PPTX files are accepted.')
    else setError(null)
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !names.has(f.name))]
    })
  }

  const removeFile = (name: string) =>
    setFiles(prev => prev.filter(f => f.name !== name))

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const canStart = files.length > 0 && ws.subject.trim() && ws.unit.trim()

  const handleStart = async () => {
    if (!canStart) return
    setLoading(true)
    setError(null)
    try {
      const { session_id } = await api.createSession(
        ws.subject.trim(), ws.unit.trim(), ws.mode, ws.minScore,
      )
      await api.uploadFiles(session_id, files)
      update({ sessionId: session_id })
      goTo(2)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Create New Notes</h1>
        <p className="text-sm text-muted mt-1">
          Upload your lecture files and configure the generation settings.
        </p>
      </div>

      {/* Subject & Unit */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            placeholder="e.g. Theory of Computation"
            value={ws.subject}
            onChange={e => update({ subject: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unit">Unit / Chapter</Label>
          <Input
            id="unit"
            placeholder="e.g. Unit 3 — CFGs"
            value={ws.unit}
            onChange={e => update({ unit: e.target.value })}
          />
        </div>
      </div>

      {/* File drop zone */}
      <div className="space-y-1.5">
        <Label>Source Files</Label>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
            dragging
              ? 'border-accent bg-accent/5 scale-[1.01]'
              : 'border-border hover:border-accent/50 hover:bg-card/50',
          )}
        >
          <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
          <p className="text-sm text-slate-300 font-medium">
            Drop files here or click to browse
          </p>
          <p className="text-xs text-muted mt-1">PDF · PPTX · PPT</p>
          <input
            ref={inputRef} type="file" multiple
            accept={ACCEPT} className="hidden"
            onChange={e => addFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-1.5 mt-3">
            {files.map(f => (
              <div key={f.name}
                className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-accent flex-shrink-0" />
                  <span className="text-sm text-slate-200 truncate">{f.name}</span>
                  <span className="text-xs text-muted flex-shrink-0">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button onClick={() => removeFile(f.name)}
                  className="text-muted hover:text-danger transition-colors ml-2">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generation mode */}
      <div className="space-y-2">
        <Label>Generation Mode</Label>
        <div className="grid grid-cols-2 gap-3">
          {(['free', 'api'] as GenerationMode[]).map(m => (
            <button
              key={m}
              onClick={() => update({ mode: m })}
              className={cn(
                'flex items-start gap-3 p-3 rounded-xl border text-left transition-all',
                ws.mode === m
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-card hover:border-accent/40',
              )}
            >
              {m === 'free'
                ? <MessageSquare className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                : <Cpu className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
              }
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {m === 'free' ? 'Free Mode' : 'API Mode'}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {m === 'free'
                    ? 'Copy prompt → paste to claude.ai → paste back'
                    : 'Direct Anthropic API call (key required)'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Min image score */}
      <div className="space-y-2">
        <Label>Image Quality Threshold — {ws.minScore.toFixed(2)}</Label>
        <input
          type="range" min={0.10} max={0.80} step={0.05}
          value={ws.minScore}
          onChange={e => update({ minScore: parseFloat(e.target.value) })}
          className="w-full accent-accent h-1.5 cursor-pointer"
        />
        <p className="text-xs text-muted">
          Lower = keep more images (may include decoratives) · Higher = keep only clear diagrams
        </p>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      <Button
        className="w-full justify-center"
        onClick={handleStart}
        loading={loading}
        disabled={!canStart}
        size="lg"
      >
        Start Extraction →
      </Button>
    </div>
  )
}
