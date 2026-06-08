import { useState } from 'react'
import { Sidebar }      from '@/components/layout/Sidebar'
import { WorkflowPage } from '@/components/workflow/WorkflowPage'
import { LibraryPage }  from '@/components/library/LibraryPage'
import { NoteViewer }   from '@/components/library/NoteViewer'
import { BookOpen, PlusCircle, Library, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

type View = 'workflow' | 'library' | 'note'

export default function App() {
  const [view,         setView]         = useState<View>('workflow')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [libRefresh,   setLibRefresh]   = useState(0)
  const [sidebarOpen,  setSidebarOpen]  = useState(true)

  const openNote = (id: string) => {
    setActiveNoteId(id)
    setView('note')
  }

  const noteSaved = () => setLibRefresh(r => r + 1)

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-slate-200">

      {/* ── Sidebar (collapsible) ──────────────────────────────────────────── */}
      <div className={cn(
        'flex-shrink-0 transition-all duration-300 overflow-hidden',
        sidebarOpen ? 'w-60' : 'w-0',
      )}>
        {/* Render even when hidden so it mounts only once */}
        <div className="w-60 h-full">
          <Sidebar
            activeNoteId={activeNoteId}
            onSelectNote={openNote}
            onNewNote={() => { setView('workflow'); setActiveNoteId(null) }}
            refreshToken={libRefresh}
          />
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">

        {/* Top nav */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
              className="text-muted hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-card"
            >
              {sidebarOpen
                ? <PanelLeftClose className="w-4 h-4" />
                : <PanelLeftOpen  className="w-4 h-4" />
              }
            </button>

            <div className="flex items-center gap-2 ml-1">
              <BookOpen className="w-4 h-4 text-accent" />
              <span className="font-bold text-slate-100 tracking-tight text-sm">Smart Notes</span>
              <span className="text-muted text-xs hidden sm:inline">/ JustATalentedGuy</span>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            <NavBtn
              icon={<PlusCircle className="w-3.5 h-3.5" />}
              label="New Notes"
              active={view === 'workflow'}
              onClick={() => { setView('workflow'); setActiveNoteId(null) }}
            />
            <NavBtn
              icon={<Library className="w-3.5 h-3.5" />}
              label="Library"
              active={view === 'library'}
              onClick={() => setView('library')}
            />
          </nav>
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {view === 'workflow' && <WorkflowPage onNoteSaved={noteSaved} />}
          {view === 'library'  && <LibraryPage  onOpen={openNote} refreshToken={libRefresh} />}
          {view === 'note' && activeNoteId && (
            <NoteViewer noteId={activeNoteId} onBack={() => setView('library')} />
          )}
        </main>
      </div>
    </div>
  )
}

function NavBtn({ icon, label, active, onClick }: {
  icon:    React.ReactNode
  label:   string
  active:  boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
        active
          ? 'bg-accent/15 text-accent border border-accent/30'
          : 'text-muted hover:text-slate-200 hover:bg-card',
      )}
    >
      {icon}{label}
    </button>
  )
}
