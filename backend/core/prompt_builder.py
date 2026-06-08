"""
prompt_builder.py
Prepares the full Claude prompt:
  1. Cleans extracted text (removes noise, excess whitespace)
  2. Injects {{IMG_NNN}} placeholders — two strategies:
       A) Inline-ref injection: replaces ![](path) references (legacy pymupdf4llm output)
       B) Context injection:    uses keyword matching to place placeholders near
                                the most relevant paragraph (direct pymupdf output)
  3. Combines all files into one prompt-ready string
  4. Wraps with system prompt and user message
"""

import re
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert academic notes writer helping a university student create \
comprehensive, exam-ready study notes.

━━━ YOUR MISSION ━━━
Transform raw lecture slides and notes into a single, unified, beautifully \
structured reference document the student can rely on for their exam.

━━━ CONTENT RULES ━━━
1. COMPLETENESS — Include EVERY important concept, definition, theorem, \
formula, algorithm, and process from the source. Never paraphrase away detail.
2. CLARITY — Where the source is terse or jargon-heavy, add a clear \
one-sentence explanation. Do not invent facts.
3. EXAMPLES — Preserve all source examples. Add 1–2 of your own for any \
concept that benefits from illustration.
4. DEPTH — Add brief context (why this matters, how it connects to other \
topics) at the start of each major section.
5. EXAM FOCUS — Call out high-yield exam topics and common mistakes.

━━━ MANDATORY FORMAT ━━━
• Start immediately with:  # [Subject] — [Unit/Chapter Title]
• Follow with:             ## Table of Contents   (list all ## headings)
• Heading hierarchy:       ## Major topic  →  ### Subtopic  →  #### Detail
• **Bold** every key term and technical word on its first appearance.
• Use `inline code` for all formulas, variable names, and commands.
• Use fenced code blocks for multi-line algorithms / pseudocode.
• Use Markdown tables for comparisons, classifications, and properties.
• Use > blockquotes for formal definitions, theorems, and axioms.
• Prefix important insights with 💡
• Prefix common exam pitfalls / misconceptions with ⚠️
• Prefix high-yield exam points with 🔑
• End each ## section with:   **Quick Summary** (3–5 concise bullet points)
• End the whole document with: ## Exam Practice
  List 8–12 representative exam questions (mix of short-answer and essay).

━━━ IMAGE PLACEHOLDER RULES ━━━
The source text contains markers like  {{IMG_001}},  {{IMG_002}}, etc.
Each marker represents a diagram, figure, or chart extracted from the \
original lecture materials.
• Keep each {{IMG_NNN}} at the most contextually fitting position in your output.
• If a placeholder is near directly relevant content, keep it there.
• If a placeholder is in a clearly decorative context, you may omit it.
• NEVER alter the {{IMG_NNN}} format — double curly braces, uppercase IMG, \
  zero-padded 3-digit number.

━━━ LENGTH ━━━
Generate LONG, THOROUGH notes. Do not truncate. \
A typical output for a 4–6 lecture unit should be 2500–5000 words. \
Do not add any preamble before the # heading.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Text preprocessing
# ─────────────────────────────────────────────────────────────────────────────

_PICTURE_TEXT_BLOCK = re.compile(
    r"\*\*-{5}\s*Start of picture text\s*-{5}\*\*.*?\*\*-{5}\s*End of picture text\s*-{5}\*\*",
    re.DOTALL | re.IGNORECASE,
)
_PAGE_NUM    = re.compile(r"^\s*\d{1,4}\s*$", re.MULTILINE)
_SEPARATOR   = re.compile(r"\n[-=_]{15,}\n")
_EXCESS_BLANK = re.compile(r"\n{4,}")


def preprocess_text(text: str) -> str:
    text = _PICTURE_TEXT_BLOCK.sub("", text)
    text = _PAGE_NUM.sub("", text)
    text = _SEPARATOR.sub("\n\n", text)
    text = _EXCESS_BLANK.sub("\n\n\n", text)
    return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Strategy A — inline image reference injection  (pymupdf4llm-style output)
# ─────────────────────────────────────────────────────────────────────────────

def inject_placeholders(markdown: str, image_registry: dict) -> str:
    """
    Replace  ![alt](path)  image references with  {{IMG_NNN}}  tokens.
    Uses basename matching so relative vs absolute paths are handled uniformly.
    Images not in registry (filtered out) are silently removed.
    """
    name_to_ph: dict[str, str] = {
        Path(info["path"]).name: "{{" + img_id + "}}"
        for img_id, info in image_registry.items()
        if info.get("included", True)
    }

    def _sub(m: re.Match) -> str:
        basename = Path(m.group(2)).name
        ph = name_to_ph.get(basename)
        return f"\n\n{ph}\n\n" if ph else ""

    result = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", _sub, markdown)
    result = re.sub(r"(\{\{IMG_\d{3}\}\})\s*\1", r"\1", result)   # dedup
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Strategy B — context-based injection  (direct pymupdf output, no inline refs)
# ─────────────────────────────────────────────────────────────────────────────

