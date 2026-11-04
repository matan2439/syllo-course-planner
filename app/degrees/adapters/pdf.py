"""PDF evidence: the regulations / ידיעון PDFs a program page links to become rule_text items.

Which documents: the program's tochniot ``policy_text`` links with ``data.list == "terms"`` whose
URL is a ``.pdf``. ``prev_newsletters`` entries are previous-year archives and are skipped (their
URLs can be PDFs too); without ``list``, an entry with only a ``shana`` label counts as archive.

Splitting (pragmatic, deterministic; Word-exported regulations). One item per sentence:
- text is extracted per page; whitespace-only lines separate blocks; page-number lines
  (1-3 digits alone) are dropped - they are the ONLY extracted lines not kept in some item;
- a line is a heading when it is short (<= HEADING_MAX_WORDS words, <= HEADING_MAX_CHARS chars),
  does not end in terminal punctuation (.:;,?!), is not a list item or a URL, and starts a
  sentence (first line of its block, or the previous line ended in . ; ? !). A line after a
  ':'-ending line is list/table content, never a heading. A heading is an item of its own
  (``data.heading``) and the ``path[1]`` of what follows (carried across pages);
- a list item (``1.``, ``א.``, ``יא.``, bullet glyphs) starts a new paragraph;
- every other line continues the current paragraph (wrapped lines are joined with a space);
- paragraphs are split into sentences (see ``_sentence_spans``); identical sentences in one
  document are one item, the other places recorded in ``data.also_at``.
A sentence's page is the page its paragraph starts on; a paragraph split by a page break becomes two.

RTL: pypdf normally returns logical order already (it reverses visually drawn RTL runs). A page
that still comes out visually reversed - detected by Hebrew final letters (ךםןףץ) starting
words instead of ending them - is restored line by line with ``restore_rtl_pdf_line``.

A page without a text layer (< MIN_PAGE_CHARS non-space chars, page numbers aside) becomes an
item ``pdf:<doc>:unread-page-<n>`` with ``data.unread``: the mapper must send it to known_gaps, so
a fully or partially scanned PDF can never pass silently.
"""
import hashlib
import io
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

import requests

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
TERMINAL = tuple(".:;,?!")  # a line ending in one of these is not a heading
SENTENCE_END = tuple(".;?!")  # a line ending in one of these ends a sentence
MIN_PAGE_CHARS = 20  # fewer non-space chars (page numbers aside): the page counts as unread
_PAGE_NO = re.compile(r"^\d{1,3}$")
# list markers: "1." / "1)", Hebrew letter numbering ("א.", "יא."), bullets. U+F000-U+F0FF is the
# Private Use block where Word's Symbol/Wingdings bullets land after extraction (Terms_BA: U+F0B7).
_LIST_ITEM = re.compile(r"^(?:\d{1,2}[.)]|[\u05d0-\u05ea]{1,2}[.)]|[\u2022\u25cf\u25aa\uf000-\uf0ff-])(?:\s|$)")
_SENTENCE_BREAK = re.compile(r"[.?!;]+[\"')\u05f4]*(?=\s)")
_DISPLACED_PERIOD = re.compile(r"(?<=[\w\"')]) \.\w+(?=\s|$)")
_HEB_WORD = re.compile(r"[א-ת]{2,}")
_FINALS = set("ךםןףץ")
_WS = re.compile(r"\s+")


def doc_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def is_current_regulations_pdf(data: dict) -> bool:
    """A current `terms` document (not a `prev_newsletters` archive) served as a PDF.

    Falls back to Title-vs-shana (archives carry only a `shana` label) when `list` is missing.
    """
    url = str(data.get("url") or "")
    current = data["list"] == "terms" if "list" in data else bool(str(data.get("Title") or "").strip())
    return current and urlparse(url).path.lower().endswith(".pdf")


def _documents(program: ProgramEntry, live: bool, offline: bool) -> list[tuple[str, str]]:
    """(title, url) of every current regulations PDF linked from the program, url-deduplicated."""
    docs: dict[str, str] = {}
    for item in tau.tochniot_evidence(program, live, offline):
        if item.kind == "policy_text" and is_current_regulations_pdf(item.data):
            docs.setdefault(item.data["url"], str(item.data.get("Title") or item.raw_text).strip())
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
    """Raw pypdf text per page (no RTL handling).

    pypdf is imported here, not at module level: the adapters are imported by every
    ``degree.py`` command, and only reading a PDF needs it. An unreadable PDF raises
    ``ValueError`` (pypdf's ``PdfReadError`` is re-raised as one)."""
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        return [page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages]
    except PdfReadError as exc:
        raise ValueError(str(exc)) from exc


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
        # starts a sentence: ':' is excluded, a line after "...as follows:" is list/table content
        and (prev is None or prev.endswith(SENTENCE_END))
    )


