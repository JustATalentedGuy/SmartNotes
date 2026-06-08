"""
postprocessor.py
Reinserts actual images into Claude's Markdown output by replacing
{{IMG_NNN}} tokens with self-contained HTML <figure> elements (base64 embedded).

Two-stage approach:
  Stage 1 — Direct replacement: {{IMG_NNN}} tokens Claude preserved get swapped in.
  Stage 2 — Fallback insertion: tokens Claude dropped get inserted via keyword
             matching against the generated text, ensuring no useful diagram is lost.
"""

import re
import base64
from pathlib import Path
from PIL import Image as PILImage
import io


# Maximum pixel width for embedded images (keeps PDF/HTML file size manageable)
_MAX_EMBED_WIDTH = 1100


# ─────────────────────────────────────────────
# Stage 1 — Direct replacement
# ─────────────────────────────────────────────

def inject_images(claude_text: str, image_registry: dict) -> tuple[str, dict]:
    """
    Replace {{IMG_NNN}} tokens in `claude_text` with HTML <figure> elements.

    Returns:
      final_text  — Markdown with HTML figure blocks substituted in
      report      — {placed: [ids], dropped: [(id, reason)], total_included: int}
    """
    placed: list[str] = []
    failed: list[tuple[str, str]] = []

    def _replace(match: re.Match) -> str:
        img_id = match.group(1)   # e.g. "IMG_001"

        info = image_registry.get(img_id)
        if not info:
            return ""                               # unknown placeholder

        if not info.get("included", True):
            return ""                               # user excluded it

        html = _make_figure(img_id, info)
        if html:
            placed.append(img_id)
            return f"\n\n{html}\n\n"
        else:
            failed.append((img_id, "embed_error"))
            return f"\n\n*\\[Image {img_id} — could not be embedded]*\n\n"

    result = re.sub(r"\{\{(IMG_\d{3})\}\}", _replace, claude_text)

    # Determine which included images were simply not mentioned by Claude
    all_included = [k for k, v in image_registry.items() if v.get("included", True)]
    placed_set = set(placed)
    failed_set = {fid for fid, _ in failed}
    dropped = [
        (img_id, "placeholder_omitted_by_model")
        for img_id in all_included
        if img_id not in placed_set and img_id not in failed_set
    ]

    report = {
        "placed": placed,
        "failed": failed,
        "dropped": dropped,
        "total_included": len(all_included),
    }
    return result, report


# ─────────────────────────────────────────────
# Stage 2 — Fallback insertion for dropped images
# ─────────────────────────────────────────────

def fallback_inject_dropped(
    text: str,
    image_registry: dict,
    dropped: list[tuple[str, str]],
) -> str:
    """
    For each dropped image, find the best paragraph in `text` by keyword
    overlap with the image's original context, then insert the figure there.
    Images with no keyword match are appended before the Exam Practice section.
    All auto-positioned images are tagged *(auto-positioned)* in their caption.
    """
    if not dropped:
        return text

    paragraphs = re.split(r"\n\n+", text)

    for img_id, _reason in dropped:
        info = image_registry.get(img_id)
        if not info or not info.get("included", True):
            continue

        keywords = info.get("fallback_keywords", [])
        figure = _make_figure(img_id, info, auto_positioned=True)
        if not figure:
            continue

        if keywords:
            best_idx, best_score = 0, 0
            for i, para in enumerate(paragraphs):
                para_lower = para.lower()
                score = sum(1 for kw in keywords if kw in para_lower)
                # Prefer paragraphs with headings (they define topic scope)
                if score > best_score or (score == best_score and para.startswith("#")):
                    best_score, best_idx = score, i

            if best_score > 0:
                # Insert after the best-matching paragraph
                paragraphs.insert(best_idx + 1, figure)
                continue

        # No keyword match → insert before Exam Practice section (or at end)
        _insert_before_exam(paragraphs, figure)

    return "\n\n".join(paragraphs)


def _insert_before_exam(paragraphs: list, figure: str) -> None:
    """Insert figure before the Exam section, or append if not found."""
    for i, para in enumerate(reversed(paragraphs)):
        low = para.strip().lower()
        if low.startswith("## exam") or low.startswith("## practice"):
            insert_at = len(paragraphs) - i - 1
            paragraphs.insert(insert_at, figure)
            return
    paragraphs.append(figure)


# ─────────────────────────────────────────────
# Figure HTML builder
# ─────────────────────────────────────────────

