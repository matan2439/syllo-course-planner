"""
Fetches TAU program data from the GraphQL API at tochniot.tau.ac.il.
No parsing happens here — only network I/O and caching.

See app/parsing/tau_program_parser.py for the parsing counterpart.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional

import requests

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://tochniot.tau.ac.il/graphql"
GRAPHQL_QUERY = (
    "query results($apiUrl:String!,$filters:JSON!)"
    "{results(apiUrl:$apiUrl,filters:$filters){body}}"
)
PROGRAM_INDEX_QUERY = """
query getPrograms($search: JSON!,$from:Int,$size:Int) {
  getPrograms(search: $search, from: $from, size: $size) {
    total
    results {
      tclongkey shana teurshana teur title toar tcid faculta betsefer
      pail showtochnit
    }
  }
}
"""

_TIMEOUT = 20
_USER_AGENT = "TAU-Course-Planner/0.1 (educational research project)"


@dataclass(frozen=True)
class ProgramIndexEntry:
    """Lean authoritative identity returned by TAU's program index."""

    tcid: str
    tclongkey: str
    title_he: str
    degree_level: str
    faculty_code: str
    school_code: str
    academic_year: str
    academic_year_he: str
    active: bool
    visible: bool


class ProgramSelectionError(ValueError):
    """Raised when an authoritative program lookup is missing or ambiguous."""


def _program_index_entry(raw: Mapping[str, object]) -> ProgramIndexEntry | None:
    tcid = str(raw.get("tcid") or "").strip()
    title = str(raw.get("teur") or raw.get("title") or "").strip()
    if not tcid or not title:
        return None
    return ProgramIndexEntry(
        tcid=tcid,
        tclongkey=str(raw.get("tclongkey") or "").strip(),
        title_he=title,
        degree_level=str(raw.get("toar") or "").strip(),
        faculty_code=str(raw.get("faculta") or "").strip(),
        school_code=str(raw.get("betsefer") or "").strip(),
        academic_year=str(raw.get("shana") or "").strip(),
        academic_year_he=str(raw.get("teurshana") or "").strip(),
        active=str(raw.get("pail") or "") == "1",
        visible=str(raw.get("showtochnit") or "") == "1",
    )