def inject_by_context(text: str, image_registry: dict, source_file: str) -> str:
    """
    Insert {{IMG_NNN}} placeholders into text using keyword matching.

    For each image from `source_file`, find the paragraph in `text` with the
    highest keyword overlap with the image's context (the surrounding text from
    the original page).  Insert the placeholder after that paragraph.

    Fallback: if no keyword match is found, append the placeholder at the end.
    """
    file_imgs = [
        (img_id, info)
        for img_id, info in image_registry.items()
        if info.get("source_file") == source_file and info.get("included", True)
    ]
    if not file_imgs:
        return text

    paragraphs = re.split(r"\n\n+", text)

    for img_id, info in file_imgs:
        placeholder = "{{" + img_id + "}}"
        # Skip if already injected (shouldn't happen in normal flow)
        if placeholder in text:
            continue

        keywords = info.get("fallback_keywords", [])
        if not keywords:
            paragraphs.append(placeholder)
            continue

        best_idx, best_score = -1, 0
        for i, para in enumerate(paragraphs):
            para_lower = para.lower()
            # Prefer section headings when scores are tied (headings define scope)
            score = sum(1 for kw in keywords if kw in para_lower)
            bonus = 0.5 if score > 0 and para.lstrip().startswith("#") else 0
            total = score + bonus
            if total > best_score:
                best_score, best_idx = total, i

        if best_idx >= 0 and best_score > 0:
            paragraphs.insert(best_idx + 1, placeholder)
        else:
            paragraphs.append(placeholder)

        # Rebuild text so next iteration can check "already injected"
        text = "\n\n".join(paragraphs)
        paragraphs = re.split(r"\n\n+", text)

    return "\n\n".join(paragraphs)


# ─────────────────────────────────────────────────────────────────────────────
# Combine all extractions into one prompt-ready string
# ─────────────────────────────────────────────────────────────────────────────

def combine_extractions(extractions: list, image_registry: dict) -> str:
    """
    Merge per-file extraction results into a single Markdown string with
    {{IMG_NNN}} placeholders injected at contextually appropriate positions.

    Auto-detects which injection strategy to use:
      • Inline refs present  → Strategy A (inject_placeholders)
      • No inline refs       → Strategy B (inject_by_context)
    """
    parts = []
    for ex in extractions:
        if ex.get("type") == "error":
            continue
        md     = ex.get("markdown", "")
        source = ex.get("source", "unknown")

        has_inline_refs = bool(re.search(r"!\[[^\]]*\]\([^)]+\)", md))

        if has_inline_refs:
            md = inject_placeholders(md, image_registry)
        else:
            md = inject_by_context(md, image_registry, source)

        md = preprocess_text(md)
        parts.append(f"<!-- SOURCE: {source} -->\n\n{md}")

    return "\n\n---\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Prompt assembly
# ─────────────────────────────────────────────────────────────────────────────

def build_user_message(subject: str, unit: str, combined_content: str) -> str:
    n_phs   = len(re.findall(r"\{\{IMG_\d{3}\}\}", combined_content))
    n_files = combined_content.count("<!-- SOURCE:")
    return (
        f"Generate comprehensive exam-ready study notes.\n\n"
        f"**Subject:** {subject}\n"
        f"**Unit / Chapter:** {unit}\n"
        f"**Source files:** {n_files}\n"
        f"**Diagram placeholders:** {n_phs} — preserve them in output\n\n"
        f"---BEGIN SOURCE MATERIAL---\n\n"
        f"{combined_content}"
        f"\n\n---END SOURCE MATERIAL---\n\n"
        f"Now generate the complete study notes starting with "
        f"# {subject} — {unit}"
    )


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def token_warning(n: int) -> str:
    if n > 140_000:
        return (f"⛔ Very large (~{n:,} tokens). Split into 2–3 sessions. "
                "API mode can handle this; Free mode will likely be truncated.")
    if n > 80_000:
        return (f"⚠️ Large (~{n:,} tokens). API mode recommended. "
                "Free tier may truncate — consider fewer files per run.")
    if n > 40_000:
        return f"✅ Moderate (~{n:,} tokens) — works with both Free and API modes."
    return f"✅ Good size (~{n:,} tokens) — well within both mode limits."