def _make_figure(img_id: str, info: dict, auto_positioned: bool = False) -> str:
    """Build a self-contained HTML <figure> with a base64-encoded image."""
    path = info.get("path", "")
    if not path or not Path(path).exists():
        return ""

    try:
        # Optionally downscale large images
        img_bytes = _resize_if_needed(path)
        b64 = base64.b64encode(img_bytes).decode("utf-8")

        ext = Path(path).suffix.lower().lstrip(".")
        mime = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "gif": "image/gif",
            "webp": "image/webp", "bmp": "image/png",  # bmp → encode as png
        }.get(ext, "image/png")

        alt    = info.get("alt_text", img_id).replace('"', "'")
        source = info.get("source_file", "")
        page   = info.get("page", "")
        score  = info.get("score", 0)

        page_str  = f"p.{int(page) + 1}" if isinstance(page, (int, float)) else ""
        pos_note  = " <em>(auto-positioned)</em>" if auto_positioned else ""
        caption   = f"{alt} — <em>{source} {page_str}</em>{pos_note}"

        return (
            '<figure class="extracted-image">\n'
            f'  <img src="data:{mime};base64,{b64}" alt="{alt}">\n'
            f'  <figcaption>{caption}</figcaption>\n'
            '</figure>'
        )
    except Exception as e:
        return f"<!-- image {img_id} embed failed: {e} -->"


def _resize_if_needed(path: str) -> bytes:
    """Return image bytes, downscaling width to _MAX_EMBED_WIDTH if needed."""
    try:
        img = PILImage.open(path)
        w, h = img.size
        if w > _MAX_EMBED_WIDTH:
            ratio = _MAX_EMBED_WIDTH / w
            new_h = int(h * ratio)
            img = img.resize((_MAX_EMBED_WIDTH, new_h), PILImage.LANCZOS)
        # Always encode as PNG for lossless consistency
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    except Exception:
        # Fall back to raw bytes
        with open(path, "rb") as f:
            return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# Figure strip / restore  (for Agent refinement)
# ─────────────────────────────────────────────────────────────────────────────
#
# final_markdown stores notes with <figure class="extracted-image"> blocks that
# contain base64-encoded images.  Sending those to Claude during a refine call
# wastes thousands of tokens and hits context limits.
#
# Solution: strip all <figure> blocks → replace with {{REFINE_IMG_NNN}} tokens
# → send the clean, token-only text to Claude → restore figures afterward.
# Claude preserves (or repositions) the tokens, so images end up correctly placed.

_FIGURE_RE = re.compile(
    r'<figure[^>]*class=["\']extracted-image["\'][^>]*>.*?</figure>',
    re.DOTALL | re.IGNORECASE,
)


def strip_figures_for_prompt(md: str) -> tuple[str, dict[str, str]]:
    """
    Replace every <figure class="extracted-image">…</figure> block with a
    short  {{REFINE_IMG_NNN}}  token.

    Returns
    -------
    stripped : str
        Markdown with all figures replaced by tokens.  Safe to send to Claude.
    registry : dict[str, str]
        Maps each token back to its original figure HTML.
    """
    registry: dict[str, str] = {}
    counter  = 0

    def _sub(m: re.Match) -> str:
        nonlocal counter
        counter += 1
        token              = "{{REFINE_IMG_" + f"{counter:03d}" + "}}"
        registry[token]    = m.group(0)
        return f"\n\n{token}\n\n"

    stripped = _FIGURE_RE.sub(_sub, md)
    stripped = re.sub(r"\n{3,}", "\n\n", stripped).strip()
    return stripped, registry


def restore_figures_after_refine(response: str, registry: dict[str, str]) -> str:
    """
    Replace  {{REFINE_IMG_NNN}}  tokens in Claude's response with the original
    figure HTML.  Tokens Claude dropped are re-inserted before the Exam section
    (or appended) so no diagram is lost.
    """
    result = response

    # First pass: replace tokens that survived in Claude's output
    for token, html in registry.items():
        if token in result:
            result = result.replace(token, f"\n\n{html}\n\n")

    # Second pass: re-insert any tokens Claude dropped
    for token, html in registry.items():
        if html not in result:          # figure not yet in document
            exam = re.search(r"^## Exam", result, re.MULTILINE)
            if exam:
                pos    = exam.start()
                result = result[:pos] + f"\n\n{html}\n\n" + result[pos:]
            else:
                result = result.rstrip() + f"\n\n{html}\n\n"

    return re.sub(r"\n{3,}", "\n\n", result).strip()
