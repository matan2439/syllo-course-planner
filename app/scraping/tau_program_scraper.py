"""
Fetches TAU program data from the GraphQL API at tochniot.tau.ac.il.
No parsing happens here — only network I/O and caching.

See app/parsing/tau_program_parser.py for the parsing counterpart.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://tochniot.tau.ac.il/graphql"
GRAPHQL_QUERY = (
    "query results($apiUrl:String!,$filters:JSON!)"
    "{results(apiUrl:$apiUrl,filters:$filters){body}}"
)

_TIMEOUT = 20
_USER_AGENT = "TAU-Course-Planner/0.1 (educational research project)"


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
