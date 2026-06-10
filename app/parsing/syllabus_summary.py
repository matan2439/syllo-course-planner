"""
Builds a compact, structured Hebrew syllabus summary from a parsed
SyllabusData object (see app.parsing.syllabus_parser).

This is pure post-processing — no network I/O. It is intended to run as
part of the offline import/enrichment pipeline (see
app.pipeline.fetch_syllabus_summaries), NOT during AI chat requests.

The output dict matches the fields stored on board_json course records:
  - syllabus_text_available
  - syllabus_summary_he
  - syllabus_topics_he
  - syllabus_prerequisites_he
  - syllabus_assessment_he
  - syllabus_structure_he
  - syllabus_source_url
  - syllabus_last_fetched_at
  - syllabus_confidence
"""

import re
from typing import Optional

from app.models.syllabus import SyllabusData

# Hebrew section labels that appear as "<label>:" lines inside the free-text
# course_description block on TAU syllabus pages.
_TOPIC_LABELS = ("נושאי לימוד", "מעבדות")
_PREREQ_LABELS = ("דרישות קדם",)
_STRUCTURE_LABELS = ("הרצאות", "מבנה הקורס")
_ALL_LABELS = _TOPIC_LABELS + _PREREQ_LABELS + _STRUCTURE_LABELS + ("משקל", "מומלץ")

_ASSESSMENT_KEYWORDS = ("דוח", "דו\"ח", "מטלה", "מטלות", "בחינה", "מבחן", "הגשת", "הגשה", "ציון")

_LABEL_LINE_RE = re.compile(r"^\s*([^\n:]{1,20}?)\s*:\s*(.*)$")


def _split_sections(description: str) -> dict[str, list[str]]:
    """Split a free-text course_description into {label: [lines]} sections.

    Lines before the first recognised label are ignored for section purposes
    (they remain available via the raw description for the summary).
    """
    sections: dict[str, list[str]] = {}
    current: Optional[str] = None
    for raw_line in description.split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("-"):
            # Bulleted notes (e.g. course-update announcements) are not
            # part of the structured topic/section lists.
            current = None
            continue
        m = _LABEL_LINE_RE.match(line)
        if m and m.group(1) in _ALL_LABELS:
            current = m.group(1)
            sections.setdefault(current, [])
            rest = m.group(2).strip()
            if rest:
                sections[current].append(rest)
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def _split_list(text: str) -> list[str]:
    """Split a comma/semicolon-separated Hebrew list into trimmed items."""
    parts = re.split(r"[,;]", text)
    items = []
    for p in parts:
        p = p.strip().strip(".").strip()
        # Split trailing " ו-X" connector into a separate item.
        m = re.match(r"^(.*?)\s+ו-(.+)$", p)
        if m and m.group(1) and m.group(2):
            items.append(m.group(1).strip())
            items.append(m.group(2).strip())
            continue
        if p:
            items.append(p)
    # Deduplicate while preserving order
    seen: set[str] = set()
    result = []
    for it in items:
        if it not in seen:
            seen.add(it)
            result.append(it)
    return result


def _extract_topics(sections: dict[str, list[str]]) -> list[str]:
    topics: list[str] = []
    for label in _TOPIC_LABELS:
        for line in sections.get(label, []):
            topics.extend(_split_list(line))
    return topics


def _extract_prerequisites(sections: dict[str, list[str]], fallback: list[str]) -> list[str]:
    prereqs: list[str] = []
    for label in _PREREQ_LABELS:
        for line in sections.get(label, []):
            prereqs.extend(_split_list(line))
    if prereqs:
        return prereqs
    # Fall back to the raw prerequisites text already extracted by the parser
    return _split_list(" ".join(fallback)) if fallback else []


def _extract_structure(sections: dict[str, list[str]], syllabus: SyllabusData) -> Optional[str]:
    parts: list[str] = []
    if syllabus.lecture_hours is not None:
        parts.append(f"{syllabus.lecture_hours} שעות הרצאה")
    if syllabus.tutorial_hours is not None:
        parts.append(f"{syllabus.tutorial_hours} שעות תרגול")
    if syllabus.lab_hours is not None:
        parts.append(f"{syllabus.lab_hours} שעות מעבדה")
    for label in _STRUCTURE_LABELS:
        for line in sections.get(label, []):
            parts.append(line)
    return " | ".join(parts) if parts else None


def _extract_assessment(syllabus: SyllabusData, description: str) -> Optional[str]:
    parts: list[str] = []
    if syllabus.assignments:
        parts.append(syllabus.assignments)
    if syllabus.exam_info:
        parts.append(syllabus.exam_info)
    # Pick out additional sentences mentioning assessment-related keywords
    # that aren't already covered (e.g. lab-report policy buried in free text).
    for line in description.split("\n"):
        line = line.strip().strip("-").strip()
        if not line or line in parts:
            continue
        if any(kw in line for kw in _ASSESSMENT_KEYWORDS):
            parts.append(line)
    # Keep it compact
    return " | ".join(parts[:5]) if parts else None


def _extract_summary(description: str, topics: list[str]) -> Optional[str]:
    if not description:
        return None
    lines = [l.strip() for l in description.split("\n") if l.strip()]
    intro = " ".join(lines[:2])
    if topics:
        intro = f"{intro} נושאים מרכזיים: {', '.join(topics[:6])}."
    return intro[:600] if intro else None


def build_syllabus_summary(
    syllabus: Optional[SyllabusData],
    source_url: Optional[str] = None,
    fetched_at: Optional[str] = None,
) -> dict:
    """Build the compact structured syllabus-summary fields for a course record.

    If `syllabus` is None (page could not be fetched/parsed), returns
    syllabus_text_available=False with all other fields None/empty so the
    AI can be told explicitly that no syllabus content is available.
    """
    if syllabus is None:
        return {
            "syllabus_text_available":   False,
            "syllabus_summary_he":       None,
            "syllabus_topics_he":        [],
            "syllabus_prerequisites_he": [],
            "syllabus_assessment_he":    None,
            "syllabus_structure_he":     None,
            "syllabus_source_url":       source_url,
            "syllabus_last_fetched_at":  fetched_at,
            "syllabus_confidence":       0.0,
        }

    description = syllabus.course_description or ""
    sections = _split_sections(description)

    topics = _extract_topics(sections) or syllabus.topics
    prerequisites = _extract_prerequisites(sections, syllabus.prerequisites_raw_text and [syllabus.prerequisites_raw_text] or [])
    structure = _extract_structure(sections, syllabus)
    assessment = _extract_assessment(syllabus, description)
    summary = _extract_summary(description, topics)

    has_any_text = bool(description or syllabus.assignments or syllabus.topics)

    fields_found = sum(1 for v in (topics, prerequisites, assessment, structure, summary) if v)
    confidence = round(fields_found / 5, 2) if has_any_text else 0.0

    return {
        "syllabus_text_available":   has_any_text,
        "syllabus_summary_he":       summary,
        "syllabus_topics_he":        topics,
        "syllabus_prerequisites_he": prerequisites,
        "syllabus_assessment_he":    assessment,
        "syllabus_structure_he":     structure,
        "syllabus_source_url":       source_url,
        "syllabus_last_fetched_at":  fetched_at,
        "syllabus_confidence":       confidence,
    }
