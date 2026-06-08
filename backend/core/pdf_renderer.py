"""
pdf_renderer.py
Converts final Markdown (with embedded HTML <figure> blocks) into a PDF.

Renderer priority — tries each in order, uses first that succeeds:
  1. WeasyPrint      — best quality, needs GTK (works on Mac/Linux; optional on Windows)
  2. xhtml2pdf       — pure Python, no system libs, works everywhere, good quality
  3. HTML fallback   — saves a styled .html; user opens in Chrome and Ctrl+P → Save as PDF
"""

import re
import io
import logging
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# CSS — WeasyPrint version (full CSS, CSS variables, @page rules)
# ─────────────────────────────────────────────────────────────────────────────

_CSS_WEASYPRINT = """
body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.80;
    color: #1a1a2e;
    background: #ffffff;
}
@page {
    size: A4;
    margin: 2.4cm 2.6cm 2.2cm 2.6cm;
    @bottom-center {
        content: counter(page) " / " counter(pages);
        font-size: 8pt;
        color: #9ca3af;
    }
}
h1 {
    font-size: 20pt; font-weight: 800; color: #1e1b4b;
    text-align: center; padding: 12pt 0 10pt;
    border-bottom: 2.5pt solid #4f46e5; margin-bottom: 18pt;
    page-break-after: avoid;
}
h2 {
    font-size: 13pt; font-weight: 700; color: #3730a3;
    border-left: 4pt solid #6366f1; padding: 4pt 0 4pt 10pt;
    margin-top: 22pt; margin-bottom: 8pt;
    background: #f5f3ff; border-radius: 0 4pt 4pt 0;
    page-break-after: avoid;
}
h3 {
    font-size: 11.5pt; font-weight: 700; color: #1e1b4b;
    margin-top: 14pt; margin-bottom: 6pt;
    border-bottom: 0.5pt solid #e0e7ff; padding-bottom: 2pt;
    page-break-after: avoid;
}
h4 { font-size: 10.5pt; font-weight: 700; color: #4338ca;
     margin-top: 10pt; margin-bottom: 4pt; page-break-after: avoid; }
p  { margin: 0 0 7pt; orphans: 3; widows: 3; text-align: justify; }
strong { font-weight: 700; color: #1e1b4b; }
em     { color: #4b5563; }
code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 9pt; background: #f3f4f6; color: #be185d;
    padding: 1pt 4pt; border-radius: 3pt; border: 0.4pt solid #e5e7eb;
}
pre {
    background: #1e1b4b; color: #e2e8f0; padding: 11pt 14pt;
    border-radius: 6pt; font-size: 8.5pt; line-height: 1.55;
    margin: 10pt 0; white-space: pre-wrap; page-break-inside: avoid;
}
pre code { background: none; color: inherit; padding: 0; border: none; }
blockquote {
    background: #eff6ff; border-left: 4pt solid #3b82f6;
    border-radius: 0 6pt 6pt 0; margin: 10pt 0; padding: 9pt 14pt;
    font-size: 10pt; color: #1e3a5f; page-break-inside: avoid;
}
blockquote p { margin: 0; text-align: left; }
ul, ol { margin: 5pt 0 8pt; padding-left: 18pt; }
li     { margin-bottom: 3pt; line-height: 1.70; }
table  { width: 100%; border-collapse: collapse; margin: 11pt 0;
         font-size: 9.5pt; page-break-inside: avoid; }
thead tr { background: #4f46e5; color: #ffffff; }
th { padding: 7pt 10pt; font-weight: 700; border: 0.5pt solid #4338ca; }
td { padding: 6pt 10pt; border: 0.5pt solid #e5e7eb; }
tbody tr:nth-child(even) { background: #f5f3ff; }
hr { border: none; border-top: 1pt solid #e0e7ff; margin: 16pt 0; }
figure.extracted-image {
    text-align: center; margin: 14pt auto; max-width: 95%;
    border: 0.5pt solid #e0e7ff; border-radius: 8pt;
    padding: 10pt 12pt 8pt; background: #fafafa; page-break-inside: avoid;
}
figure.extracted-image img {
    max-width: 100%; max-height: 260pt; object-fit: contain;
    display: block; margin: 0 auto;
}
figcaption { font-size: 8.5pt; color: #6b7280; margin-top: 6pt;
             font-style: italic; text-align: center; }
a { color: #4f46e5; text-decoration: none; }
"""

# ─────────────────────────────────────────────────────────────────────────────
# CSS — xhtml2pdf version (no CSS variables, no unsupported properties)
# xhtml2pdf uses ReportLab; supports a subset of CSS 2.1
# ─────────────────────────────────────────────────────────────────────────────

