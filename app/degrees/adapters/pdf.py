"""PDF evidence: the regulations / ידיעון PDFs a program page links to become rule_text items.

Which documents: the program's tochniot ``policy_text`` links (body ``terms``) whose URL is a
``.pdf``. Entries from ``prev_newsletters`` are previous-year archives: they carry a ``shana``
label instead of a ``Title`` and are skipped (their URLs can be PDFs too).

Paragraph heuristic (pragmatic, deterministic; Word-exported regulations):
- text is extracted per page; whitespace-only lines separate blocks; page-number lines
  (1-3 digits alone) are dropped;
- a line is a heading when it is short (<= HEADING_MAX_WORDS words, <= HEADING_MAX_CHARS chars),
  does not end in terminal punctuation, is not a list item or a URL, and starts a sentence (it is the
  first line of its block, or the previous line ended in terminal punctuation). The last
  heading seen (carried across pages) becomes ``path[1]``; headings are not items themselves;
- a list item (``1.``, ``א.``, ``יא.``, bullet glyphs) starts a new paragraph;
- every other line continues the current paragraph (wrapped lines are joined with a space).
A paragraph's page is the page it starts on; a paragraph split by a page break becomes two.

RTL: pypdf normally returns logical order already (it reverses visually drawn RTL runs). A page
that still comes out visually reversed - detected by Hebrew final letters (ךםןףץ) starting
words instead of ending them - is restored line by line with ``restore_rtl_pdf_line``.

A PDF without a text layer yields no items (and a warning): its tochniot link item stays
unmapped, so it must remain a ``known_gaps`` entry.
"""
import hashlib
import io
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

import requests
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.degrees.adapters import tau
from app.degrees.evidence import EvidenceFetchError, EvidenceItem, text_id
from app.degrees.registry import ProgramEntry
from app.parsing.tau_curriculum_document import restore_rtl_pdf_line

logger = logging.getLogger(__name__)

PDF_DIR = tau.RAW_DIR / "pdf"
SOURCE = "tau_pdf"
TIMEOUT = 60
HEADING_MAX_WORDS = 7
HEADING_MAX_CHARS = 60
TERMINAL = tuple(".:;,?!")
_PAGE_NO = re.compile(r"^\d{1,3}$")
_LIST_ITEM = re.compile(r"^(?:\d{1,2}[.)]|[א-ת]{1,2}[.)]|[•●▪--])(?:\s|$)")
_HEB_WORD = re.compile(r"[א-ת]{2,}")
_FINALS = set("ךםןףץ")
_WS = re.compile(r"\s+")


def doc_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def is_current_regulations_pdf(data: dict) -> bool:
    """A current `terms` document (has a Title; archives only carry `shana`) served as a PDF."""
    url = str(data.get("url") or "")
    return bool(str(data.get("Title") or "").strip()) and urlparse(url).path.lower().endswith(".pdf")


def _documents(program: ProgramEntry, live: bool, offline: bool) -> list[tuple[str, str]]:
    """(title, url) of every current regulations PDF linked from the program, url-deduplicated."""
    docs: dict[str, str] = {}
    for item in tau.tochniot_evidence(program, live, offline):
        if item.kind == "policy_text" and is_current_regulations_pdf(item.data):
            docs.setdefault(item.data["url"], item.data["Title"].strip())
    return [(title, url) for url, title in docs.items()]


def _download(url: str, cache: Path, live: bool, offline: bool) -> bytes:
    if cache.exists() and not live:
        return cache.read_bytes()
    if offline and not live:
        raise EvidenceFetchError(SOURCE, url, "offline and not cached")
    try:
        resp = requests.get(url, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise EvidenceFetchError(SOURCE, url, f"download failed: {exc}") from exc
    if resp.status_code != 200 or not resp.content.startswith(b"%PDF"):
        raise EvidenceFetchError(SOURCE, url, f"not a PDF (HTTP {resp.status_code})")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(resp.content)
    return resp.content


def extract_pages(data: bytes) -> list[str]:
    """Raw pypdf text per page (no RTL handling)."""
    return [page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages]


def _visually_reversed(text: str) -> bool:
    words = _HEB_WORD.findall(text)
    starts = sum(w[0] in _FINALS for w in words)
    ends = sum(w[-1] in _FINALS for w in words)
    return starts > ends


def page_lines(text: str) -> list[str]:
    """A page's lines in logical order, whitespace-collapsed; blank lines kept as ''."""
    lines = [_WS.sub(" ", line).strip() for line in text.splitlines()]
    if _visually_reversed(text):
        lines = [restore_rtl_pdf_line(line) if _HEB_WORD.search(line) else line for line in lines]
    return lines


def _is_heading(line: str, prev: str | None) -> bool:
    return (
        len(line) <= HEADING_MAX_CHARS
        and len(line.split()) <= HEADING_MAX_WORDS
        and not line.endswith(TERMINAL)
        and not _LIST_ITEM.match(line)
        and any(c.isalpha() for c in line)
        and "://" not in line  # a bare URL line continues its paragraph
        and (prev is None or prev.endswith(TERMINAL))
    )


def split_paragraphs(pages: list[list[str]]) -> list[tuple[str, str, int]]:
    """(heading, paragraph text, 1-based page) in document order; see the module docstring."""
    out: list[tuple[str, str, int]] = []
    heading = ""
    for page_no, lines in enumerate(pages, 1):
        current: list[str] = []
        prev: str | None = None  # previous line in the current block

        def flush():
            if current:
                out.append((heading, " ".join(current), page_no))
                current.clear()

        for line in lines:
            if not line:
                flush()
                prev = None
                continue
            if _PAGE_NO.match(line):
                continue
            if _is_heading(line, prev):
                flush()
                heading = line
            elif _LIST_ITEM.match(line):
                flush()
                current.append(line)
            else:
                current.append(line)
            prev = line
        flush()
    return out


def pdf_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    items: list[EvidenceItem] = []
    for title, url in _documents(program, live, offline):
        doc = doc_id(url)
        cache = PDF_DIR / f"{doc}.pdf"
        from_cache, fetched_at = tau._provenance(cache, live)
        data = _download(url, cache, live, offline)
        try:
            raw_pages = extract_pages(data)
        except (PdfReadError, ValueError) as exc:
            raise EvidenceFetchError(SOURCE, url, f"unreadable PDF: {exc}") from exc
        paragraphs = split_paragraphs([page_lines(t) for t in raw_pages])
        if not paragraphs:
            logger.warning("PDF has no text layer, no evidence extracted (stays a known gap): %s", url)
            continue
        seen: dict[str, EvidenceItem] = {}
        for heading, text, page in paragraphs:
            id_ = f"pdf:{doc}:{text_id(text)}"
            if id_ in seen:  # identical paragraph repeated in the document: one fact
                seen[id_].data.setdefault("also_pages", []).append(page)
                continue
            seen[id_] = EvidenceItem(
                id=id_, source_url=url, fetched_at=fetched_at, from_cache=from_cache, kind="rule_text",
                path=[title] + ([heading] if heading else []), raw_text=text, data={"page": page})
        items.extend(seen.values())
    return items
