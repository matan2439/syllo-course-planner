"""Evidence model: one EvidenceItem per official fact, so a later check can prove completeness."""
import hashlib
import html
import re
from datetime import datetime
from typing import Callable, Literal

from pydantic import BaseModel, Field

from app.degrees.registry import ProgramEntry, load_institution

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")


class EvidenceItem(BaseModel):
    id: str
    source_url: str
    fetched_at: datetime  # UTC
    from_cache: bool
    kind: Literal["program_text", "section", "rule_text", "course_listing", "course_fact", "policy_text"]
    path: list[str]
    raw_text: str
    course_id: str | None = None
    cancelled: bool = False
    data: dict = Field(default_factory=dict)


def strip_html(text: str) -> str:
    """Strip tags, unescape entities (nbsp -> space), collapse whitespace."""
    no_tags = _TAG_RE.sub(" ", text or "")
    return _WS_RE.sub(" ", html.unescape(no_tags).replace("\xa0", " ")).strip()


def text_id(text: str) -> str:
    """sha1 of whitespace-collapsed, HTML-stripped text; first 12 hex chars."""
    return hashlib.sha1(strip_html(text).encode("utf-8")).hexdigest()[:12]


# adapter name -> (program, live, offline) -> items; filled by app.degrees.adapters
ADAPTERS: dict[str, Callable[[ProgramEntry, bool, bool], list[EvidenceItem]]] = {}


def collect_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    names = load_institution(program.institution)["sources"]["adapters"]
    items: list[EvidenceItem] = []
    for name in names:
        if name not in ADAPTERS:
            raise KeyError(f"unknown evidence adapter: {name}")
        items.extend(ADAPTERS[name](program, live, offline))
    seen: set[str] = set()
    dups = sorted({i.id for i in items if i.id in seen or seen.add(i.id)})
    if dups:
        raise ValueError(f"duplicate evidence ids: {dups[:5]}")
    return sorted(items, key=lambda i: i.id)


import app.degrees.adapters  # noqa: E402,F401  (registers ADAPTERS; after definitions to avoid a cycle)