_CSS_XHTML2PDF = """
@page { margin: 2.2cm 2.5cm; }
body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.7;
    color: #1a1a2e;
}
h1 {
    font-size: 18pt; font-weight: bold; color: #1e1b4b;
    text-align: center; padding-bottom: 6pt;
    border-bottom: 2pt solid #4f46e5;
    margin-bottom: 14pt;
}
h2 {
    font-size: 12.5pt; font-weight: bold; color: #3730a3;
    background-color: #f5f3ff; padding: 4pt 8pt;
    border-left: 4pt solid #6366f1;
    margin-top: 18pt; margin-bottom: 6pt;
}
h3 {
    font-size: 11pt; font-weight: bold; color: #1e1b4b;
    margin-top: 12pt; margin-bottom: 5pt;
    border-bottom: 0.5pt solid #e0e7ff; padding-bottom: 2pt;
}
h4 { font-size: 10pt; font-weight: bold; color: #4338ca;
     margin-top: 9pt; margin-bottom: 3pt; }
p  { margin: 0 0 6pt; }
strong { font-weight: bold; color: #1e1b4b; }
em     { font-style: italic; color: #4b5563; }
code {
    font-family: Courier, monospace; font-size: 8.5pt;
    background-color: #f0effe; color: #5b21b6; padding: 1pt 3pt;
}
/* xhtml2pdf cannot reliably render dark backgrounds with light text.
   Light gray background + dark text + indigo left-border accent keeps
   code blocks always legible regardless of rendering quirks.         */
pre {
    background-color: #f0f0f8;
    color: #1a1a2e;
    border-left: 3pt solid #4f46e5;
    border-top: 0.5pt solid #c7c7e0;
    border-right: 0.5pt solid #c7c7e0;
    border-bottom: 0.5pt solid #c7c7e0;
    padding: 9pt 12pt;
    font-size: 8pt;
    font-family: Courier, monospace;
    line-height: 1.6;
    margin: 9pt 0;
}
pre code {
    background-color: transparent;
    color: #1a1a2e;
    padding: 0;
}
blockquote {
    background-color: #eff6ff; border-left: 4pt solid #3b82f6;
    margin: 8pt 0; padding: 8pt 12pt; color: #1e3a5f; font-size: 9.5pt;
}
ul, ol { margin: 4pt 0 7pt; padding-left: 16pt; }
li     { margin-bottom: 3pt; line-height: 1.65; }
table  { width: 100%; border-collapse: collapse; margin: 9pt 0; font-size: 9pt; }
/* Light purple header — dark text on pale background avoids white-on-white
   when xhtml2pdf fails to paint the background on a row.               */
thead tr { background-color: #ede9fe; }
th { padding: 6pt 9pt; font-weight: bold; color: #1e1b4b;
     border: 0.5pt solid #a5b4fc; }
td { padding: 5pt 9pt; border: 0.5pt solid #e5e7eb; color: #1a1a2e; }
hr { border-top: 0.8pt solid #e0e7ff; margin: 14pt 0; }
figure { text-align: center; margin: 12pt 0;
         border: 0.5pt solid #e0e7ff; padding: 8pt; background-color: #fafafa; }
figure img { max-width: 100%; }
figcaption { font-size: 8pt; color: #6b7280; font-style: italic; margin-top: 5pt; }
a { color: #4f46e5; }
"""


# ─────────────────────────────────────────────────────────────────────────────
# Markdown → HTML
# ─────────────────────────────────────────────────────────────────────────────

def _md_to_html(md_text: str) -> str:
    try:
        import markdown as md_lib
        return md_lib.markdown(
            md_text,
            extensions=["tables", "fenced_code", "toc", "nl2br",
                        "attr_list", "def_list", "sane_lists"],
            extension_configs={"toc": {"permalink": False}},
        )
    except ImportError:
        import html as h
        return f"<pre>{h.escape(md_text)}</pre>"


def _wrap_html(body: str, css: str) -> str:
    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
        '<meta charset="UTF-8">\n'
        f'<style>\n{css}\n</style>\n'
        '</head>\n<body>\n'
        f'{body}\n'
        '</body>\n</html>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def render_to_pdf(final_markdown: str, output_path: str) -> tuple[bool, str]:
    """
    Render Markdown → PDF using the best available renderer.

    Priority:
      1. WeasyPrint  (needs GTK — works on Mac/Linux; optional install on Windows)
      2. xhtml2pdf   (pure Python — works everywhere, no extra system libraries)
      3. HTML file   (open in Chrome → Ctrl+P → Save as PDF)

    Returns: (success, path_or_message)
    """
    body_html = _md_to_html(final_markdown)

    # ── 1. WeasyPrint ─────────────────────────────────────────────────────
    try:
        import weasyprint
        logging.getLogger("weasyprint").setLevel(logging.ERROR)
        logging.getLogger("fontTools").setLevel(logging.ERROR)
        full_html = _wrap_html(body_html, _CSS_WEASYPRINT)
        weasyprint.HTML(string=full_html).write_pdf(output_path)
        return True, output_path
    except ImportError:
        pass
    except Exception:
        pass  # GTK missing / DLL conflict — fall through

    # ── 2. xhtml2pdf (pure Python, no system dependencies) ───────────────
    try:
        from xhtml2pdf import pisa

        # xhtml2pdf logs to stderr by default — suppress unless debugging
        logging.getLogger("xhtml2pdf").setLevel(logging.ERROR)

        full_html = _wrap_html(body_html, _CSS_XHTML2PDF)
        with open(output_path, "wb") as fout:
            result = pisa.CreatePDF(
                src=full_html,
                dest=fout,
                encoding="utf-8",
                raise_exception=False,
            )
        if not result.err:
            return True, output_path
        # pisa error — fall through to HTML
    except ImportError:
        pass
    except Exception:
        pass

    # ── 3. HTML fallback ──────────────────────────────────────────────────
    html_path = str(Path(output_path).with_suffix(".html"))
    full_html  = _wrap_html(body_html, _CSS_WEASYPRINT)   # full CSS for browser
    Path(html_path).write_text(full_html, encoding="utf-8")
    return False, html_path


def get_html_preview(final_markdown: str) -> str:
    """
    Return a complete, styled HTML document string.
    Served directly by the /preview-page FastAPI endpoint as text/html,
    then embedded via <iframe src="/api/.../preview-page"> in the React app.
    This keeps Gradio / host-page CSS completely isolated from the notes.
    """
    body = _md_to_html(final_markdown)
    return _wrap_html(body, _CSS_WEASYPRINT)
