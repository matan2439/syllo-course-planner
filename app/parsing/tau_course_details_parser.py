"""
Parser for TAU course search/details pages (search_l.aspx).
Extracts syllabus and related links from the HTML.
Pure parsing logic — no network I/O.

The search_l.aspx page contains these named links when available:
  - סילבוס         → /Tal/Syllabus/Syllabus_L.aspx?course=XXXXXXXXXXX&year=YYYY
  - בחינה          → javascript:open_win('Bhina_L.aspx?...')
  - דרישות קדם     → javascript:open_win('Drishot_L.aspx?...')
  - Moodle         → https://moodle.tau.ac.il/course/view.php?id=...
  - רשימת תפוצה    → http://listserv.tau.ac.il/archives/...
"""

from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup

_IMS_BASE = "https://ims.tau.ac.il"
_IMS_KR_BASE = "https://ims.tau.ac.il/tal/kr/"


def parse_course_details_links(
    html: str,
    base_url: str = _IMS_BASE,
) -> dict[str, Optional[str]]:
    """Extract course-related links from a search_l.aspx HTML page.

    Returns a dict with keys:
        syllabus_url, exam_url, prerequisites_url, moodle_url, mailing_list_url
    Each value is a full absolute URL or None if the link was not found.
    """
    result: dict[str, Optional[str]] = {
        "syllabus_url":      None,
        "exam_url":          None,
        "prerequisites_url": None,
        "moodle_url":        None,
        "mailing_list_url":  None,
    }

    soup = BeautifulSoup(html, "lxml")

    for a in soup.find_all("a"):
        title = (a.get("title") or "").strip()
        href  = (a.get("href") or "").strip()
        text  = a.get_text(strip=True)
        label = title or text

        if not href:
            continue

        if label in ("סילבוס", "Syllabus") or "Syllabus_L.aspx" in href:
            result["syllabus_url"] = _resolve(href, base_url, _IMS_KR_BASE)

        elif label == "בחינה" or "Bhina_L.aspx" in href or "bhina" in href.lower():
            result["exam_url"] = _resolve(href, base_url, _IMS_KR_BASE)

        elif label == "דרישות קדם" or "Drishot_L.aspx" in href or "drishot" in href.lower():
            result["prerequisites_url"] = _resolve(href, base_url, _IMS_KR_BASE)

        elif "moodle.tau.ac.il" in href or label == "Moodle":
            result["moodle_url"] = href if href.startswith("http") else None

        elif "listserv.tau.ac.il" in href or "תפוצה" in label:
            result["mailing_list_url"] = href if href.startswith("http") else None

    return result


def _resolve(href: str, base: str, js_base: str) -> Optional[str]:
    """Resolve a relative, javascript:, or absolute href to a full URL."""
    if not href:
        return None
    if href.startswith("javascript:"):
        return _extract_from_js(href, js_base)
    if href.startswith("/"):
        return base.rstrip("/") + href
    if href.startswith("http"):
        return href
    return js_base + href


def _extract_from_js(js_href: str, base: str) -> Optional[str]:
    """Extract URL from javascript:open_win('url', ...) pattern."""
    m = re.search(r"open_win\('([^']+)'", js_href)
    if not m:
        return None
    url = m.group(1)
    if url.startswith("http"):
        return url
    return base.rstrip("/") + "/" + url.lstrip("/")
