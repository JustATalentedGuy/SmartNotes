import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { WorkflowState, WorkflowStep } from '@/types'
import { Button, Badge, Spinner, Alert } from '@/components/ui/primitives'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { sleep } from '@/lib/utils'

interface Props {
  ws: WorkflowState
  update: (p: Partial<WorkflowState>) => void
  goTo:   (s: WorkflowStep) => void
}

export function ExtractStep({ ws, update, goTo }: Props) {
  const [log,    setLog]    = useState<string[]>([])
  const [status, setStatus] = useState<string>('extracting')
  const [error,  setError]  = useState<string | null>(null)
  const logRef              = useRef<HTMLDivElement>(null)
  const started             = useRef(false)

  useEffect(() => {
    if (started.current || !ws.sessionId) return
    started.current = true

    const run = async () => {
      try {
        await api.startExtraction(ws.sessionId!)
        // Poll every 1.5 s
        while (true) {
          await sleep(1500)
          const data = await api.pollSession(ws.sessionId!)
          setLog([...data.log])
          setStatus(data.status)
          update({ session: data })

          if (data.status === 'extracted') break
          if (data.status === 'error') {
            setError(data.error ?? 'Extraction failed')
            break
          }
        }
      } catch (e: any) {
        setError(e.message)
      }
    }
    run()
  }, [])   // eslint-disable-line

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const session     = ws.session
  const imageCount  = session?.images?.length ?? 0
  const done        = status === 'extracted'
  const hasError    = status === 'error'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        {!done && !hasError && <Spinner className="w-5 h-5" />}
        {done    && <CheckCircle2 className="w-5 h-5 text-success" />}
        {hasError && <AlertCircle className="w-5 h-5 text-danger"  />}
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            {done ? 'Extraction Complete' : hasError ? 'Extraction Failed' : 'Extracting Files…'}
          </h1>
          <p className="text-sm text-muted">
            {done
              ? `${imageCount} image(s) ready for review · ${session?.token_estimate?.toLocaleString() ?? 0} tokens`
              : 'Processing your files — this may take 10–30 seconds…'
            }
          </p>
        </div>
      </div>

      {/* Live log */}
      <div
        ref={logRef}
        className="bg-bg border border-border rounded-xl p-4 h-56 overflow-y-auto font-mono text-xs space-y-1"
      >
        {log.length === 0 && (
          <span className="text-muted">Starting extraction…</span>
        )}
        {log.map((line, i) => (
          <div key={i} className={
            line.includes('❌') ? 'text-danger' :
            line.includes('✅') ? 'text-success' :
            line.startsWith('📊') || line.startsWith('📄') ? 'text-accent' :
            'text-slate-300'
          }>
            {line}
          </div>
        ))}
        {!done && !hasError && (
          <div className="flex items-center gap-1.5 text-muted">
            <Spinner className="w-3 h-3" /> processing…
          </div>
        )}
      </div>

      {/* Stats */}
      {done && session && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Files',    value: session.images?.length != null ? ws.session?.log?.filter(l => l.includes('📄')).length : '—' },
            { label: 'Images',   value: imageCount },
            { label: 'Tokens',   value: `~${session.token_estimate?.toLocaleString()}` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-slate-100">{value}</p>
              <p className="text-xs text-muted mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {session?.token_warning && done && (
        <Alert type={session.token_warning.startsWith('⛔') ? 'error' : session.token_warning.startsWith('⚠️') ? 'warn' : 'info'}>
          {session.token_warning}
        </Alert>
      )}

      {error && <Alert type="error">{error}</Alert>}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => goTo(1)}>← Back</Button>
        <Button
          className="flex-1 justify-center"
          disabled={!done}
          onClick={() => goTo(3)}
        >
          Review Images →
        </Button>
      </div>
    </div>
  )
}
