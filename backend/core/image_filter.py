"""
image_filter.py
Scores and filters extracted images to keep only meaningful diagrams/figures.

Scoring factors (weighted composite 0.0 – 1.0):
  • Pixel dimensions    — larger images carry more information
  • File size           — more bytes = more detail
  • Aspect ratio        — extreme ratios = banners/borders
  • Colour entropy      — blank/white images have low entropy
  • Non-blankness       — mostly-white images are usually decorative
  • Content hash dedup  — identical images across files are deduplicated
"""

import math
import hashlib
from pathlib import Path


# ─────────────────────────────────────────────
# Scoring
# ─────────────────────────────────────────────

def score_image(img_path: str) -> float:
    """Return a quality score 0.0–1.0 for an image."""
    try:
        from PIL import Image
    except ImportError:
        return 0.5  # Can't score — assume useful

    try:
        img = Image.open(img_path)
        img.load()          # force decode
        w, h = img.size
    except Exception:
        return 0.0

    # 1. Size score — min-dimension normalised; cap at 400 px
    min_dim = min(w, h)
    max_dim = max(w, h)
    size_score = min(min_dim / 150.0, 1.0) * 0.4 + min(max_dim / 300.0, 1.0) * 0.6

    # 2. Aspect ratio score — penalise extreme banners/slivers
    aspect = w / max(h, 1)
    if 0.25 <= aspect <= 4.0:
        aspect_score = 1.0
    elif 0.10 <= aspect <= 8.0:
        aspect_score = 0.55
    else:
        aspect_score = 0.1

    # 3. File-size score — 50 KB+ earns full credit
    try:
        file_kb = Path(img_path).stat().st_size / 1024
        file_score = min(file_kb / 50.0, 1.0)
    except Exception:
        file_score = 0.5

    # 4. Colour entropy — complex diagram vs blank slide
    try:
        gray = img.convert("L")
        hist = gray.histogram()
        total = sum(hist)
        entropy = 0.0
        if total > 0:
            for count in hist:
                if count > 0:
                    p = count / total
                    entropy -= p * math.log2(p)
        entropy_score = min(entropy / 5.5, 1.0)   # ~5.5 bits ≈ rich image
    except Exception:
        entropy_score = 0.5

    # 5. Non-blankness — percentage of near-white pixels
    try:
        gray = img.convert("L")
        pixels = list(gray.getdata())
        n = max(len(pixels), 1)
        white_ratio = sum(1 for p in pixels if p > 238) / n
        blank_score = 1.0 - (white_ratio ** 1.5)
    except Exception:
        blank_score = 0.5

    score = (
        size_score    * 0.25 +
        aspect_score  * 0.20 +
        file_score    * 0.20 +
        entropy_score * 0.20 +
        blank_score   * 0.15
    )
    return round(min(max(score, 0.0), 1.0), 3)


# ─────────────────────────────────────────────
# Deduplication
# ─────────────────────────────────────────────

def _file_hash(path: str) -> str | None:
    try:
        with open(path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return None


# ─────────────────────────────────────────────
# Main filter entry point
# ─────────────────────────────────────────────

def filter_images(images: list, min_score: float = 0.35) -> tuple[list, list]:
    """
    Split images into (kept, rejected).

    Rejection reasons:
      file_not_found  — path does not exist
      too_small       — below 80 × 60 px minimum
      duplicate       — same bytes as an earlier image
      low_score_X.XX  — composite score below threshold
    """
    seen_hashes: set[str] = set()
    kept: list = []
    rejected: list = []

    for img in images:
        path = img.get("path", "")

        # ── Existence check ──────────────────────
        if not path or not Path(path).exists():
            rejected.append({**img, "score": 0.0, "reject_reason": "file_not_found"})
            continue

        # ── Minimum dimension check ──────────────
        try:
            from PIL import Image
            with Image.open(path) as pil_img:
                w, h = pil_img.size
            if w < 80 or h < 60:
                rejected.append({**img, "score": 0.0, "reject_reason": "too_small"})
                continue
        except Exception:
            pass  # PIL unavailable or file unreadable — proceed to scoring

        # ── Deduplication ────────────────────────
        h = _file_hash(path)
        if h:
            if h in seen_hashes:
                rejected.append({**img, "score": 0.0, "reject_reason": "duplicate"})
                continue
            seen_hashes.add(h)

        # ── Quality score ────────────────────────
        score = score_image(path)
        img_copy = {**img, "score": score}

        if score >= min_score:
            kept.append(img_copy)
        else:
            rejected.append({**img_copy, "reject_reason": f"low_score_{score:.2f}"})

    # Sort kept images by score descending (best candidates first in gallery)
    kept.sort(key=lambda x: x.get("score", 0), reverse=True)
    return kept, rejected


# ─────────────────────────────────────────────
# Assign placeholder IDs
# ─────────────────────────────────────────────

def assign_placeholder_ids(images: list) -> dict:
    """
    Assign {{IMG_NNN}} IDs to filtered images.

    Returns image_registry:
      {
        "IMG_001": {
            "path": "/abs/path/to/img.png",
            "placeholder": "{{IMG_001}}",
            "context": "surrounding text ...",
            "source_file": "lecture.pdf",
            "page": 2,
            "score": 0.82,
            "alt_text": "...",
            "included": True,          # toggled by UI
            "fallback_keywords": [...] # for dropped-placeholder reinsertion
        },
        ...
      }
    """
    registry: dict = {}
    for i, img in enumerate(images):
        img_id = f"IMG_{i + 1:03d}"
        placeholder = "{{" + img_id + "}}"
        registry[img_id] = {
            **img,
            "placeholder": placeholder,
            "included": True,
            "fallback_keywords": _keywords(img.get("context", "")),
        }
    return registry


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

_STOP = {
    "the","a","an","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","can","to","of","in","on","at","by",
    "for","with","from","and","or","but","not","this","that",
    "it","its","as","each","also","which","when","then","than",
    "into","over","after","about","such","all","both","some",
}

def _keywords(text: str, n: int = 12) -> list:
    """Extract the n most frequent non-stop words from context text."""
    import re
    from collections import Counter
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    meaningful = [w for w in words if w not in _STOP]
    return [w for w, _ in Counter(meaningful).most_common(n)]
