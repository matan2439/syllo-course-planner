"""
Fetches raw HTML from TAU course and syllabus pages.
No parsing happens here — only network I/O and local caching.
"""

import re
import time
import argparse
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests

_CACHE_DIR = Path("data/raw_html")
_TAU_BASE = "https://ims.tau.ac.il"
_MAX_RETRIES = 3
_RETRY_DELAY = 1.0
_TIMEOUT = 15
_USER_AGENT = "TAU-Course-Planner/0.1 (educational research project)"

# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def normalize_course_id(course_id: str) -> str:
    """Strip all non-digit characters from a course ID.

    >>> normalize_course_id("0368-2157")
    '03682157'
    >>> normalize_course_id("0368 2157")
    '03682157'
    """
    return re.sub(r"\D", "", course_id)


def build_course_search_url(course_id: str, year: int, lang: str | None = None) -> str:
    """Return the TAU static course-search URL for a normalized course ID and year.

    Isolated here so the URL format can be corrected in one place if it changes.
    course_id must already be normalized (digits only).
    Pass lang="EN" to request the English version of the page.
    """
    base = "https://ims.tau.ac.il/tal/kr/search_l.aspx"
    url = f"{base}?course_num={course_id}&year={year}"
    if lang:
        url += f"&lang={lang}"
    return url


def fetch_url(url: str, cache_path: str | Path, force_refresh: bool = False) -> str:
    """Download a URL and cache it locally, or load from cache if available.

    Args:
        url: Absolute URL to fetch.
        cache_path: Where to store/read the cached HTML.
        force_refresh: Skip cache and re-download even if file exists.

    Returns:
        Raw HTML string (UTF-8).

    Raises:
        RuntimeError: If all download attempts fail.
    """
    path = Path(cache_path)

    if path.exists() and not force_refresh:
        print(f"[cache] Loading from {path}")
        return path.read_text(encoding="utf-8")

    print(f"[fetch] GET {url}")
    html = _download_with_retries(url)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    print(f"[cache] Saved to {path}")
    return html


def fetch_course_search_page(
    course_id: str,
    year: int,
    force_refresh: bool = False,
) -> str:
    """Fetch (or load from cache) the TAU course search page for one course."""
    normalized = normalize_course_id(course_id)
    cache_path = _CACHE_DIR / f"course_{normalized}_{year}.html"
    url = build_course_search_url(normalized, year)
    return fetch_url(url, cache_path, force_refresh)


def fetch_syllabus_page(
    syllabus_url: str,
    course_id: str,
    year: int,
    group_number: str | None = None,
    force_refresh: bool = False,
) -> str:
    """Fetch (or load from cache) one TAU syllabus page.

    Args:
        syllabus_url: Absolute or relative TAU syllabus URL.
        course_id: Raw course ID, e.g. "0368-2157" (will be normalized).
        year: Academic year, e.g. 2025.
        group_number: Group identifier, e.g. "01". When provided the cache
            filename includes it: syllabus_{id}_{year}_{group}.html.
            When None the filename is: syllabus_{id}_{year}.html.
        force_refresh: Skip cache and re-download.

    Returns:
        Raw HTML string (UTF-8).
    """
    # Resolve relative links (e.g. "/Tal/Syllabus/Syllabus_L.aspx?...")
    absolute_url = urljoin(_TAU_BASE, syllabus_url)

    normalized = normalize_course_id(course_id)
    if group_number is not None:
        filename = f"syllabus_{normalized}_{year}_{group_number}.html"
    else:
        filename = f"syllabus_{normalized}_{year}.html"

    cache_path = _CACHE_DIR / filename
    return fetch_url(absolute_url, cache_path, force_refresh)


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _download_with_retries(url: str) -> str:
    headers = {"User-Agent": _USER_AGENT}
    last_exc: Optional[Exception] = None

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = requests.get(url, headers=headers, timeout=_TIMEOUT)
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES:
                print(f"[retry] Attempt {attempt}/{_MAX_RETRIES} failed: {exc}. Retrying in {_RETRY_DELAY}s...")
                time.sleep(_RETRY_DELAY)

    raise RuntimeError(
        f"Failed to fetch {url} after {_MAX_RETRIES} attempts"
    ) from last_exc


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch and cache a TAU course search page or syllabus page."
    )
    parser.add_argument("--course", required=True, help="Course ID, e.g. 0368-2157")
    parser.add_argument("--year", required=True, type=int, help="Academic year, e.g. 2025")
    parser.add_argument("--force-refresh", action="store_true",
                        help="Ignore existing cache and re-download")
    parser.add_argument("--syllabus-url", default=None,
                        help="Fetch a specific syllabus URL instead of the course search page")
    parser.add_argument("--group", default=None,
                        help="Group number for the syllabus cache filename, e.g. 01")
    args = parser.parse_args()

    if args.syllabus_url:
        html = fetch_syllabus_page(
            syllabus_url=args.syllabus_url,
            course_id=args.course,
            year=args.year,
            group_number=args.group,
            force_refresh=args.force_refresh,
        )
        normalized = normalize_course_id(args.course)
        suffix = f"_{args.group}" if args.group else ""
        cache_path = _CACHE_DIR / f"syllabus_{normalized}_{args.year}{suffix}.html"
    else:
        html = fetch_course_search_page(
            args.course, args.year, force_refresh=args.force_refresh
        )
        normalized = normalize_course_id(args.course)
        cache_path = _CACHE_DIR / f"course_{normalized}_{args.year}.html"

    print(f"[done] {len(html):,} characters  |  cache: {cache_path}")
