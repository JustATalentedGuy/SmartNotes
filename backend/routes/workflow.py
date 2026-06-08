"""
routes/workflow.py — session workflow endpoints.
"""
from __future__ import annotations

import os, sys, uuid, json, re, tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, BackgroundTasks, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse

sys.path.insert(0, str(Path(__file__).parent.parent))

from models import (
    StartSessionRequest, ImageToggle,
    ProcessResponseRequest, GenerateApiRequest,
    RefineRequest, ApplyRefineRequest,
)
from core.extractor      import extract_file
from core.image_filter   import filter_images, assign_placeholder_ids
from core.prompt_builder import (
    SYSTEM_PROMPT, combine_extractions, preprocess_text,
    build_user_message, estimate_tokens, token_warning,
)
from core.postprocessor  import (
    inject_images, fallback_inject_dropped,
    strip_figures_for_prompt, restore_figures_after_refine,
)
from core.pdf_renderer   import render_to_pdf, get_html_preview

router    = APIRouter()
_executor = ThreadPoolExecutor(max_workers=4)

_sessions: dict[str, dict] = {}

SESSION_BASE = Path(tempfile.gettempdir()) / "smart_notes_sessions"
SESSION_BASE.mkdir(exist_ok=True)


def _get_session(session_id: str) -> dict:
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


def _rebuild_combined(s: dict) -> None:
    combined = combine_extractions(s["extractions"], s["image_registry"])
    s["combined_markdown"] = preprocess_text(combined)
    s["token_estimate"]    = estimate_tokens(s["combined_markdown"])
    s["token_warning"]     = token_warning(s["token_estimate"])


# ── Create session ──────────────────────────────────────────────────────────

@router.post("/sessions")
def create_session(req: StartSessionRequest):
    sid         = uuid.uuid4().hex
    session_dir = SESSION_BASE / sid
    session_dir.mkdir(parents=True)
    _sessions[sid] = {
        "id": sid, "subject": req.subject, "unit": req.unit,
        "mode": req.mode, "min_image_score": req.min_image_score,
        "status": "created", "log": [],
        "session_dir": str(session_dir),
        "uploaded_files": [], "extractions": [], "image_registry": {},
        "combined_markdown": "", "built_prompt": "",
        "final_markdown": "",
        "token_estimate": 0, "token_warning": "", "error": None,
        "pre_refine_markdown": None,
        "refine_figure_registry": None,
        "refine_stripped_original": None,
    }
    return {"session_id": sid}


# ── Upload ──────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/upload")
async def upload_files(session_id: str, files: list[UploadFile] = File(...)):
    s = _get_session(session_id)
    session_dir = Path(s["session_dir"])
    saved = []
    for f in files:
        dest = session_dir / f.filename
        dest.write_bytes(await f.read())
        saved.append(str(dest))
    s["uploaded_files"] = saved
    s["status"]         = "uploaded"
    return {"uploaded": [Path(p).name for p in saved]}


# ── Extract ─────────────────────────────────────────────────────────────────

def _run_extraction(session_id: str) -> None:
    s = _sessions.get(session_id)
    if not s:
        return
    s["status"] = "extracting"
    s["log"]    = []
    log         = s["log"]
    session_dir = s["session_dir"]
    min_score   = s["min_image_score"]
    all_extractions: list[dict] = []
    all_raw_images:  list[dict] = []

    for fpath in s["uploaded_files"]:
        fname = Path(fpath).name
        log.append(f"📄 Extracting: {fname}")
        result = extract_file(fpath, session_dir)
        if result.get("error"):
            log.append(f"   ❌ {result['error']}")
        else:
            nw = len(result.get("markdown", "").split())
            ni = len(result.get("images", []))
            log.append(f"   ✅ ~{nw:,} words · {ni} image(s)")
        all_extractions.append(result)
        all_raw_images.extend(result.get("images", []))

    kept, rejected = filter_images(all_raw_images, min_score=min_score)
    registry       = assign_placeholder_ids(kept)
    log.append(f"📊 {len(all_raw_images)} raw images → {len(kept)} kept · {len(rejected)} rejected")

    s["extractions"]    = all_extractions
    s["image_registry"] = registry
    _rebuild_combined(s)
    log.append(s["token_warning"])
    s["status"] = "extracted"


@router.post("/sessions/{session_id}/extract")
def start_extraction(session_id: str, background_tasks: BackgroundTasks):
    _get_session(session_id)
    background_tasks.add_task(_run_extraction, session_id)
    return {"status": "extracting"}


# ── Poll session ─────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    s   = _get_session(session_id)
    reg = s.get("image_registry", {})
    images_out = [
        {
            "id":          img_id,
            "source_file": info["source_file"],
            "page":        info["page"],
            "score":       info["score"],
            "alt_text":    info.get("alt_text", img_id),
            "included":    info.get("included", True),
            "context":     info.get("context", "")[:150],
            "url":         f"/api/sessions/{session_id}/files/{Path(info['path']).name}",
        }
        for img_id, info in reg.items()
    ]
    return {
        "id": s["id"], "subject": s["subject"], "unit": s["unit"],
        "mode": s["mode"], "status": s["status"], "log": s["log"],
        "images": images_out,
        "token_estimate": s.get("token_estimate", 0),
        "token_warning":  s.get("token_warning", ""),
        "text_preview":   s.get("combined_markdown", "")[:3000],
        "has_notes":      bool(s.get("final_markdown")),
        "error":          s.get("error"),
    }


