import { useState } from 'react'
import { api } from '@/api/client'
import type { WorkflowState, WorkflowStep, ImageInfo } from '@/types'
import { Button, Badge, Alert } from '@/components/ui/primitives'
import { cn, scoreColor } from '@/lib/utils'
import { Eye, EyeOff, CheckSquare, Square } from 'lucide-react'

interface Props {
  ws: WorkflowState
  update: (p: Partial<WorkflowState>) => void
  goTo:   (s: WorkflowStep) => void
}

export function ReviewImagesStep({ ws, update, goTo }: Props) {
  const images = ws.session?.images ?? []
  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(images.map(img => [img.id, img.included]))
  )
  const [toggling, setToggling] = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const toggle = async (id: string) => {
    const next = !included[id]
    setToggling(id)
    try {
      await api.toggleImage(ws.sessionId!, id, next)
      setIncluded(prev => ({ ...prev, [id]: next }))
      // Refresh session to get updated token estimate
      const data = await api.pollSession(ws.sessionId!)
      update({ session: data })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setToggling(null)
    }
  }

  const selectAll = async (val: boolean) => {
    for (const img of images) {
      await api.toggleImage(ws.sessionId!, img.id, val).catch(() => null)
    }
    setIncluded(Object.fromEntries(images.map(img => [img.id, val])))
    const data = await api.pollSession(ws.sessionId!)
    update({ session: data })
  }

  const includedCount = Object.values(included).filter(Boolean).length

  if (images.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-slate-100">Review Images</h1>
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <EyeOff className="w-10 h-10 text-muted mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No images extracted</p>
          <p className="text-sm text-muted mt-1">
            Your files had no detectable diagrams or figures. Notes will be text-only.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => goTo(2)}>← Back</Button>
          <Button className="flex-1 justify-center" onClick={() => goTo(4)}>
            Generate Notes →
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Review Extracted Images</h1>
          <p className="text-sm text-muted mt-0.5">
            {includedCount} of {images.length} images included. Exclude logos, decorations, or irrelevant figures.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => selectAll(true)}>
            <CheckSquare className="w-3.5 h-3.5" /> All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => selectAll(false)}>
            <Square className="w-3.5 h-3.5" /> None
          </Button>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* Image grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map(img => (
          <ImageCard
            key={img.id}
            img={img}
            included={included[img.id] ?? true}
            toggling={toggling === img.id}
            onToggle={() => toggle(img.id)}
          />
        ))}
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={() => goTo(2)}>← Back</Button>
        <Button className="flex-1 justify-center" onClick={() => goTo(4)}>
          Generate Notes ({includedCount} images) →
        </Button>
      </div>
    </div>
  )
}

function ImageCard({ img, included, toggling, onToggle }: {
  img:      ImageInfo
  included: boolean
  toggling: boolean
  onToggle: () => void
}) {
  const [imgError, setImgError] = useState(false)
  const scoreVal = img.score
  const scoreLabel = scoreVal >= 0.75 ? 'High' : scoreVal >= 0.5 ? 'Med' : 'Low'
  const scoreCls   = scoreVal >= 0.75 ? 'success' : scoreVal >= 0.5 ? 'warning' : 'danger'

  return (
    <div
      onClick={onToggle}
      className={cn(
        'relative rounded-xl border cursor-pointer overflow-hidden group transition-all duration-200',
        included
          ? 'border-accent/50 ring-1 ring-accent/20 bg-card'
          : 'border-border bg-card/50 opacity-60 grayscale',
        'hover:opacity-100 hover:grayscale-0 hover:border-accent/70',
      )}
    >
      {/* Image */}
      <div className="aspect-video bg-bg flex items-center justify-center overflow-hidden">
        {imgError ? (
          <EyeOff className="w-6 h-6 text-muted" />
        ) : (
          <img
            src={img.url}
            alt={img.alt_text}
            onError={() => setImgError(true)}
            className="w-full h-full object-contain"
          />
        )}
      </div>

      {/* Info bar */}
      <div className="px-2 py-1.5 space-y-1">
        <p className="text-[10px] text-muted truncate">{img.source_file} · p.{img.page + 1}</p>
        <div className="flex items-center justify-between">
          <Badge variant={scoreCls as any} className="text-[10px]">
            {scoreLabel} {(scoreVal * 100).toFixed(0)}%
          </Badge>
          <div className={cn(
            'w-4 h-4 rounded border flex items-center justify-center text-[10px]',
            included ? 'bg-accent border-accent text-white' : 'border-border',
          )}>
            {included && '✓'}
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {toggling && (
        <div className="absolute inset-0 bg-bg/60 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
