"""
services/evaluator.py

Five local evaluation metrics — zero API calls.

sklearn/numpy are probed ONCE at module load via a try block.
A flag (_HAS_SKLEARN) is set and never re-imported inside functions,
avoiding the "partially-initialised numpy module" crash that occurs when
sklearn fails due to a NumPy 1.x / 2.x ABI mismatch.
"""
from __future__ import annotations
import re
import math
from typing import Any

# ── One-time availability check ───────────────────────────────────────────────
try:
    from sklearn.feature_extraction.text import TfidfVectorizer as _TFV
    from sklearn.metrics.pairwise import cosine_similarity as _cos_sim
    import numpy as _np
    _HAS_SKLEARN = True
except Exception:
    _HAS_SKLEARN = False

try:
    from sentence_transformers import SentenceTransformer as _ST
    _HAS_ST = True
except Exception:
    _HAS_ST = False


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _words(text: str) -> list[str]:
    return re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())


def _sentences(text: str) -> list[str]:
    raw = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in raw if len(s.strip()) >= 20]


def _jaccard(a: str, b: str) -> float:
    sa, sb = set(_words(a)), set(_words(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


# ─────────────────────────────────────────────────────────────────────────────
# Metric 1 — Coverage
# ─────────────────────────────────────────────────────────────────────────────

def _coverage(source_text: str, notes_text: str) -> float:
    if _HAS_SKLEARN:
        vec = _TFV(max_features=200, stop_words="english", ngram_range=(1, 2))
        vec.fit([source_text])
        terms = vec.get_feature_names_out()
        notes_lower = notes_text.lower()
        matched = sum(1 for t in terms if t in notes_lower)
        return round(matched / max(len(terms), 1), 3)

    # Jaccard word-overlap fallback
    src   = set(_words(source_text))
    notes = set(_words(notes_text))
    if not src:
        return 0.0
    return round(len(src & notes) / len(src), 3)


# ─────────────────────────────────────────────────────────────────────────────
# Metric 2 — Structural completeness
# ─────────────────────────────────────────────────────────────────────────────

def _structural(notes_text: str) -> tuple[float, dict]:
    checks = {
        "has_h1":         bool(re.search(r"^# .+",   notes_text, re.M)),
        "has_h2":         len(re.findall(r"^## .+",  notes_text, re.M)) >= 2,
        "has_h3":         bool(re.search(r"^### .+", notes_text, re.M)),
        "has_table":      bool(re.search(r"^\|.+\|", notes_text, re.M)),
        "has_code":       bool(re.search(r"```",      notes_text)),
        "has_blockquote": bool(re.search(r"^> ",      notes_text, re.M)),
        "has_summary":    bool(re.search(r"quick summary|summary", notes_text, re.I)),
        "has_exam":       bool(re.search(r"exam practice|exam tip", notes_text, re.I)),
        "has_bold_terms": len(re.findall(r"\*\*[^*]+\*\*", notes_text)) >= 5,
        "has_toc":        bool(re.search(r"table of contents", notes_text, re.I)),
    }
    return round(sum(checks.values()) / len(checks), 3), checks


# ─────────────────────────────────────────────────────────────────────────────
# Metric 3 — Key-term density
# ─────────────────────────────────────────────────────────────────────────────

def _key_term_density(notes_text: str) -> float:
    total = max(len(_words(notes_text)), 1)
    bold  = len(re.findall(r"\*\*[^*]+\*\*", notes_text))
    code  = len(re.findall(r"`[^`]+`", notes_text))
    return round(min((bold + code) / (total / 15), 1.0), 3)


# ─────────────────────────────────────────────────────────────────────────────
# Metric 4 — Length adequacy
# ─────────────────────────────────────────────────────────────────────────────

def _length_adequacy(source_text: str, notes_text: str) -> float:
    src   = max(len(_words(source_text)), 1)
    notes = len(_words(notes_text))
    ratio = notes / src
    if 0.6 <= ratio <= 1.8:
        return 1.0
    if ratio < 0.6:
        return round(ratio / 0.6, 3)
    return round(max(0.0, 1.0 - (ratio - 1.8) / 2.0), 3)


# ─────────────────────────────────────────────────────────────────────────────
# Metric 5 — Faithfulness
# ─────────────────────────────────────────────────────────────────────────────

def _faithfulness(source_text: str, notes_text: str,
                  sample_size: int = 20) -> tuple[float, list[str]]:
    note_sents = _sentences(notes_text)
    src_sents  = _sentences(source_text)
    if not note_sents or not src_sents:
        return 1.0, []

    import random
    random.seed(42)
    sampled = random.sample(note_sents, min(sample_size, len(note_sents)))

    if _HAS_ST:
        model    = _ST("all-MiniLM-L6-v2")
        src_emb  = model.encode(src_sents, show_progress_bar=False, convert_to_numpy=True)
        note_emb = model.encode(sampled,   show_progress_bar=False, convert_to_numpy=True)
        s_norm   = src_emb  / (_np.linalg.norm(src_emb,  axis=1, keepdims=True) + 1e-9)
        n_norm   = note_emb / (_np.linalg.norm(note_emb, axis=1, keepdims=True) + 1e-9)
        max_sims = (n_norm @ s_norm.T).max(axis=1).tolist()
    elif _HAS_SKLEARN:
        vec  = _TFV(stop_words="english")
        tfidf = vec.fit_transform(src_sents + sampled)
        sims  = _cos_sim(tfidf[len(src_sents):], tfidf[:len(src_sents)])
        max_sims = sims.max(axis=1).tolist()
    else:
        max_sims = [
            max((_jaccard(s, src) for src in src_sents), default=0.0)
            for s in sampled
        ]

    threshold = 0.35
    flagged   = [s for s, sim in zip(sampled, max_sims) if sim < threshold]
    return round(float(sum(max_sims) / max(len(max_sims), 1)), 3), flagged[:10]


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def evaluate(source_text: str, notes_text: str) -> dict[str, Any]:
    cov,              _     = _coverage(source_text, notes_text), None
    cov                     = _coverage(source_text, notes_text)
    struct, checks          = _structural(notes_text)
    dens                    = _key_term_density(notes_text)
    leng                    = _length_adequacy(source_text, notes_text)
    faith, flagged          = _faithfulness(source_text, notes_text)

    overall = round(
        cov    * 0.30 +
        struct * 0.20 +
        faith  * 0.25 +
        dens   * 0.15 +
        leng   * 0.10,
        3,
    )
    return {
        "scores": {
            "coverage":          cov,
            "structural":        struct,
            "key_term_density":  dens,
            "length_adequacy":   leng,
            "faithfulness":      faith,
            "overall":           overall,
        },
        "checks":            checks,
        "flagged_sentences": flagged,
    }
