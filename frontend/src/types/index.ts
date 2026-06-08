export type GenerationMode = 'free' | 'api'

export type SessionStatus =
  | 'created' | 'uploaded' | 'extracting' | 'extracted'
  | 'generating' | 'complete' | 'error'

export interface ImageInfo {
  id:          string
  source_file: string
  page:        number
  score:       number
  alt_text:    string
  included:    boolean
  context:     string
  url:         string
}

export interface SessionData {
  id:             string
  subject:        string
  unit:           string
  mode:           GenerationMode
  status:         SessionStatus
  log:            string[]
  images:         ImageInfo[]
  token_estimate: number
  token_warning:  string
  text_preview:   string
  has_notes:      boolean
  error:          string | null
}

export interface EvalScores {
  coverage:         number
  structural:       number
  key_term_density: number
  length_adequacy:  number
  faithfulness:     number
  overall:          number
}

export interface NoteOut {
  id:             string
  subject:        string
  unit:           string
  created_at:     string
  source_files:   string[]
  image_count:    number
  token_estimate: number
  eval_scores:    EvalScores | null
  has_pdf:        boolean
}

export interface NoteDetail extends NoteOut {
  content_md:   string
  preview_html: string
}

export interface RagChunk {
  heading: string
  snippet: string
}

export interface RagResult {
  mode:      GenerationMode
  prompt?:   string
  answer?:   string
  retrieved: RagChunk[]
}

export interface EvalResult {
  scores:            EvalScores
  checks:            Record<string, boolean>
  flagged_sentences: string[]
}

// ── Workflow state (client-side) ───────────────────────────────────────────

export type WorkflowStep = 1 | 2 | 3 | 4 | 5

export interface WorkflowState {
  step:        WorkflowStep
  sessionId:   string | null
  session:     SessionData | null
  subject:     string
  unit:        string
  mode:        GenerationMode
  apiKey:      string
  minScore:    number
  useFallback: boolean
  prompt:      string
  previewHtml: string
}
