import type {
  SessionData, NoteOut, NoteDetail,
  GenerationMode, EvalResult, RagResult,
} from '@/types'

const BASE = '/api'

async function req<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Session / Workflow ─────────────────────────────────────────────────────

export const api = {
  createSession: (subject: string, unit: string, mode: GenerationMode, minScore: number) =>
    req<{ session_id: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ subject, unit, mode, min_image_score: minScore }),
    }),

  uploadFiles: (sessionId: string, files: File[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    return fetch(`${BASE}/sessions/${sessionId}/upload`, {
      method: 'POST', body: form,
    }).then(r => r.json())
  },

  startExtraction: (sessionId: string) =>
    req<{ status: string }>(`/sessions/${sessionId}/extract`, { method: 'POST' }),

  pollSession: (sessionId: string) =>
    req<SessionData>(`/sessions/${sessionId}`),

  toggleImage: (sessionId: string, imgId: string, included: boolean) =>
    req<{ ok: boolean }>(`/sessions/${sessionId}/images/${imgId}`, {
      method: 'PUT',
      body: JSON.stringify({ included }),
    }),

  buildPrompt: (sessionId: string) =>
    req<{ prompt: string; token_estimate: number; token_warning: string }>(
      `/sessions/${sessionId}/prompt`, { method: 'POST' },
    ),

  processResponse: (sessionId: string, response: string, useFallback: boolean) =>
    req<{ placed: number; dropped: number; preview_html: string }>(
      `/sessions/${sessionId}/process-response`, {
        method: 'POST',
        body: JSON.stringify({ response, use_fallback: useFallback }),
      },
    ),

  generateApi: (sessionId: string, apiKey: string, useFallback: boolean) =>
    req<{ status: string }>(`/sessions/${sessionId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey, use_fallback: useFallback }),
    }),

  exportPdf: (sessionId: string) =>
    req<{ pdf_url?: string; html_url?: string; message?: string }>(
      `/sessions/${sessionId}/export-pdf`, { method: 'POST' },
    ),

  // ── Library ─────────────────────────────────────────────────────────────

  listNotes: () => req<NoteOut[]>('/notes'),

  getNote: (noteId: string) => req<NoteDetail>(`/notes/${noteId}`),

  saveNote: (sessionId: string) =>
    req<{ note_id: string }>('/notes', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),

  deleteNote: (noteId: string) =>
    req<{ ok: boolean }>(`/notes/${noteId}`, { method: 'DELETE' }),

  evaluateNote: (noteId: string) =>
    req<EvalResult>(`/notes/${noteId}/evaluate`, { method: 'POST' }),

  ragQuery: (noteId: string, query: string, mode: GenerationMode, apiKey?: string) =>
    req<RagResult>(`/notes/${noteId}/rag`, {
      method: 'POST',
      body: JSON.stringify({ query, mode, api_key: apiKey }),
    }),

  exportNotePdf: (noteId: string) =>
    `${BASE}/notes/${noteId}/export-pdf`,

  // ── Preview (for API-mode generation where process-response is not called) ──

  getPreview: (sessionId: string) =>
    req<{ preview_html: string }>(`/sessions/${sessionId}/preview`),

  // ── RAG message history ───────────────────────────────────────────────────

  getMessages: (noteId: string) =>
    req<Array<{ role: string; content: string; retrieved?: Array<{ heading: string; snippet: string }> | null }>>(
      `/notes/${noteId}/messages`
    ),

  saveMessage: (noteId: string, msg: { role: string; content: string; retrieved?: Array<{ heading: string; snippet: string }> | null }) =>
    req<{ ok: boolean }>(`/notes/${noteId}/messages`, {
      method: 'POST',
      body: JSON.stringify(msg),
    }),

  clearMessages: (noteId: string) =>
    req<{ ok: boolean }>(`/notes/${noteId}/messages`, { method: 'DELETE' }),

  // ── Preview page URLs (iframe src — no JSON fetch) ────────────────────────

  sessionPreviewUrl: (sessionId: string) => `/api/sessions/${sessionId}/preview-page`,
  notePreviewUrl:    (noteId:    string) => `/api/notes/${noteId}/preview-page`,

  // ── Agent refinement ─────────────────────────────────────────────────────

  buildRefinePrompt: (
    sessionId: string,
    prompt: string,
    mode: 'free' | 'api',
    apiKey?: string,
  ) =>
    req<{ mode: string; prompt?: string; scope: string; section: string | null; token_estimate?: number }>(
      `/sessions/${sessionId}/refine`,
      { method: 'POST', body: JSON.stringify({ prompt, mode, api_key: apiKey }) },
    ),

  applyRefine: (sessionId: string, response: string) =>
    req<{ mode: string; scope: string; section: string | null }>(
      `/sessions/${sessionId}/apply-refine`,
      { method: 'POST', body: JSON.stringify({ response }) },
    ),

  undoRefine: (sessionId: string) =>
    req<{ ok: boolean }>(`/sessions/${sessionId}/undo-refine`, { method: 'POST' }),

  buildNoteRefinePrompt: (
    noteId:  string,
    prompt:  string,
    mode:    'free' | 'api',
    apiKey?: string,
  ) =>
    req<{ mode: string; prompt?: string; scope: string; section: string | null; token_estimate?: number }>(
      `/notes/${noteId}/refine`,
      { method: 'POST', body: JSON.stringify({ prompt, mode, api_key: apiKey }) },
    ),

  applyNoteRefine: (noteId: string, response: string) =>
    req<{ mode: string; scope: string; section: string | null }>(
      `/notes/${noteId}/apply-refine`,
      { method: 'POST', body: JSON.stringify({ response }) },
    ),
}
