"""
routes/library.py — persistent notes library.
"""
from __future__ import annotations

import sys, uuid, json, re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))

from database    import get_db
from models      import SaveNoteRequest, RagQueryRequest, RefineRequest, ApplyRefineRequest
from services.evaluator   import evaluate
from services.rag_service import chunk_by_headings, retrieve, build_rag_prompt, RAG_SYSTEM
from core.pdf_renderer    import render_to_pdf, get_html_preview
from core.postprocessor   import strip_figures_for_prompt, restore_figures_after_refine

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _row_to_note(row) -> dict:
    scores_raw = row["eval_scores"]
    scores     = json.loads(scores_raw) if scores_raw else None
    src_files  = json.loads(row["source_files"]) if row["source_files"] else []
    return {
        "id":             row["id"],
        "subject":        row["subject"],
        "unit":           row["unit"],
        "created_at":     row["created_at"],
        "source_files":   src_files,
        "image_count":    row["image_count"],
        "token_estimate": row["token_estimate"],
        "eval_scores":    scores,
        "has_pdf":        bool(row["pdf_path"] and Path(row["pdf_path"]).exists()),
    }


def _strip_figures_for_rag(content_md: str) -> str:
    """Return markdown stripped of <figure> HTML for RAG chunking.
    Base64 images add noise to embeddings and waste storage."""
    stripped, _ = strip_figures_for_prompt(content_md)
    return stripped


def _update_note_md(note_id: str, new_display_md: str) -> None:
    """Persist updated markdown and refresh RAG chunks (figures stripped for RAG)."""
    stripped_for_rag = _strip_figures_for_rag(new_display_md)
    conn = get_db()
    conn.execute("UPDATE notes SET content_md=? WHERE id=?", (new_display_md, note_id))
    conn.execute("DELETE FROM rag_chunks WHERE note_id=?", (note_id,))
    for c in chunk_by_headings(stripped_for_rag):
        conn.execute(
            "INSERT INTO rag_chunks (id, note_id, chunk_index, heading, content) "
            "VALUES (?,?,?,?,?)",
            (uuid.uuid4().hex, note_id, c["chunk_index"], c["heading"], c["content"]),
        )
    conn.commit()
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# List / detail
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/notes")
def list_notes():
    conn = get_db()
    rows = conn.execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_row_to_note(r) for r in rows]


