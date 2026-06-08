import { useState, useCallback } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkflowState, WorkflowStep } from '@/types'
import { UploadStep }       from './steps/UploadStep'
import { ExtractStep }      from './steps/ExtractStep'
import { ReviewImagesStep } from './steps/ReviewImagesStep'
import { GenerateStep }     from './steps/GenerateStep'
import { ExportStep }       from './steps/ExportStep'

const STEPS = [
  { n: 1, label: 'Upload'   },
  { n: 2, label: 'Extract'  },
  { n: 3, label: 'Review'   },
  { n: 4, label: 'Generate' },
  { n: 5, label: 'Export'   },
] as const

const INITIAL: WorkflowState = {
  step: 1, sessionId: null, session: null,
  subject: '', unit: '', mode: 'free', apiKey: '',
  minScore: 0.35, useFallback: true,
  prompt: '', previewHtml: '',
}

interface WorkflowPageProps {
  onNoteSaved: () => void
}

export function WorkflowPage({ onNoteSaved }: WorkflowPageProps) {
  const [ws, setWs] = useState<WorkflowState>(INITIAL)

  const update = useCallback((patch: Partial<WorkflowState>) =>
    setWs(prev => ({ ...prev, ...patch })), [])

  const goTo = useCallback((step: WorkflowStep) =>
    setWs(prev => ({ ...prev, step })), [])

  const reset = useCallback(() => setWs(INITIAL), [])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Stepper */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center gap-0 max-w-2xl mx-auto">
          {STEPS.map((s, i) => {
            const done    = ws.step > s.n
            const current = ws.step === s.n
            return (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                    done    ? 'bg-success text-white'                    : '',
                    current ? 'bg-accent text-white ring-2 ring-accent/30' : '',
                    !done && !current ? 'bg-border text-muted'           : '',
                  )}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : s.n}
                  </div>
                  <span className={cn(
                    'text-[10px] mt-1 font-medium',
                    current ? 'text-accent' : done ? 'text-success' : 'text-muted',
                  )}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    'flex-1 h-px mx-2 mb-4 transition-colors',
                    ws.step > s.n ? 'bg-success/50' : 'bg-border',
                  )} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6">
        {ws.step === 1 && <UploadStep ws={ws} update={update} goTo={goTo} />}
        {ws.step === 2 && <ExtractStep ws={ws} update={update} goTo={goTo} />}
        {ws.step === 3 && <ReviewImagesStep ws={ws} update={update} goTo={goTo} />}
        {ws.step === 4 && <GenerateStep ws={ws} update={update} goTo={goTo} />}
        {ws.step === 5 && (
          <ExportStep ws={ws} update={update} goTo={goTo}
            onSaved={() => { onNoteSaved(); reset() }}
            onReset={reset}
          />
        )}
      </div>
    </div>
  )
}
