"""
Parses the GraphQL API responses from TAU's tochniot.tau.ac.il program pages.
Pure parsing logic — no network I/O.

Data flow:
  GraphQL body (list[dict])  →  parse_program_body()  →  structured dict
  GraphQL prereq body        →  parse_prereq_body()   →  structured dict
  PDF program + page data    →  enrich_pdf_program()  →  enriched dict

Course-detail URLs
------------------
The stable, public TAU course page URL (no token required):
    https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=<8-digits>&year=<year>

TAU also serves a Syllabus_L.aspx page but it requires a daily SHA-256 token
computed from a hardcoded secret + current date. We do NOT generate that token
here; instead we store the stable search URL as course_details_url.
"""

from __future__ import annotations

import re
from typing import Optional

_COURSE_SEARCH_BASE = "https://ims.tau.ac.il/tal/kr/search_l.aspx"


def build_course_details_url(course_id: str, year: int | str = 2025) -> str | None:
    """Return the stable TAU course search URL for *course_id* and *year*.

    *course_id* may contain hyphens (0542-4120) or be raw digits (05424120).
    Returns None if fewer than 8 digits can be extracted.
    """
    digits = "".join(c for c in str(course_id) if c.isdigit())
    if len(digits) < 7:
        return None
    return f"{_COURSE_SEARCH_BASE}?course_num={digits}&year={year}"

# ---------------------------------------------------------------------------
# Hebrew → structured helpers
# ---------------------------------------------------------------------------

_YEAR_MAP = {
    "א": 1,
    "ב": 2,
    "ג": 3,
    "ד": 4,
}

# Section-to-category mapping for ramaid=23 (core electives)
_CORE_SECTION_CATEGORY: dict[str, str] = {
    "זורמים": "fluids",
    "מוצקים": "solids",
    "מערכות": "systems",
    "מעבדות מתקדמות": "advanced_labs",
}

# ramaid values for the three structural kinds
_MANDATORY_RAMAIDS = {"1", "2", "3", "4"}
_ELECTIVE_CORE_RAMAID = "23"
_SPECIALIZATION_RAMAID = "5"
_HUMANITIES_RAMAIDS = {"6"}

# Section names that are "קורסי שאר רוח" or similar humanities placeholders
_HUMANITIES_SECTION_PATTERNS = re.compile(r"שאר\s+רוח", re.UNICODE)


def normalize_course_id(raw: str) -> str:
    """Normalise a course-ID string to the canonical XXXX-XXXX form.

    >>> normalize_course_id("05421204")
    '0542-1204'
    >>> normalize_course_id("0542-1204")
    '0542-1204'
    """
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    # Already has a hyphen or unexpected length — return as-is after stripping spaces
    return raw.strip()


def _extract_year_from_teurrama(s: str) -> Optional[int]:
    """'שנה א' → 1, 'שנה ג' → 3, unrecognised → None."""
    m = re.search(r"שנה\s+([אבגד])", s)
    if m:
        return _YEAR_MAP.get(m.group(1))
    return None


def _extract_semester_code(s: str) -> Optional[str]:
    """'סמסטר א' → 'a', 'סמסטר ב' → 'b', other → None."""
    m = re.search(r"סמסטר\s+([אב])", s)
    if m:
        return "a" if m.group(1) == "א" else "b"
    return None


