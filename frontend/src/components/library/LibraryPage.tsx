import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { NoteOut } from '@/types'
import { Badge, Button, Input, Spinner, Card } from '@/components/ui/primitives'
import { cn, formatDate, scoreColor, scoreBg } from '@/lib/utils'
import { Search, FileText, Image, BarChart2, Download, Eye } from 'lucide-react'

interface Props {
  onOpen:       (id: string) => void
  refreshToken: number
}

export function LibraryPage({ onOpen, refreshToken }: Props) {
  const [notes,    setNotes]    = useState<NoteOut[]>([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [subject,  setSubject]  = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setNotes(await api.listNotes()) } catch { /**/ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [refreshToken])

  const subjects = [...new Set(notes.map(n => n.subject))]

  const filtered = notes.filter(n => {
    const matchSubject = !subject || n.subject === subject
    const matchQuery   = !query || [n.subject, n.unit].join(' ')
      .toLowerCase().includes(query.toLowerCase())
    return matchSubject && matchQuery
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
        <FileText className="w-12 h-12 text-muted" />
        <p className="text-slate-300 font-medium">No saved notes yet</p>
        <p className="text-sm text-muted">Complete the workflow and save your first notes.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border space-y-3">
        <h1 className="text-xl font-semibold text-slate-100">Notes Library</h1>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <Input
              placeholder="Search notes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSubject(null)}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                !subject ? 'bg-accent text-white' : 'bg-card border border-border text-muted hover:text-slate-200',
              )}
            >
              All
            </button>
            {subjects.map(s => (
              <button
                key={s}
                onClick={() => setSubject(s === subject ? null : s)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                  subject === s
                    ? 'bg-accent text-white'
                    : 'bg-card border border-border text-muted hover:text-slate-200',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <p className="text-muted text-sm text-center pt-12">No notes match your search.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(note => (
              <NoteCard key={note.id} note={note} onOpen={() => onOpen(note.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NoteCard({ note, onOpen }: { note: NoteOut; onOpen: () => void }) {
  const overall = note.eval_scores?.overall
  return (
    <Card className="p-4 space-y-3 hover:border-accent/40 transition-colors cursor-pointer group"
      onClick={onOpen}>
      {/* Subject + unit */}
      <div>
        <Badge variant="accent" className="mb-2 text-[10px]">{note.subject}</Badge>
        <h3 className="text-sm font-semibold text-slate-100 line-clamp-2 group-hover:text-accent transition-colors">
          {note.unit}
        </h3>
        <p className="text-[11px] text-muted mt-1">{formatDate(note.created_at)}</p>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {note.source_files.length} file{note.source_files.length !== 1 ? 's' : ''}
        </span>
        {note.image_count > 0 && (
          <span className="flex items-center gap-1">
            <Image className="w-3 h-3" />
            {note.image_count} img{note.image_count !== 1 ? 's' : ''}
          </span>
        )}
        <span>{note.token_estimate?.toLocaleString()} tok</span>
      </div>

      {/* Score bar */}
      {overall != null ? (
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-[10px] text-muted flex items-center gap-1">
              <BarChart2 className="w-2.5 h-2.5" /> Quality
            </span>
            <span className={cn('text-[10px] font-bold', scoreColor(overall))}>
              {Math.round(overall * 100)}%
            </span>
          </div>
          <div className="metric-bar">
            <div className={cn('metric-fill', scoreBg(overall))}
              style={{ width: `${overall * 100}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted">Not yet evaluated</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
        <Button size="sm" className="flex-1 justify-center" onClick={onOpen}>
          <Eye className="w-3.5 h-3.5" /> Open
        </Button>
        {note.has_pdf && (
          <Button
            size="sm" variant="secondary"
            onClick={() => window.open(api.exportNotePdf(note.id), '_blank')}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </Card>
  )
}
