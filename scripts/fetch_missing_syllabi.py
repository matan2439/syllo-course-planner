#!/usr/bin/env python3
"""
Official-syllabus retrieval and caching for TAU board courses.

Fetches missing syllabi from the official TAU syllabus portal, with:
  - Rate limiting  (1 request per 2 seconds by default)
  - Caching to data/syllabi_cache/<course_id>.json
  - Provenance tracking (source URL, fetch timestamp, HTTP status)
  - Failure reporting (network, HTTP, encoding errors)
  - Dry-run mode (print what would be fetched, do not make requests)
  - No fabricated content (pages are stored verbatim; parsing is deterministic)

Usage
-----
  python3 scripts/fetch_missing_syllabi.py \\
      --program electrical_engineering_2027 \\
      [--year 2026]           # syllabus year (default: 2026)
      [--delay 2.0]           # seconds between requests (default: 2.0)
      [--dry-run]             # list what would be fetched
      [--force]               # re-fetch even if already cached

The script reads the board JSON, finds courses with a syllabus_source_url but
no syllabus_summary_he content, and fetches each one from the TAU portal.
Fetched HTML is stored verbatim alongside metadata for later manual parsing
or Stage 2 enrichment. No content is synthesised or inferred.

Output
------
  data/syllabi_cache/<course_id>.json   — per-course cache record
  data/syllabi_cache/fetch_report.json  — summary of this run

Cache record schema
-------------------
  {
    "course_id":   "0512-4707",
    "source_url":  "https://ims.tau.ac.il/Tal/Syllabus/...",
    "fetched_at":  "2026-11-19T12:00:00Z",
    "http_status": 200,
    "content_len": 15400,
    "raw_html":    "<html>...</html>",   // verbatim; may be empty on error
    "error":       null                 // or error message string
  }
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TAU_SYLLABUS_BASE = "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx"
DEFAULT_YEAR = 2026
DEFAULT_DELAY = 2.0  # seconds between requests (TAU portal rate limit)
REQUEST_TIMEOUT = 30  # seconds

BOARD_FILE: dict[str, str] = {
    "electrical_engineering_2027": "data/boards/electrical_engineering_2027.json",
    "mechanical_engineering_2027": "data/boards/mechanical_engineering_2027.json",
}

# ---------------------------------------------------------------------------
# URL construction
# ---------------------------------------------------------------------------


def build_tau_url(course_id: str, year: int) -> str:
    """Build the official TAU syllabus URL from a course_id and year.

    TAU course IDs are formatted as XXXX-YYYY (with dash). The URL uses the
    digit-only form with no dash. Some courses have a section suffix appended
    to form the full 10-digit course code; we default to '01' as the section.

    Example: "0512-4707" → course=051247070101, year=2026
    (The portal uses a 12-digit course code: XXXX YYYY SS NN where SS=01, NN=01)
    """
    digits = course_id.replace("-", "").replace(" ", "")
    # TAU uses a fixed 10-digit code internally; pad or truncate as needed
    padded = digits.ljust(10, "0")[:10]
    return f"{TAU_SYLLABUS_BASE}?course={padded}01&year={year}"


# ---------------------------------------------------------------------------
# Course collection
# ---------------------------------------------------------------------------


def collect_courses(board: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for c in board.get("metadata", {}).get("program_repository_courses", []):
        if not c or not isinstance(c.get("course_id"), str):
            continue
        cid = c["course_id"]
        if cid not in seen:
            seen.add(cid)
            result.append(c)
    for s in board.get("semesters", []):
        for c in s.get("courses", []):
            if not c or not isinstance(c.get("course_id"), str):
                continue
            cid = c["course_id"]
            if cid not in seen:
                seen.add(cid)
                result.append(c)
    return result


def has_content(course: dict[str, Any]) -> bool:
    summary = course.get("syllabus_summary_he") or ""
    return bool(summary.strip()) if isinstance(summary, str) else False


def get_source_url(course: dict[str, Any]) -> str | None:
    url = course.get("syllabus_source_url") or course.get("syllabus_url")
    return url if isinstance(url, str) and url.strip() else None


# ---------------------------------------------------------------------------
# Cache management
# ---------------------------------------------------------------------------


def cache_path(course_id: str, cache_dir: Path) -> Path:
    safe = re.sub(r"[^0-9a-zA-Z\-]", "_", course_id)
    return cache_dir / f"{safe}.json"


def load_cache_record(course_id: str, cache_dir: Path) -> dict[str, Any] | None:
    p = cache_path(course_id, cache_dir)
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_cache_record(record: dict[str, Any], cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = cache_path(record["course_id"], cache_dir)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    tmp.replace(p)


# ---------------------------------------------------------------------------
# HTTP fetch
# ---------------------------------------------------------------------------


def fetch_url(url: str) -> tuple[int, str, str | None]:
    """Fetch URL. Returns (http_status, raw_html, error_or_None)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SylloResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "he,en;q=0.9",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            status: int = resp.status
            raw_bytes: bytes = resp.read()
            # Attempt UTF-8, then windows-1255 (common for Hebrew)
            for enc in ("utf-8", "windows-1255", "iso-8859-8"):
                try:
                    return status, raw_bytes.decode(enc), None
                except UnicodeDecodeError:
                    continue
            return status, raw_bytes.decode("utf-8", errors="replace"), None
    except urllib.error.HTTPError as e:
        return e.code, "", f"HTTPError {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return 0, "", f"URLError: {e.reason}"
    except Exception as e:
        return 0, "", f"Exception: {e}"


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run(
    program_id: str,
    year: int,
    delay: float,
    dry_run: bool,
    force: bool,
) -> None:
    repo_root = Path(__file__).parent.parent
    board_path = repo_root / BOARD_FILE[program_id]
    cache_dir = repo_root / "data" / "syllabi_cache"
    report_path = cache_dir / "fetch_report.json"

    print(f"Loading board: {board_path}")
    with open(board_path, encoding="utf-8") as f:
        board = json.load(f)

    all_courses = collect_courses(board)

    # Courses missing content that have a URL to fetch
    candidates = [
        c for c in all_courses
        if not has_content(c) and get_source_url(c) is not None
    ]

    # Filter out already-cached (unless --force)
    if not force:
        candidates = [
            c for c in candidates
            if load_cache_record(c["course_id"], cache_dir) is None
        ]

    total = len(all_courses)
    no_content = len([c for c in all_courses if not has_content(c)])
    has_url = len([c for c in all_courses if not has_content(c) and get_source_url(c)])
    already_cached = len([c for c in all_courses
                          if not has_content(c) and get_source_url(c) is not None
                          and load_cache_record(c["course_id"], cache_dir) is not None])

    print(f"\nProgram:          {program_id}")
    print(f"Total courses:    {total}")
    print(f"Missing content:  {no_content}")
    print(f"Has source URL:   {has_url}")
    print(f"Already cached:   {already_cached}")
    print(f"To fetch:         {len(candidates)}")
    print(f"Year:             {year}")
    print(f"Rate limit:       {delay}s between requests")

    if dry_run:
        print("\n=== DRY RUN ===")
        for c in candidates:
            url = get_source_url(c) or build_tau_url(c["course_id"], year)
            print(f"  {c['course_id']:15s}  {c.get('name_he', c.get('name', ''))[:40]}  → {url}")
        print(f"\n{len(candidates)} courses would be fetched.")
        return

    fetched = 0
    failed = 0
    skipped = 0
    report: list[dict[str, Any]] = []

    for i, course in enumerate(candidates):
        course_id = course["course_id"]
        url = get_source_url(course) or build_tau_url(course_id, year)
        name = course.get("name_he") or course.get("name") or ""

        print(f"[{i+1}/{len(candidates)}] {course_id} {name[:35]:35s}", end=" ", flush=True)

        status, raw_html, error = fetch_url(url)

        fetched_at = datetime.now(timezone.utc).isoformat()
        record: dict[str, Any] = {
            "course_id": course_id,
            "source_url": url,
            "fetched_at": fetched_at,
            "http_status": status,
            "content_len": len(raw_html),
            "raw_html": raw_html,
            "error": error,
        }
        save_cache_record(record, cache_dir)

        report_entry: dict[str, Any] = {
            "course_id": course_id,
            "url": url,
            "status": status,
            "content_len": len(raw_html),
            "error": error,
            "fetched_at": fetched_at,
        }
        report.append(report_entry)

        if error:
            print(f"FAILED — {error}")
            failed += 1
        elif status == 200 and len(raw_html) > 500:
            print(f"OK — {len(raw_html)} chars")
            fetched += 1
        elif status == 404:
            print(f"NOT FOUND (404)")
            failed += 1
        else:
            print(f"UNEXPECTED — HTTP {status}, {len(raw_html)} chars")
            skipped += 1

        if i < len(candidates) - 1:
            time.sleep(delay)

    # Write run report
    cache_dir.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "program_id": program_id,
                "run_at": datetime.now(timezone.utc).isoformat(),
                "year": year,
                "fetched": fetched,
                "failed": failed,
                "skipped": skipped,
                "results": report,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"\n=== DONE ===")
    print(f"Fetched: {fetched}, Failed: {failed}, Skipped: {skipped}")
    print(f"Cache dir:   {cache_dir}")
    print(f"Report:      {report_path}")
    print(
        "\nNext step: review cached HTML for quality, then update board JSON "
        "syllabi fields manually or via a parsing script."
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch missing official syllabi from the TAU syllabus portal"
    )
    parser.add_argument(
        "--program",
        required=True,
        choices=list(BOARD_FILE.keys()),
        help="Program board to process",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=DEFAULT_YEAR,
        help=f"Syllabus year to request (default: {DEFAULT_YEAR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        metavar="SECONDS",
        help=f"Seconds between requests (default: {DEFAULT_DELAY})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be fetched without making requests",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch even if the course is already in the cache",
    )
    args = parser.parse_args()
    run(args.program, args.year, args.delay, args.dry_run, args.force)