def _sentence_spans(text: str) -> list[str]:
    """Split a paragraph into sentences, verbatim (joined back with ' ' they give the paragraph).

    Boundaries: '.', '?', '!', ';' followed by whitespace; and pypdf's displaced period
    ("נמשכים כ 3 .שנים התלמיד") - ' .' after a word, glued to the next word - ends the sentence
    after that word. Decimals (3.5) and course ids (0512.4013) have no whitespace after the
    period, so they never split; a leading list marker ("1.", "א.") is never a boundary.
    """
    marker = _LIST_ITEM.match(text)
    skip = marker.end() if marker else 0
    cuts = {m.end() for m in _SENTENCE_BREAK.finditer(text) if m.end() > skip}
    cuts |= {m.end() for m in _DISPLACED_PERIOD.finditer(text) if m.start() >= skip}
    out, last = [], 0
    for cut in sorted(cuts):
        piece = text[last:cut].strip()
        if piece:
            out.append(piece)
        last = cut
    tail = text[last:].strip()
    if tail:
        out.append(tail)
    return out


def _page_has_text(lines: list[str]) -> bool:
    body = "".join(line for line in lines if line and not _PAGE_NO.match(line))
    return len(_WS.sub("", body)) >= MIN_PAGE_CHARS


def split_units(pages: list[list[str]]) -> list[tuple[str, str, int, bool]]:
    """(heading, text, 1-based page, is_heading) in document order; see the module docstring.

    Every non-blank, non-page-number line ends up in exactly one unit's text (headings are units
    too), so nothing extracted is dropped. Pages without text are skipped here (see
    ``unread_pages``).
    """
    out: list[tuple[str, str, int, bool]] = []
    heading = ""
    for page_no, lines in enumerate(pages, 1):
        current: list[str] = []
        prev: str | None = None  # previous line in the current block

        def flush():
            if current:
                out.extend((heading, s, page_no, False) for s in _sentence_spans(" ".join(current)))
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
                out.append((heading, line, page_no, True))
            elif _LIST_ITEM.match(line):
                flush()
                current.append(line)
            else:
                current.append(line)
            prev = line
        flush()
    return out


def unread_pages(pages: list[list[str]]) -> list[int]:
    return [n for n, lines in enumerate(pages, 1) if not _page_has_text(lines)]


def pdf_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    items: list[EvidenceItem] = []
    for title, url in _documents(program, live, offline):
        doc = doc_id(url)
        cache = PDF_DIR / f"{doc}.pdf"
        from_cache, fetched_at = tau._provenance(cache, live)
        data = _download(url, cache, live, offline)
        try:
            raw_pages = extract_pages(data)
        except ValueError as exc:
            raise EvidenceFetchError(SOURCE, url, f"unreadable PDF: {exc}") from exc
        pages = [page_lines(t) for t in raw_pages]

        def item(id_, path, text, **data):
            return EvidenceItem(id=id_, source_url=url, fetched_at=fetched_at, from_cache=from_cache,
                                kind="rule_text", path=path, raw_text=text, data=data)

        unread = unread_pages(pages)
        if unread:
            logger.warning("PDF pages without a text layer %s (they stay known gaps): %s", unread, url)
        # a scanned page is an explicit item the mapper must send to known_gaps, never a silent pass
        items.extend(item(f"pdf:{doc}:unread-page-{n}", [title], f"[page {n} has no extractable text]",
                          page=n, unread=True) for n in unread)
        seen: dict[str, EvidenceItem] = {}
        for heading, text, page, is_heading in split_units([p if n not in unread else [] for n, p in
                                                            enumerate(pages, 1)]):
            id_ = f"pdf:{doc}:{text_id(text)}"
            path = [title] + ([heading] if heading else [])
            if id_ in seen:  # identical sentence repeated in the document: one fact, other places noted
                seen[id_].data.setdefault("also_at", []).append({"page": page, "path": path})
                continue
            extra = {"heading": True} if is_heading else {}
            seen[id_] = item(id_, path, text, page=page, **extra)
        items.extend(seen.values())
    return items