def _parse_float(val: str) -> Optional[float]:
    """Safely parse a float string, returning None on failure."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _build_teaching_format(kurs: dict) -> list[dict]:
    """Extract teaching-format list from a kurs dict."""
    fmt = []
    for i in range(1, 4):
        otype = (kurs.get(f"ofenhoraa{i}") or "").strip()
        ohours = (kurs.get(f"shaot{i}") or "").strip()
        if otype:
            h = _parse_float(ohours)
            fmt.append({"type": otype, "hours": h})
    return fmt


def _parse_kurs(kurs: dict, shana: int | str = 2025) -> dict:
    """Parse a single kurs dict into a normalised course record."""
    raw_id = kurs.get("kursshow") or kurs.get("kursid") or ""
    course_id = normalize_course_id(raw_id)
    name_he = (kurs.get("teurkurs") or "").strip()
    weekly_hours = _parse_float(kurs.get("shaotuni") or "")
    credit_hours = _parse_float(kurs.get("mishkal") or "")
    has_prereqs = (kurs.get("drishotkedem") or "0") == "1"
    teaching_format = _build_teaching_format(kurs)

    return {
        "course_id":         course_id,
        "name_he":           name_he or None,
        "weekly_hours":      weekly_hours,
        "credit_hours":      credit_hours,
        "has_prereqs":       has_prereqs,
        "teaching_format":   teaching_format,
        "course_details_url": build_course_details_url(raw_id, shana),
        "detail_source_type": "tau_program_expanded_row",
        "source":            "tau_program_page",
    }


# ---------------------------------------------------------------------------
# Main parser: parse_program_body
# ---------------------------------------------------------------------------

def parse_program_body(body: list[dict]) -> dict:
    """Parse the body array from a ydtochnit GraphQL response.

    Returns a dict with keys:
      program_name_he, academic_year_he, tclongkey, teurtoar, teurshaot,
      mandatory_courses, elective_core_courses, specialization_courses,
      parse_warnings
    """
    warnings: list[str] = []

    if not body:
        return {
            "program_name_he": None,
            "academic_year_he": None,
            "tclongkey": None,
            "teurtoar": None,
            "teurshaot": None,
            "mandatory_courses": [],
            "elective_core_courses": [],
            "specialization_courses": [],
            "parse_warnings": ["Empty body array"],
        }

    prog = body[0]

    # ── top-level metadata ──────────────────────────────────────────────────
    raw_year = (prog.get("teurshana") or "").strip()
    # Extract just the academic-year code (e.g. "תשפ\"ו")
    academic_year_he = raw_year.split("(")[0].strip() if raw_year else None

    program_name_he = (prog.get("teurtochnit") or "").strip() or None
    teurtoar = (prog.get("teurtoar") or "").strip() or None
    tclongkey = (prog.get("tclongkey") or "").strip() or None
    teurshaot = (prog.get("teurshaot") or "").strip() or None

    # Extract total required hours from hesbernosaf HTML
    total_required_hours: Optional[int] = None
    hesber = prog.get("hesbernosaf") or ""
    m = re.search(r"(\d+)\s*שעות", hesber)
    if m:
        total_required_hours = int(m.group(1))

    # ── iterate top-level rama sections ────────────────────────────────────
    mandatory_courses: list[dict] = []
    elective_core_courses: list[dict] = []
    specialization_courses: list[dict] = []

    # Accumulate mandatory courses keyed by course_id (for deduplication)
    # Structure: {course_id: {course_record, semesters: set}}
    mandatory_by_id: dict[str, dict] = {}

    for top_rama in prog.get("rama", []):
        top_ramaid = str(top_rama.get("ramaid", ""))
        top_teurrama = (top_rama.get("teurrama") or "").strip()

        # Skip humanities sections
        if top_ramaid in _HUMANITIES_RAMAIDS:
            continue

        if top_ramaid in _MANDATORY_RAMAIDS:
            year = _extract_year_from_teurrama(top_teurrama)
            if year is None:
                warnings.append(
                    f"Could not extract year from mandatory section: {top_teurrama!r}"
                )
                continue

            for sub_rama in top_rama.get("rama", []):
                sub_teurrama = (sub_rama.get("teurrama") or "").strip()

                # Skip humanities sub-sections
                if _HUMANITIES_SECTION_PATTERNS.search(sub_teurrama):
                    continue

                sem_code = _extract_semester_code(sub_teurrama)
                # Some sections have no semester (e.g. "קורסי חובה" in Y4)
                # For those, we assign both semesters as allowed

                semester_section = sub_teurrama

                for kurs in sub_rama.get("kurs", []):
                    if (kurs.get("mevutal") or "0") == "1":
                        continue
                    if (kurs.get("hidekurs") or "").strip():
                        continue

                    raw_id = kurs.get("kursshow") or kurs.get("kursid") or ""
                    course_id = normalize_course_id(raw_id)

                    if sem_code:
                        semester_key = f"year_{year}_semester_{sem_code}"
                    else:
                        # No semester specified — allow both
                        semester_key = None

                    if course_id not in mandatory_by_id:
                        rec = _parse_kurs(kurs)
                        rec["year"] = year
                        rec["semester_section"] = semester_section
                        rec["allowed_semesters"] = []
                        rec["locked_by_default"] = True
                        rec["placement_rule"] = "fixed_semester"
                        rec["needs_verification"] = False
                        mandatory_by_id[course_id] = rec

                    existing = mandatory_by_id[course_id]

                    if semester_key:
                        if semester_key not in existing["allowed_semesters"]:
                            existing["allowed_semesters"].append(semester_key)
                    else:
                        # No specific semester — add both a and b
                        for s in ["a", "b"]:
                            sk = f"year_{year}_semester_{s}"
                            if sk not in existing["allowed_semesters"]:
                                existing["allowed_semesters"].append(sk)

            continue  # done with mandatory section

        if top_ramaid == _ELECTIVE_CORE_RAMAID:
            for sub_rama in top_rama.get("rama", []):
                sub_teurrama = (sub_rama.get("teurrama") or "").strip()
                category_id = _CORE_SECTION_CATEGORY.get(sub_teurrama)
                if category_id is None:
                    warnings.append(
                        f"Unknown core-elective section name: {sub_teurrama!r}"
                    )
                    category_id = "unknown"

                for kurs in sub_rama.get("kurs", []):
                    if (kurs.get("mevutal") or "0") == "1":
                        continue
                    if (kurs.get("hidekurs") or "").strip():
                        continue
                    rec = _parse_kurs(kurs)
                    rec["category_id"] = category_id
                    rec["section_he"] = sub_teurrama
                    elective_core_courses.append(rec)
            continue

        if top_ramaid == _SPECIALIZATION_RAMAID:
            for sub_rama in top_rama.get("rama", []):
                sub_teurrama = (sub_rama.get("teurrama") or "").strip()
                for kurs in sub_rama.get("kurs", []):
                    if (kurs.get("mevutal") or "0") == "1":
                        continue
                    if (kurs.get("hidekurs") or "").strip():
                        continue
                    rec = _parse_kurs(kurs)
                    rec["specialization_track_he"] = sub_teurrama
                    specialization_courses.append(rec)
            continue

        # Unrecognised section
        warnings.append(
            f"Unrecognised top-level ramaid={top_ramaid} ({top_teurrama!r}), skipped"
        )

    # ── finalise mandatory courses ──────────────────────────────────────────
    for cid, rec in mandatory_by_id.items():
        sems = rec["allowed_semesters"]
        if len(sems) == 1:
            rec["locked_by_default"] = True
            rec["placement_rule"] = "fixed_semester"
        elif len(sems) > 1:
            rec["locked_by_default"] = False
            rec["placement_rule"] = "choose_one_allowed_semester"
        else:
            warnings.append(
                f"Mandatory course {cid} has no semester assigned — defaulting to year"
            )
            rec["locked_by_default"] = False
            rec["placement_rule"] = "choose_one_allowed_semester"
        mandatory_courses.append(rec)

    # Sort mandatory courses for stable output
    mandatory_courses.sort(key=lambda c: (c.get("year", 0), c.get("allowed_semesters", [""])[0], c.get("course_id", "")))

    result: dict = {
        "program_name_he": program_name_he,
        "academic_year_he": academic_year_he,
        "tclongkey": tclongkey,
        "teurtoar": teurtoar,
        "teurshaot": teurshaot,
        "mandatory_courses": mandatory_courses,
        "elective_core_courses": elective_core_courses,
        "specialization_courses": specialization_courses,
        "parse_warnings": warnings,
    }
    if total_required_hours is not None:
        result["total_required_hours"] = total_required_hours

    return result


# ---------------------------------------------------------------------------
# Prerequisites parser: parse_prereq_body
# ---------------------------------------------------------------------------

def _extract_ids_from_prereq_html(html: str) -> list[str]:
    """Extract course-IDs in XXXX-XXXX form from prereq HTML text."""
    return re.findall(r"\d{4}-\d{4}", html)


def _html_to_plain(html: str) -> str:
    """Very lightweight HTML-to-plain-text for prereq shura strings."""
    # Replace <br/> and <br /> with newline
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    # Remove remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    # Collapse extra whitespace (but keep newlines)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_prereq_body(body: list[dict] | dict) -> dict:
    """Parse the body from a yddrishot GraphQL response.

    Returns a dict with:
      course_id, name_he, prereq_kedem_text, prereq_kedem_ids,
      prereq_makbilot_text, prereq_makbilot_ids, parse_warnings
    """
    warnings: list[str] = []

    # body may be a list or a dict depending on API version
    if isinstance(body, dict):
        body = [body]

    if not body:
        return {
            "course_id": None,
            "name_he": None,
            "prereq_kedem_text": None,
            "prereq_kedem_ids": [],
            "prereq_makbilot_text": None,
            "prereq_makbilot_ids": [],
            "parse_warnings": ["Empty prerequisites body"],
        }

    rec = body[0]

    course_name = (rec.get("teurkurs") or "").strip() or None
    # course_id is not directly in the body; caller passes it via tcid/kursid
    # but we can infer from tclongkey pattern or leave it to caller
    course_id: Optional[str] = None

    # drishotkedem is a list of {"shura": "<html>..."}
    kedem_parts: list[str] = []
    for shura_dict in (rec.get("drishotkedem") or []):
        shura = shura_dict.get("shura") or ""
        if shura:
            kedem_parts.append(shura)

    makbilot_parts: list[str] = []
    for shura_dict in (rec.get("drishotmakbilot") or []):
        shura = shura_dict.get("shura") or ""
        if shura:
            makbilot_parts.append(shura)

    kedem_html = " ".join(kedem_parts)
    makbilot_html = " ".join(makbilot_parts)

    kedem_text = _html_to_plain(kedem_html) if kedem_html else None
    makbilot_text = _html_to_plain(makbilot_html) if makbilot_html else None

    kedem_ids = _extract_ids_from_prereq_html(kedem_html)
    makbilot_ids = _extract_ids_from_prereq_html(makbilot_html)

    return {
        "course_id": course_id,
        "name_he": course_name,
        "prereq_kedem_text": kedem_text,
        "prereq_kedem_ids": kedem_ids,
        "prereq_makbilot_text": makbilot_text,
        "prereq_makbilot_ids": makbilot_ids,
        "parse_warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Enrichment: enrich_pdf_program
# ---------------------------------------------------------------------------

def enrich_pdf_program(pdf_program: dict, page_data: dict) -> tuple[dict, list[str]]:
    """Merge TAU program-page data into a PDF-derived program dict.

    Rules:
    - Never replace non-null PDF name_he with null page value
    - Never replace PDF category_id with a different category
    - Add name_he from page_data if PDF has null
    - Add weekly_hours if PDF has null
    - Add teaching_format if not already set

    Returns (enriched_program, warnings).
    """
    import copy

    warnings: list[str] = []
    enriched = copy.deepcopy(pdf_program)

    # Build lookup from page data by course_id
    page_by_id: dict[str, dict] = {}
    for course in page_data.get("mandatory_courses", []):
        cid = course.get("course_id")
        if cid:
            page_by_id[cid] = course
    for course in page_data.get("elective_core_courses", []):
        cid = course.get("course_id")
        if cid:
            page_by_id[cid] = course
    for course in page_data.get("specialization_courses", []):
        cid = course.get("course_id")
        if cid:
            page_by_id[cid] = course

    def _enrich_course(course: dict) -> None:
        cid = course.get("course_id")
        if not cid or cid not in page_by_id:
            return
        page_c = page_by_id[cid]
        # name_he: only fill if null in PDF
        if not course.get("name_he") and page_c.get("name_he"):
            course["name_he"] = page_c["name_he"]
        # hours: fill if absent
        if course.get("hours") is None and page_c.get("weekly_hours") is not None:
            course["hours"] = page_c["weekly_hours"]
        # teaching_format: add if absent
        if not course.get("teaching_format") and page_c.get("teaching_format"):
            course["teaching_format"] = page_c["teaching_format"]
        # category_id: NEVER overwrite from page
        # has_prereqs: fill if absent
        if course.get("has_prereqs") is None and page_c.get("has_prereqs") is not None:
            course["has_prereqs"] = page_c["has_prereqs"]

    # Enrich elective_courses (fluids/solids/systems/labs — already have PDF names)
    for course in enriched.get("elective_courses", []):
        _enrich_course(course)

    # Enrich other_specialization_electives (null names in PDF → fill from API)
    for course in enriched.get("other_specialization_electives", []):
        _enrich_course(course)

    # Add mandatory_courses from page to enriched if not present
    existing_ids = {c.get("course_id") for c in enriched.get("elective_courses", [])}
    if "mandatory_courses_from_page" not in enriched:
        enriched["mandatory_courses_from_page"] = []

    for course in page_data.get("mandatory_courses", []):
        cid = course.get("course_id")
        if cid and cid not in existing_ids:
            enriched["mandatory_courses_from_page"].append(course)

    # Propagate metadata
    if page_data.get("program_name_he"):
        enriched.setdefault("program_name_he", page_data["program_name_he"])
    if page_data.get("total_required_hours"):
        enriched.setdefault("total_required_hours", page_data["total_required_hours"])

    return enriched, warnings
