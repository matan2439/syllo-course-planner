"""The per-year official course facts snapshot, ``data/official/tau_course_facts_<year>.json``.

One file per TAU year, shared by every program. Only the IMS course-search result is a fact
about the course itself; the ydtochnit row (credits, weekly hours), the program timetable and
the resolved offering are read through one program's ``tcid``, so they are kept per program:

    course_id -> {"ims": {...}, "programs": {tcid: {"program": {...} | None,
                                                   "timetable": [...] | None,
                                                   "offering": {...}}}}

Readers work on one program's flat view (``program_view``):

    course_id -> {"ims": {...}, "program": ..., "timetable": ..., "offering": ...}
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OFFICIAL_DIR = ROOT / "data" / "official"
PROGRAM_SCOPED = ("program", "timetable", "offering")


def facts_path(year: int, official_dir: Path | None = None) -> Path:
    return Path(official_dir or OFFICIAL_DIR) / f"tau_course_facts_{year}.json"


def load_stored(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else {}


def program_view(stored: dict, tcid: str) -> dict[str, dict]:
    """The flat facts of every course this program (``tcid``) has refreshed."""
    tcid = str(tcid)
    return {cid: {"ims": entry.get("ims"), **entry["programs"][tcid]}
            for cid, entry in stored.items() if tcid in (entry.get("programs") or {})}


def load_program_facts(year: int, tcid: str, path: Path | None = None) -> dict[str, dict]:
    """One program's flat view of a facts snapshot ({} when the file does not exist)."""
    return program_view(load_stored(path or facts_path(year)), tcid)
