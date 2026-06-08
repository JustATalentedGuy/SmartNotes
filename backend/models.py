"""models.py — Pydantic request / response schemas."""
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional
from enum import Enum


class GenerationMode(str, Enum):
    free = "free"
    api  = "api"


# ── Workflow ──────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    subject:         str
    unit:            str
    mode:            GenerationMode = GenerationMode.free
    min_image_score: float = 0.35


class ImageToggle(BaseModel):
    included: bool


class BuildPromptRequest(BaseModel):
    pass   # no extra fields needed; subject/unit already in session


class ProcessResponseRequest(BaseModel):
    response:     str
    use_fallback: bool = True


class GenerateApiRequest(BaseModel):
    api_key:      str
    use_fallback: bool = True


# ── Library ───────────────────────────────────────────────────────────────

class SaveNoteRequest(BaseModel):
    session_id: str


class RagQueryRequest(BaseModel):
    query:   str
    mode:    GenerationMode = GenerationMode.free
    api_key: Optional[str] = None


# ── Response shapes ───────────────────────────────────────────────────────

class ImageInfo(BaseModel):
    id:          str
    source_file: str
    page:        int
    score:       float
    alt_text:    str
    included:    bool
    context:     str


class EvalScores(BaseModel):
    coverage:        float   # 0-1  TF-IDF keyword coverage
    structural:      float   # 0-1  heading/table/code presence
    key_term_density: float  # 0-1  bold terms / total words
    length_adequacy: float   # 0-1  notes length vs source length
    faithfulness:    float   # 0-1  semantic (or Jaccard) overlap
    overall:         float   # weighted mean


class NoteOut(BaseModel):
    id:             str
    subject:        str
    unit:           str
    created_at:     str
    source_files:   list[str]
    image_count:    int
    token_estimate: int
    eval_scores:    Optional[EvalScores]
    has_pdf:        bool


class NoteDetail(NoteOut):
    content_md: str


# ── Agent refinement ──────────────────────────────────────────────────────────

class RefineRequest(BaseModel):
    prompt:  str
    mode:    GenerationMode = GenerationMode.free
    api_key: Optional[str] = None

class ApplyRefineRequest(BaseModel):
    response: str     # Claude's modified content (section or full doc)
