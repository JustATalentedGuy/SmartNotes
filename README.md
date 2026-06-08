# Smart Notes Generator

A full-stack AI-powered study notes tool with FastAPI backend and React TypeScript frontend.

## Architecture

```
smart_notes_v2/
├── backend/                   ← FastAPI Python backend
│   ├── main.py                ← App entry point
│   ├── database.py            ← SQLite schema
│   ├── models.py              ← Pydantic request/response types
│   ├── routes/
│   │   ├── workflow.py        ← Session, extract, generate, export
│   │   └── library.py        ← Notes CRUD, evaluation, RAG
│   ├── services/
│   │   ├── evaluator.py       ← 5-metric local evaluation
│   │   └── rag_service.py     ← Chunking + retrieval
│   └── core/                  ← UNCHANGED processing logic
│       ├── extractor.py
│       ├── image_filter.py
│       ├── prompt_builder.py
│       ├── postprocessor.py
│       └── pdf_renderer.py
└── frontend/                  ← React 18 + TypeScript + Tailwind
    └── src/
        ├── components/
        │   ├── workflow/      ← 5-step notes creation workflow
        │   ├── library/       ← Notes library + viewer
        │   └── rag/           ← Context-aware Q&A chat
        ├── api/client.ts      ← Typed API wrappers
        └── types/index.ts     ← Shared TypeScript types
```

## Quick Start

**macOS / Linux:**
```bash
chmod +x launch_mac_linux.sh
./launch_mac_linux.sh
```

**Windows:** Double-click `launch_windows.bat`

Opens at **http://localhost:5173**. Backend runs at **http://127.0.0.1:8000**.

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm 9+

## Manual Setup

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Features

### Workflow (5 steps)
1. **Upload** — drag-drop PDFs/PPTXs, set subject/unit, choose mode
2. **Extract** — live log, automatic image detection and filtering
3. **Review** — image gallery with quality scores, include/exclude toggles
4. **Generate** — Free mode (prompt copy-paste) or API mode (direct Anthropic)
5. **Export** — preview, PDF export, evaluation scores, save to library

### Notes Library
- Persistent SQLite storage organised by subject
- Search and filter by subject
- Per-note quality scores visible in card grid

### Note Viewer
- Split-panel: notes preview (isolated iframe) + RAG chat
- Re-export to PDF at any time
- Run or re-run evaluation metrics

### RAG Q&A
- Notes chunked by `##` section headings
- Semantic retrieval: sentence-transformers if installed, TF-IDF fallback
- Free mode: copy-paste ready prompt with retrieved context
- API mode: direct answer via Anthropic API

### Local Evaluation (5 metrics)
| Metric | Method |
|---|---|
| Coverage | TF-IDF keyword overlap: source key-terms in notes |
| Structural | Presence of headings, tables, code, summary, exam section |
| Key-Term Density | Bold/code spans per 100 words |
| Length Adequacy | Notes word-count / source word-count (ideal 0.6–1.8×) |
| Faithfulness | Semantic similarity of notes sentences to source (sentence-transformers or Jaccard) |

### Optional: Semantic features
Install for upgraded faithfulness evaluation and semantic RAG:
```bash
pip install sentence-transformers
```

## Two Modes Always Available

| | Free Mode | API Mode |
|---|---|---|
| Cost | Zero Cost — uses your claude.ai account | Per-token Anthropic API billing |
| Notes generation | Copy prompt → paste response | Automatic |
| RAG Q&A | Copy prompt → paste in claude.ai | Automatic |

## Design

All file processing is **100% local**. Only the generated text prompt leaves your
machine (to claude.ai or the Anthropic API). Images are never transmitted.