# ── Toggle image ─────────────────────────────────────────────────────────────

@router.put("/sessions/{session_id}/images/{img_id}")
def toggle_image(session_id: str, img_id: str, body: ImageToggle):
    s = _get_session(session_id)
    reg = s.get("image_registry", {})
    if img_id not in reg:
        raise HTTPException(status_code=404, detail="Image not found")
    reg[img_id]["included"] = body.included
    _rebuild_combined(s)
    return {"ok": True}


# ── Build free-mode prompt ──────────────────────────────────────────────────

@router.post("/sessions/{session_id}/prompt")
def build_prompt(session_id: str):
    s       = _get_session(session_id)
    combined = s.get("combined_markdown", "")
    if not combined:
        raise HTTPException(status_code=400, detail="Run extraction first")
    user_msg    = build_user_message(s["subject"], s["unit"], combined)
    full_prompt = SYSTEM_PROMPT + "\n\n---\n\n" + user_msg
    s["built_prompt"] = full_prompt
    return {
        "prompt":         full_prompt,
        "token_estimate": estimate_tokens(full_prompt),
        "token_warning":  token_warning(estimate_tokens(full_prompt)),
    }


# ── Process pasted response ─────────────────────────────────────────────────

@router.post("/sessions/{session_id}/process-response")
def process_response(session_id: str, req: ProcessResponseRequest):
    s   = _get_session(session_id)
    reg = s.get("image_registry", {})
    if not req.response.strip():
        raise HTTPException(status_code=400, detail="Empty response")
    final_md, report = inject_images(req.response, reg)
    if req.use_fallback and report["dropped"]:
        final_md = fallback_inject_dropped(final_md, reg, report["dropped"])
    s["final_markdown"] = final_md
    s["status"]         = "complete"
    return {
        "placed":       len(report["placed"]),
        "dropped":      len(report["dropped"]),
        "preview_html": get_html_preview(final_md),
    }


# ── Generate via API ────────────────────────────────────────────────────────

def _run_api_generation(session_id: str, api_key: str, use_fallback: bool) -> None:
    s = _sessions.get(session_id)
    if not s:
        return
    s["status"] = "generating"
    try:
        import anthropic
        combined = s.get("combined_markdown", "")
        user_msg = build_user_message(s["subject"], s["unit"], combined)
        client   = anthropic.Anthropic(api_key=api_key)
        resp     = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text
        reg = s.get("image_registry", {})
        final_md, report = inject_images(raw, reg)
        if use_fallback and report["dropped"]:
            final_md = fallback_inject_dropped(final_md, reg, report["dropped"])
        s["final_markdown"] = final_md
        s["status"]         = "complete"
    except Exception as e:
        s["status"] = "error"
        s["error"]  = str(e)


@router.post("/sessions/{session_id}/generate")
def generate_api(session_id: str, req: GenerateApiRequest,
                 background_tasks: BackgroundTasks):
    s = _get_session(session_id)
    if not s.get("combined_markdown"):
        raise HTTPException(status_code=400, detail="Run extraction first")
    background_tasks.add_task(_run_api_generation, session_id, req.api_key, req.use_fallback)
    return {"status": "generating"}


# ── Export PDF ──────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/export-pdf")
def export_pdf(session_id: str):
    s        = _get_session(session_id)
    final_md = s.get("final_markdown", "")
    if not final_md:
        raise HTTPException(status_code=400, detail="Generate notes first")
    safe     = re.sub(r"[^\w\-]", "_", f"{s['subject']}_{s['unit']}")[:60]
    pdf_path = str(Path(s["session_dir"]) / f"{safe}.pdf")
    ok, result = render_to_pdf(final_md, pdf_path)
    if ok:
        return {"pdf_url": f"/api/sessions/{session_id}/files/{Path(pdf_path).name}"}
    html_path = pdf_path.replace(".pdf", ".html")
    if Path(html_path).exists():
        return {
            "html_url": f"/api/sessions/{session_id}/files/{Path(html_path).name}",
            "message":  "PDF render unavailable — download HTML and print to PDF via browser.",
        }
    raise HTTPException(status_code=500, detail=result)