def search_program_index(
    search: Mapping[str, object],
    *,
    start: int = 0,
    size: int = 100,
    timeout: int = _TIMEOUT,
) -> list[ProgramIndexEntry]:
    """Read TAU's official program index without guessing a ``tcid``."""
    payload = {
        "query": PROGRAM_INDEX_QUERY,
        "variables": {"search": dict(search), "from": start, "size": size},
    }
    try:
        response = requests.post(
            GRAPHQL_URL,
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": _USER_AGENT},
            timeout=timeout,
        )
        response.raise_for_status()
        raw_results = response.json()["data"]["getPrograms"]["results"]
        if not isinstance(raw_results, list) or not all(
            isinstance(raw, Mapping) for raw in raw_results
        ):
            raise TypeError("TAU program index returned malformed results")
    except (requests.exceptions.RequestException, json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.warning("Program-index request failed: %s", exc)
        return []
    return [entry for raw in raw_results if (entry := _program_index_entry(raw)) is not None]


def find_unique_program(
    results: Iterable[ProgramIndexEntry | Mapping[str, object]],
    *,
    title_he: str,
    degree_level: str,
    school_code: str,
) -> ProgramIndexEntry:
    """Select one exact program identity, failing closed on zero or many."""
    expected_title = re.sub(r"\s+", " ", title_he).strip()
    entries = [
        item if isinstance(item, ProgramIndexEntry) else _program_index_entry(item)
        for item in results
    ]
    matches = [
        entry for entry in entries
        if entry is not None
        and re.sub(r"\s+", " ", entry.title_he).strip() == expected_title
        and entry.degree_level == degree_level
        and entry.school_code == school_code
    ]
    if len(matches) != 1:
        raise ProgramSelectionError(
            f"Expected exactly one authoritative program for title={expected_title!r}, "
            f"degree={degree_level!r}, school={school_code!r}; found {len(matches)}"
        )
    return matches[0]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_graphql(
    api_url: str,
    filters: dict,
    timeout: int = _TIMEOUT,
) -> dict:
    """POST a GraphQL query and return the parsed JSON response dict.

    Returns {} on any error (network, HTTP, JSON parse).
    """
    payload = {
        "query": GRAPHQL_QUERY,
        "variables": {
            "apiUrl": api_url,
            "filters": filters,
        },
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": _USER_AGENT,
    }
    try:
        resp = requests.post(
            GRAPHQL_URL, json=payload, headers=headers, timeout=timeout
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as exc:
        logger.warning("GraphQL request failed: %s", exc)
        return {}
    except json.JSONDecodeError as exc:
        logger.warning("GraphQL response JSON parse error: %s", exc)
        return {}


def _read_cache(path: Path) -> Optional[dict]:
    """Read a JSON cache file. Returns None if missing or unreadable."""
    if not path.exists():
        return None
    try:
        # Handle UTF-8 with BOM (PowerShell ConvertTo-Json output)
        for enc in ("utf-8-sig", "utf-8"):
            try:
                with open(path, "r", encoding=enc) as fh:
                    return json.load(fh)
            except UnicodeDecodeError:
                continue
        return None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read cache %s: %s", path, exc)
        return None


def save_raw_snapshot(data: dict, path: Path) -> None:
    """Save raw API response to *path* as UTF-8 JSON for debugging."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    logger.info("Saved raw snapshot to %s", path)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_program_data(
    tcid: str,
    shana: str,
    safa: str = "1",
    cache_path: Optional[Path] = None,
    force_refresh: bool = False,
) -> list[dict]:
    """Fetch the program body list from the ydtochnit GraphQL endpoint.

    If *cache_path* is provided and the file exists (and *force_refresh* is
    False), the cached file is returned without a network request.

    Returns a list of body dicts (may be empty on error).
    """
    if cache_path and not force_refresh:
        cached = _read_cache(cache_path)
        if cached is not None:
            try:
                return cached["data"]["results"]["body"]
            except (KeyError, TypeError):
                logger.warning(
                    "Cache file %s has unexpected structure, re-fetching", cache_path
                )

    filters = {"tcid": tcid, "shana": shana, "safa": safa}
    raw = _post_graphql("ydtochnit", filters)

    if not raw:
        logger.warning(
            "No data returned for tcid=%s shana=%s — returning empty body", tcid, shana
        )
        return []

    if cache_path:
        save_raw_snapshot(raw, cache_path)

    try:
        return raw["data"]["results"]["body"]
    except (KeyError, TypeError) as exc:
        logger.warning("Unexpected GraphQL response structure: %s", exc)
        return []


def fetch_prereq_data(
    tcid: str,
    kursid: str,
    shana: str,
    safa: str = "1",
    cache_path: Optional[Path] = None,
) -> dict:
    """Fetch prerequisites for a single course from the yddrishot endpoint.

    Returns the first body dict, or {} on error.
    """
    if cache_path:
        cached = _read_cache(cache_path)
        if cached is not None:
            try:
                body = cached["data"]["results"]["body"]
                return body[0] if body else {}
            except (KeyError, TypeError, IndexError):
                pass

    filters = {"tcid": tcid, "kursid": kursid, "shana": shana, "safa": safa}
    raw = _post_graphql("yddrishot", filters)

    if not raw:
        return {}

    if cache_path:
        save_raw_snapshot(raw, cache_path)

    try:
        body = raw["data"]["results"]["body"]
        return body[0] if body else {}
    except (KeyError, TypeError, IndexError) as exc:
        logger.warning("Unexpected prereq response structure: %s", exc)
        return {}
