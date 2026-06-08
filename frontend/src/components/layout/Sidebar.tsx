import { BookOpen, Plus, Trash2, BarChart2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { NoteOut } from '@/types'
import { Badge, Button, Spinner } from '@/components/ui/primitives'
import { cn, formatDate, scoreColor } from '@/lib/utils'

interface SidebarProps {
  activeNoteId: string | null
  onSelectNote: (id: string) => void
  onNewNote:    () => void
  refreshToken: number
}

export function Sidebar({ activeNoteId, onSelectNote, onNewNote, refreshToken }: SidebarProps) {
  const [notes, setNotes]   = useState<NoteOut[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setNotes(await api.listNotes()) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [refreshToken])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Delete this note? This cannot be undone.')) return
    setDeleting(id)
    await api.deleteNote(id).catch(() => null)
    setDeleting(null)
    load()
    if (activeNoteId === id) onNewNote()
  }

  // Group notes by subject
  const grouped = notes.reduce<Record<string, NoteOut[]>>((acc, n) => {
    ;(acc[n.subject] ??= []).push(n)
    return acc
  }, {})

  return (
    <aside className="w-60 flex-shrink-0 bg-surface border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-border">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <BookOpen className="w-4 h-4 text-accent" />
          Notes Library
        </span>
        <button onClick={load} className="text-muted hover:text-slate-300 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New note button */}
      <div className="px-3 py-3 border-b border-border">
        <Button variant="primary" size="sm" className="w-full justify-center" onClick={onNewNote}>
          <Plus className="w-3.5 h-3.5" /> New Notes
        </Button>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {loading ? (
          <div className="flex justify-center pt-8"><Spinner className="w-5 h-5" /></div>
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted text-center pt-8 px-4">
            No saved notes yet.<br />Create your first one →
          </p>
        ) : (
          Object.entries(grouped).map(([subject, subjectNotes]) => (
            <div key={subject}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted px-2 mb-1.5">
                {subject}
              </p>
              <div className="space-y-0.5">
                {subjectNotes.map(note => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    active={note.id === activeNoteId}
                    deleting={deleting === note.id}
                    onSelect={() => onSelectNote(note.id)}
                    onDelete={e => handleDelete(e, note.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function NoteRow({ note, active, deleting, onSelect, onDelete }: {
  note:     NoteOut
  active:   boolean
  deleting: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const overall = note.eval_scores?.overall
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex items-start justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors',
        active ? 'bg-accent/15 border border-accent/30' : 'hover:bg-card border border-transparent',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-200 truncate">{note.unit}</p>
        <p className="text-[10px] text-muted mt-0.5">{formatDate(note.created_at)}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {note.image_count > 0 && (
            <Badge variant="default" className="text-[10px] py-0">{note.image_count} imgs</Badge>
          )}
          {overall != null && (
            <span className={cn('text-[10px] font-semibold', scoreColor(overall))}>
              <BarChart2 className="w-2.5 h-2.5 inline mr-0.5" />
              {Math.round(overall * 100)}%
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="opacity-0 group-hover:opacity-100 ml-1 mt-0.5 text-muted hover:text-danger transition-all"
      >
        {deleting ? <Spinner className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
      </button>
    </div>
  )
}