# ── Serve session files ─────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/files/{filename}")
def serve_file(session_id: str, filename: str):
    s           = _get_session(session_id)
    session_dir = Path(s["session_dir"]).resolve()
    candidates  = [
        session_dir / filename,
        session_dir / "imgs"       / filename,
        session_dir / "raw_images" / filename,
    ]
    resolved = next((c for c in candidates if c.exists()), None)
    if resolved is None:
        matches  = list(session_dir.rglob(filename))
        resolved = matches[0] if matches else None
    if resolved is None:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found")
    try:
        resolved.resolve().relative_to(session_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    return FileResponse(str(resolved))


# ── Preview page ─────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/preview-page", response_class=HTMLResponse)
def preview_page(session_id: str):
    try:
        s = _get_session(session_id)
    except Exception:
        return HTMLResponse("<html><body style='font-family:sans-serif;padding:40px;color:#888'>"
                            "<p>Session not found.</p></body></html>")
    final_md = s.get("final_markdown", "")
    if not final_md:
        return HTMLResponse("<html><body style='font-family:sans-serif;padding:40px;color:#888'>"
                            "<p>Notes not generated yet.</p></body></html>")
    return HTMLResponse(get_html_preview(final_md))


# ── Agent refinement ─────────────────────────────────────────────────────────

_REFINE_SYSTEM = """You are refining an existing academic study-notes document.
Make ONLY the specific change the student requested. Do not restructure, reorder,
or improve anything else.

CRITICAL RULES
1. Preserve ALL {{REFINE_IMG_NNN}} image placeholder tokens exactly where they
   appear (these represent diagrams from the original notes). Only move a token
   if it makes better contextual sense.
2. Maintain every Markdown formatting convention already in the document:
   ## / ### heading hierarchy · **bold key terms** · tables · code blocks ·
   blockquotes · Quick Summary bullets · Exam Practice section.
3. Return ONLY the modified content — no preamble, no explanation, no commentary.
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


def _finish_refine(session: dict, raw_response: str) -> dict:
    """
    Merge Claude's response (which contains {{REFINE_IMG_NNN}} tokens) back
    into the full notes, restore the original figure HTML, and update the
    session's final_markdown.
    """
    pending  = session.get("refine_pending") or {}
    scope    = pending.get("scope", "global")
    heading  = pending.get("heading")
    stripped = session.get("refine_stripped_original", "")
    fig_reg  = session.get("refine_figure_registry", {})

    # Save for undo
    session["pre_refine_markdown"] = session.get("final_markdown", "")

    # Merge response into the stripped (token-based) version of the full doc
    if scope == "local" and heading and stripped:
        new_stripped = _replace_section(stripped, heading, raw_response)
    else:
        new_stripped = raw_response

    # Restore <figure> HTML from tokens
    new_final = restore_figures_after_refine(new_stripped, fig_reg)

    session["final_markdown"]          = new_final
    session["refine_pending"]          = None
    session["refine_stripped_original"] = None
    session["refine_figure_registry"]   = None

    return {"mode": "applied", "scope": scope, "section": heading}


@router.post("/sessions/{session_id}/refine")
def build_refine_prompt(session_id: str, req: RefineRequest):
    """
    Strip figures from the notes → build a compact prompt → either return it
    for free-mode copy-paste, or call Claude directly (API mode).
    """
    s        = _get_session(session_id)
    final_md = s.get("final_markdown", "")
    if not final_md:
        raise HTTPException(status_code=400, detail="No notes to refine")

    # ── Strip <figure> HTML → get prompt-safe stripped text + registry ──────
    stripped, fig_reg = strip_figures_for_prompt(final_md)

    # Store for apply-refine step
    s["refine_figure_registry"]    = fig_reg
    s["refine_stripped_original"]  = stripped

    scope, heading = _detect_scope(req.prompt, stripped)

    if scope == "local" and heading:
        to_modify   = _extract_section(stripped, heading)
        instruction = (f"Modify ONLY this section. "
                       f"Return the complete modified section starting with ## {heading}.")
    else:
        to_modify   = stripped
        instruction = ("Modify the complete document. "
                       "Return the complete modified notes starting with the # title.")

    user_msg    = (f"CHANGE REQUEST: {req.prompt}\n\n"
                   f"INSTRUCTION: {instruction}\n\n"
                   f"--- CONTENT TO MODIFY ---\n\n{to_modify}")
    full_prompt = _REFINE_SYSTEM + "\n\n---\n\n" + user_msg

    s["refine_pending"] = {"scope": scope, "heading": heading, "prompt": req.prompt}

    tok = estimate_tokens(full_prompt)

    # API mode — call Claude directly
    if req.mode == "api" and req.api_key:
        try:
            import anthropic
            client   = anthropic.Anthropic(api_key=req.api_key)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=8192,
                system=_REFINE_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            return _finish_refine(s, response.content[0].text)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Free mode — return prompt for copy-paste
    return {
        "mode":            "free",
        "prompt":          full_prompt,
        "scope":           scope,
        "section":         heading,
        "token_estimate":  tok,
    }


@router.post("/sessions/{session_id}/apply-refine")
def apply_refine(session_id: str, req: ApplyRefineRequest):
    """Apply a pasted refined response (free mode)."""
    s = _get_session(session_id)
    if not req.response.strip():
        raise HTTPException(status_code=400, detail="Empty response")
    return _finish_refine(s, req.response)


@router.post("/sessions/{session_id}/undo-refine")
def undo_refine(session_id: str):
    s    = _get_session(session_id)
    prev = s.get("pre_refine_markdown")
    if prev:
        s["final_markdown"]    = prev
        s["pre_refine_markdown"] = None
    return {"ok": True}