@router.get("/notes/{note_id}")
def get_note(note_id: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    note = _row_to_note(row)
    note["content_md"]   = row["content_md"]
    note["preview_html"] = get_html_preview(row["content_md"])
    return note


# ─────────────────────────────────────────────────────────────────────────────
# Save
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/notes")
def save_note(req: SaveNoteRequest):
    from routes.workflow import _sessions
    s = _sessions.get(req.session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if not s.get("final_markdown"):
        raise HTTPException(status_code=400, detail="No generated notes in session")

    note_id    = uuid.uuid4().hex
    now        = datetime.now(timezone.utc).isoformat()
    content_md = s["final_markdown"]
    src_files  = [Path(p).name for p in s.get("uploaded_files", [])]
    img_count  = sum(
        1 for info in s.get("image_registry", {}).values()
        if info.get("included", True)
    )

    conn = get_db()
    conn.execute(
        "INSERT INTO notes (id,subject,unit,created_at,content_md,"
        "source_files,image_count,token_estimate) VALUES (?,?,?,?,?,?,?,?)",
        (note_id, s["subject"], s["unit"], now, content_md,
         json.dumps(src_files), img_count, s.get("token_estimate", 0)),
    )
    conn.commit()

    # RAG chunks — strip figures so base64 doesn't pollute embeddings
    stripped_for_rag = _strip_figures_for_rag(content_md)
    for c in chunk_by_headings(stripped_for_rag):
        conn.execute(
            "INSERT INTO rag_chunks (id,note_id,chunk_index,heading,content) "
            "VALUES (?,?,?,?,?)",
            (uuid.uuid4().hex, note_id, c["chunk_index"], c["heading"], c["content"]),
        )
    conn.commit()
    conn.close()
    return {"note_id": note_id}


# ─────────────────────────────────────────────────────────────────────────────
# Delete
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/notes/{note_id}")
def delete_note(note_id: str):
    conn = get_db()
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Evaluate
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/evaluate")
def evaluate_note(note_id: str):
    conn = get_db()
    row  = conn.execute("SELECT content_md FROM notes WHERE id=?", (note_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    content_md = row["content_md"]
    conn.close()

    # Use stripped version as both source proxy and target
    # (avoids base64 strings polluting coverage/faithfulness metrics)
    stripped, _ = strip_figures_for_prompt(content_md)
    words       = stripped.split()
    midway      = max(len(words) // 3, 1)
    src_proxy   = " ".join(words[: midway * 2])

    result = evaluate(src_proxy, stripped)
    now    = datetime.now(timezone.utc).isoformat()

    conn = get_db()
    conn.execute(
        "INSERT INTO evaluations (id,note_id,evaluated_at,scores,flagged_sentences) "
        "VALUES (?,?,?,?,?)",
        (uuid.uuid4().hex, note_id, now,
         json.dumps(result["scores"]),
         json.dumps(result.get("flagged_sentences", []))),
    )
    conn.execute("UPDATE notes SET eval_scores=? WHERE id=?",
                 (json.dumps(result["scores"]), note_id))
    conn.commit()
    conn.close()

    return {
        "scores":            result["scores"],
        "checks":            result["checks"],
        "flagged_sentences": result["flagged_sentences"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# RAG query
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/rag")
def rag_query(note_id: str, req: RagQueryRequest):
    conn   = get_db()
    chunks = conn.execute(
        "SELECT heading, content, chunk_index FROM rag_chunks "
        "WHERE note_id=? ORDER BY chunk_index",
        (note_id,),
    ).fetchall()
    conn.close()

    if not chunks:
        raise HTTPException(status_code=400, detail="No RAG chunks — save note first")

    chunk_dicts = [
        {"heading": r["heading"], "content": r["content"], "chunk_index": r["chunk_index"]}
        for r in chunks
    ]
    retrieved = retrieve(chunk_dicts, req.query, top_k=3)
    prompt    = build_rag_prompt(retrieved, req.query)

    if req.mode == "api" and req.api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=req.api_key)
            resp   = client.messages.create(
                model="claude-sonnet-4-20250514", max_tokens=2048,
                system=RAG_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            return {
                "mode":      "api",
                "answer":    resp.content[0].text,
                "retrieved": [{"heading": c["heading"], "snippet": c["content"][:200]}
                              for c in retrieved],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {
        "mode":      "free",
        "prompt":    prompt,
        "retrieved": [{"heading": c["heading"], "snippet": c["content"][:200]}
                      for c in retrieved],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Preview page
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/notes/{note_id}/preview-page", response_class=HTMLResponse)
def note_preview_page(note_id: str):
    conn = get_db()
    row  = conn.execute("SELECT content_md FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    if not row:
        return HTMLResponse(
            "<html><body style='padding:40px;font-family:sans-serif;color:#888'>"
            "<p>Note not found.</p></body></html>"
        )
    return HTMLResponse(get_html_preview(row["content_md"]))


# ─────────────────────────────────────────────────────────────────────────────
# Export PDF
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/notes/{note_id}/export-pdf")
def export_note_pdf(note_id: str):
    conn = get_db()
    row  = conn.execute(
        "SELECT content_md, pdf_path, subject, unit FROM notes WHERE id=?",
        (note_id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    import tempfile
    safe     = re.sub(r"[^\w\-]", "_", f"{row['subject']}_{row['unit']}")[:60]
    pdf_dir  = Path(tempfile.gettempdir()) / "smart_notes_exports"
    pdf_dir.mkdir(exist_ok=True)
    pdf_path = str(pdf_dir / f"{safe}_{note_id[:8]}.pdf")

    ok, result = render_to_pdf(row["content_md"], pdf_path)
    if ok:
        conn2 = get_db()
        conn2.execute("UPDATE notes SET pdf_path=? WHERE id=?", (pdf_path, note_id))
        conn2.commit()
        conn2.close()
        return FileResponse(pdf_path, filename=f"{safe}.pdf", media_type="application/pdf")

    html_path = pdf_path.replace(".pdf", ".html")
    if Path(html_path).exists():
        return FileResponse(html_path, filename=f"{safe}.html", media_type="text/html")
    raise HTTPException(status_code=500, detail=result)


# ─────────────────────────────────────────────────────────────────────────────
# Agent refinement for saved notes
# ─────────────────────────────────────────────────────────────────────────────

_REFINE_SYSTEM = """You are refining an existing academic study-notes document.
Make ONLY the specific change the student requested. Do not restructure, reorder,
or improve anything else.

CRITICAL RULES
1. Preserve ALL {{REFINE_IMG_NNN}} image placeholder tokens exactly where they
   appear. Only move a token if it makes better contextual sense.
2. Maintain every Markdown formatting convention: ## / ### headings,
   **bold key terms**, tables, code blocks, blockquotes, Quick Summary bullets,
   Exam Practice section.
3. Return ONLY the modified content — no preamble, no explanation.
4. For a section change: return the complete modified section from its ## heading.
5. For a full-document change: return the complete modified document from the # title.
"""


def _detect_scope(prompt: str, notes_md: str) -> tuple[str, str | None]:
    headings = re.findall(r"^## (.+)$", notes_md, re.MULTILINE)
    pl = prompt.lower()
    for h in headings:
        if h.lower() in ("table of contents", "exam practice", "quick summary"):
            continue
        words = {w for w in re.findall(r"\b\w{4,}\b", h.lower())}
        if words and any(w in pl for w in words):
            return "local", h
    return "global", None


def _extract_section(md: str, heading: str) -> str:
    m = re.search(
        rf"^## {re.escape(heading)}.*?(?=^## |\Z)", md,
        re.MULTILINE | re.DOTALL
    )
    return m.group(0).strip() if m else md


def _replace_section(md: str, heading: str, new_content: str) -> str:
    return re.sub(
        rf"^## {re.escape(heading)}.*?(?=^## |\Z)",
        new_content.strip() + "\n\n", md,
        flags=re.MULTILINE | re.DOTALL
    )


def _apply_note_changes(
    note_id: str,
    original_display_md: str,
    raw_response: str,
    scope: str,
    heading: str | None,
    fig_reg: dict,
    stripped_original: str,
) -> None:
    """Merge Claude's response, restore figures, persist to DB."""
    if scope == "local" and heading and stripped_original:
        new_stripped = _replace_section(stripped_original, heading, raw_response)
    else:
        new_stripped = raw_response

    new_display_md = restore_figures_after_refine(new_stripped, fig_reg)
    _update_note_md(note_id, new_display_md)


@router.post("/notes/{note_id}/refine")
def refine_note(note_id: str, req: RefineRequest):
    conn = get_db()
    row  = conn.execute("SELECT content_md FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    original_md = row["content_md"]

    # Strip figures → compact prompt-safe text
    stripped, fig_reg = strip_figures_for_prompt(original_md)
    scope, heading    = _detect_scope(req.prompt, stripped)

    to_modify   = _extract_section(stripped, heading) if (scope == "local" and heading) else stripped
    instruction = (f"Modify ONLY section ## {heading}. Return the complete modified section."
                   if (scope == "local" and heading)
                   else "Modify the complete document. Return the complete modified notes.")

    user_msg    = (f"CHANGE REQUEST: {req.prompt}\n\n"
                   f"INSTRUCTION: {instruction}\n\n"
                   f"--- CONTENT TO MODIFY ---\n\n{to_modify}")
    full_prompt = _REFINE_SYSTEM + "\n\n---\n\n" + user_msg
    tok         = len(full_prompt) // 4

    if req.mode == "api" and req.api_key:
        try:
            import anthropic
            client   = anthropic.Anthropic(api_key=req.api_key)
            response = client.messages.create(
                model="claude-sonnet-4-20250514", max_tokens=8192,
                system=_REFINE_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            _apply_note_changes(
                note_id, original_md, response.content[0].text,
                scope, heading, fig_reg, stripped,
            )
            return {"mode": "applied", "scope": scope, "section": heading}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {
        "mode":           "free",
        "prompt":         full_prompt,
        "scope":          scope,
        "section":        heading,
        "token_estimate": tok,
        # Store context so apply-refine can use it
        "_stripped":      stripped,
        "_fig_reg_keys":  list(fig_reg.keys()),   # can't send HTML over JSON safely
    }


@router.post("/notes/{note_id}/apply-refine")
def apply_note_refine(note_id: str, req: ApplyRefineRequest):
    if not req.response.strip():
        raise HTTPException(status_code=400, detail="Empty response")
    conn = get_db()
    row  = conn.execute("SELECT content_md FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    original_md       = row["content_md"]
    stripped, fig_reg = strip_figures_for_prompt(original_md)

    # Detect scope from the response itself (first heading line)
    scope, heading = _detect_scope(req.response[:300], stripped)

    _apply_note_changes(
        note_id, original_md, req.response,
        scope, heading, fig_reg, stripped,
    )
    return {"mode": "applied", "scope": scope, "section": heading}


# ─────────────────────────────────────────────────────────────────────────────
# RAG message history
# ─────────────────────────────────────────────────────────────────────────────

class SaveMessageRequest(BaseModel):
    role:      str
    content:   str
    retrieved: Optional[list] = None


@router.get("/notes/{note_id}/messages")
def get_messages(note_id: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT role, content, retrieved FROM rag_messages "
        "WHERE note_id=? ORDER BY created_at ASC",
        (note_id,),
    ).fetchall()
    conn.close()
    return [
        {"role": r["role"], "content": r["content"],
         "retrieved": json.loads(r["retrieved"]) if r["retrieved"] else None}
        for r in rows
    ]


@router.post("/notes/{note_id}/messages")
def save_message(note_id: str, msg: SaveMessageRequest):
    conn = get_db()
    conn.execute(
        "INSERT INTO rag_messages (id,note_id,created_at,role,content,retrieved) "
        "VALUES (?,?,?,?,?,?)",
        (uuid.uuid4().hex, note_id, datetime.now(timezone.utc).isoformat(),
         msg.role, msg.content,
         json.dumps(msg.retrieved) if msg.retrieved is not None else None),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/notes/{note_id}/messages")
def clear_messages(note_id: str):
    conn = get_db()
    conn.execute("DELETE FROM rag_messages WHERE note_id=?", (note_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
