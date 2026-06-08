"""
services/rag_service.py

RAG retrieval over saved note chunks.
sentence-transformers and sklearn are checked ONCE at module load.
"""
from __future__ import annotations
import re
from typing import Any

# ── One-time availability ─────────────────────────────────────────────────────
try:
    from sentence_transformers import SentenceTransformer as _ST
    import numpy as _np
    _HAS_ST = True
except Exception:
    _HAS_ST = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer as _TFV
    from sklearn.metrics.pairwise import cosine_similarity as _cos_sim
    import numpy as _np          # may already be set; harmless re-bind
    _HAS_SKLEARN = True
except Exception:
    _HAS_SKLEARN = False


# ─────────────────────────────────────────────────────────────────────────────
# Chunking
# ─────────────────────────────────────────────────────────────────────────────

def chunk_by_headings(notes_md: str) -> list[dict]:
    parts  = re.split(r"(?m)^(?=## )", notes_md)
    chunks = []
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(#{1,3} .+)", part)
        chunks.append({"heading": m.group(1) if m else f"Section {i}",
                       "content": part, "chunk_index": i})
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# Retrieval
# ─────────────────────────────────────────────────────────────────────────────

def _jaccard_scores(texts: list[str], query: str) -> list[float]:
    q_words = set(re.findall(r"\b\w{3,}\b", query.lower()))
    scores  = []
    for t in texts:
        t_words = set(re.findall(r"\b\w{3,}\b", t.lower()))
        scores.append(len(q_words & t_words) / max(len(q_words | t_words), 1))
    return scores


def retrieve(chunks: list[dict], query: str, top_k: int = 3) -> list[dict]:
    if not chunks:
        return []
    texts = [c["content"] for c in chunks]

    if _HAS_ST:
        model    = _ST("all-MiniLM-L6-v2")
        embs     = model.encode(texts + [query], show_progress_bar=False, convert_to_numpy=True)
        c_emb    = embs[:-1]
        q_emb    = embs[-1:]
        c_norm   = c_emb / (_np.linalg.norm(c_emb, axis=1, keepdims=True) + 1e-9)
        q_norm   = q_emb / (_np.linalg.norm(q_emb) + 1e-9)
        scores   = (c_norm @ q_norm.T).flatten().tolist()
    elif _HAS_SKLEARN:
        vec    = _TFV(stop_words="english")
        tfidf  = vec.fit_transform(texts + [query])
        scores = _cos_sim(tfidf[-1:], tfidf[:-1]).flatten().tolist()
    else:
        scores = _jaccard_scores(texts, query)

    indexed = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    return [chunks[i] for i, _ in indexed[:top_k]]


# ─────────────────────────────────────────────────────────────────────────────
# Prompt assembly
# ─────────────────────────────────────────────────────────────────────────────

RAG_SYSTEM = (
    "You are a study assistant. Answer the student's question using ONLY "
    "the provided note excerpts. Cite which section each point comes from. "
    "If the notes don't cover the question, say so and suggest what to look up."
)


def build_rag_prompt(retrieved: list[dict], question: str) -> str:
    parts = [
        f"--- Excerpt {i}: {c['heading']} ---\n{c['content'][:1200]}"
        for i, c in enumerate(retrieved, 1)
    ]
    return (
        f"{RAG_SYSTEM}\n\n"
        f"=== RELEVANT NOTE EXCERPTS ===\n\n"
        f"{chr(10).join(parts)}\n\n"
        f"=== QUESTION ===\n{question}\n\n"
        "Answer clearly using the excerpts above."
    )
