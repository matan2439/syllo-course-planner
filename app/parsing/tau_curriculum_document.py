"""Fail-closed ingestion for authoritative TAU curriculum document text.

This module is a source adapter.  It converts text extracted from a frozen TAU
curriculum PDF into typed facts with page provenance; it does not decide degree
requirements, rank courses, or infer categories from titles.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


_COURSE_ID = re.compile(r"(?<!\d)(\d{4})[-.]?(\d{4})(?!\d)")
_SECTION_2 = re.compile(r"^\.?2\.([1-4])(?:\.(1|2))?\b")
_SECTION_3 = re.compile(r"^\.?3\.\s*(?:מערכת|לוח)\b")
_NUMBER_PAIR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$")
_PRINT_DATE = re.compile(r"תאריך\s+הדפסה\s+(\d{2}/\d{2}/\d{2})")
_SOURCE_ACADEMIC_YEAR = re.compile(r"/tochniot/pdf/(\d{4})/")


@dataclass(frozen=True)
class CurriculumSource:
    program_code: str
    program_title_he: str
    academic_year_he: str
    source_url: str
    printed_on: str
    academic_year: int | None = None


@dataclass(frozen=True)
class CurriculumTextPage:
    page_number: int
    text: str


@dataclass(frozen=True)
class CurriculumIdentity:
    program_code: str
    program_title_he: str
    degree_name: str
    academic_year_he: str
    printed_on: str
    source_url: str


@dataclass(frozen=True)
class CurriculumStructurePart:
    kind: str
    hours_min: float
    hours_max: float
    source_pages: tuple[int, ...]


@dataclass(frozen=True)
class CurriculumCourse:
    course_id: str
    name_he: str
    year: int
    semester: str
    weekly_hours: float
    credit_hours: float
    prerequisite_course_ids: tuple[str, ...]
    concurrent_course_ids: tuple[str, ...]
    source_pages: tuple[int, ...]


@dataclass(frozen=True)
class UnresolvedCurriculumFact:
    course_id: str
    reason: str
    source_pages: tuple[int, ...]


@dataclass(frozen=True)
class SelectionRuleResolution:
    resolved_rule: CurriculumSelectionRule | None
    reason: str | None
    source_urls: tuple[str, ...]


@dataclass(frozen=True)
class CurriculumSelectionRule:
    """Generic cross-category minima stated by an authoritative program source."""

    total_track_courses: int
    minimum_core_courses: int
    minimum_distinct_core_tracks: int
    advanced_labs_required: int
    minimum_distinct_lab_tracks: int
    labs_require_prerequisites: bool
    source_pages: tuple[int, ...] = ()
    source_url: str = ""
    academic_year: int | None = None

    def _semantic_identity(self) -> tuple[int, int, int, int, int, bool]:
        return (
            self.total_track_courses,
            self.minimum_core_courses,
            self.minimum_distinct_core_tracks,
            self.advanced_labs_required,
            self.minimum_distinct_lab_tracks,
            self.labs_require_prerequisites,
        )

    def reconcile(
        self,
        other: CurriculumSelectionRule,
        *,
        other_source_url: str | None = None,
    ) -> SelectionRuleResolution:
        effective_other_url = other_source_url or other.source_url
        source_urls = tuple(url for url in (self.source_url, effective_other_url) if url)
        if self._semantic_identity() != other._semantic_identity():
            if (
                self.academic_year is not None
                and other.academic_year is not None
                and self.academic_year != other.academic_year
                and _year_matches_source(self.academic_year, self.source_url)
                and _year_matches_source(other.academic_year, effective_other_url)
            ):
                newer = self if self.academic_year > other.academic_year else other
                return SelectionRuleResolution(
                    resolved_rule=newer,
                    reason="newer_academic_year_authority",
                    source_urls=source_urls,
                )
            return SelectionRuleResolution(
                resolved_rule=None,
                reason="conflicting_authoritative_selection_rules",
                source_urls=source_urls,
            )
        return SelectionRuleResolution(
            resolved_rule=self,
            reason=None,
            source_urls=source_urls,
        )


def _year_matches_source(academic_year: int, source_url: str) -> bool:
    match = _SOURCE_ACADEMIC_YEAR.search(source_url)
    return match is not None and int(match.group(1)) == academic_year


@dataclass(frozen=True)
class ParsedCurriculumDocument:
    identity: CurriculumIdentity
    total_required_hours: float
    structure: tuple[CurriculumStructurePart, ...]
    selection_rule: CurriculumSelectionRule
    mandatory_courses: tuple[CurriculumCourse, ...]
    unresolved: tuple[UnresolvedCurriculumFact, ...]


class CurriculumSourceMismatch(ValueError):
    """The extracted document does not match its declared authoritative source."""


def restore_rtl_pdf_line(line: str) -> str:
    """Restore a visually reversed RTL PDF line without reversing LTR ids."""
    restored: list[str] = []
    for token in reversed(line.split()):
        if re.fullmatch(r"[A-Za-z0-9./:+_-]+", token):
            restored.append(token)
        else:
            restored.append(token[::-1])
    return " ".join(restored)


def _lines(page: CurriculumTextPage) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in page.text.splitlines() if line.strip()]


def _normal_course_id(raw: str) -> str:
    match = _COURSE_ID.search(raw)
    if not match:
        raise ValueError(f"Invalid course id: {raw!r}")
    return f"{match.group(1)}-{match.group(2)}"


def _document_identity(pages: list[CurriculumTextPage], source: CurriculumSource) -> CurriculumIdentity:
    text = "\n".join(page.text for page in pages)
    normalized_text = re.sub(r"\s+", " ", text)
    required = {
        "program code": source.program_code,
        "program title": re.sub(r"\s+", " ", source.program_title_he).strip(),
        "academic year": source.academic_year_he,
        "print date": source.printed_on,
    }
    missing = [label for label, value in required.items() if value not in normalized_text]
    if missing:
        raise CurriculumSourceMismatch(f"Document/source identity mismatch: {', '.join(missing)}")

    degree_match = re.search(r"שם\s+התואר\s+המוענק\s*:\s*\n?\s*([^\n]+)", text)
    dates = set(_PRINT_DATE.findall(text))
    if not degree_match or dates != {source.printed_on}:
        raise CurriculumSourceMismatch("Document degree or print-date identity is missing or conflicting")

    return CurriculumIdentity(
        program_code=source.program_code,
        program_title_he=source.program_title_he,
        degree_name=degree_match.group(1).strip(),
        academic_year_he=source.academic_year_he,
        printed_on=source.printed_on,
        source_url=source.source_url,
    )


_STRUCTURE_LABELS = (
    ("mandatory_year_1", "שנה א' - קורסי חובה"),
    ("mandatory_year_2", "שנה ב' - קורסי חובה"),
    ("mandatory_year_3", "שנה ג' - קורסי חובה"),
    ("mandatory_year_4", "שנה ד' - קורסי חובה"),
    ("track_courses", "קורסי מסלול שנים ג' + ד'"),
    ("advanced_labs", "מעבדות מתקדמות"),
    ("humanities", "קורסי שאר רוח"),
)


def _parse_hours(raw: str) -> tuple[float, float] | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?\s+ש[\"״]ס", raw)
    if not match:
        return None
    lower = float(match.group(1))
    return lower, float(match.group(2) or match.group(1))


def _structure(pages: list[CurriculumTextPage]) -> tuple[tuple[CurriculumStructurePart, ...], float]:
    found: dict[str, CurriculumStructurePart] = {}
    total_values: set[float] = set()
    for page in pages:
        lines = _lines(page)
        for index, line in enumerate(lines):
            total_match = re.search(r"מכסת\s+שעות\s+לתואר\s+(\d+(?:\.\d+)?)\s+ש[\"״]ס", line)
            if total_match:
                total_values.add(float(total_match.group(1)))
            for kind, label in _STRUCTURE_LABELS:
                if label not in line or index == 0:
                    continue
                hours = _parse_hours(lines[index - 1])
                if not hours:
                    continue
                part = CurriculumStructurePart(kind, hours[0], hours[1], (page.page_number,))
                existing = found.get(kind)
                if existing and existing != part:
                    raise CurriculumSourceMismatch(f"Conflicting structure facts for {kind}")
                found[kind] = part
    expected = [kind for kind, _ in _STRUCTURE_LABELS]
    if list(found) != expected or len(total_values) != 1:
        raise CurriculumSourceMismatch("Degree structure is incomplete or conflicting")
    return tuple(found[kind] for kind in expected), next(iter(total_values))


def _ids(lines: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted({_normal_course_id(match.group(0)) for line in lines for match in _COURSE_ID.finditer(line)}))


def _course_from_block(
    course_id: str,
    tagged_block: list[tuple[int, str]],
    *,
    year: int,
    semester: str,
) -> CurriculumCourse | None:
    block = [line for _, line in tagged_block]
    pair_index = next((i for i, line in enumerate(block) if _NUMBER_PAIR.match(line)), None)
    if pair_index is None:
        return None
    pair = _NUMBER_PAIR.match(block[pair_index])
    assert pair is not None
    credit_hours = float(pair.group(1))
    weekly_hours = float(pair.group(2))

    name_parts: list[str] = []
    for line in block[:pair_index]:
        if line.startswith(("תרגיל ", "מעבדה ", "סדנה ")):
            continue
        if "אופן הוראה" in line or line.startswith("תוכנית ") or " מתוך " in line:
            continue
        before_format = re.split(r"\s+(?:שיעור|תרגיל|מעבדה|סדנה)\s+\d", line, maxsplit=1)[0]
        if before_format and not re.fullmatch(r"\d+(?:\.\d+)?", before_format):
            name_parts.append(before_format)
    name = " ".join(name_parts).strip()
    if not name:
        return None

    prereq_start = next((i for i, line in enumerate(block) if line == "דרישות קדם"), None)
    concurrent_start = next((i for i, line in enumerate(block) if line == "דרישות מקבילות"), None)
    prereq_lines: list[str] = []
    concurrent_lines: list[str] = []
    if prereq_start is not None:
        stop = concurrent_start if concurrent_start is not None and concurrent_start > prereq_start else len(block)
        prereq_lines = block[prereq_start + 1 : stop]
    if concurrent_start is not None:
        concurrent_lines = block[concurrent_start + 1 :]

    return CurriculumCourse(
        course_id=course_id,
        name_he=name,
        year=year,
        semester=semester,
        weekly_hours=weekly_hours,
        credit_hours=credit_hours,
        prerequisite_course_ids=_ids(prereq_lines),
        concurrent_course_ids=_ids(concurrent_lines),
        source_pages=tuple(sorted({page_number for page_number, _ in tagged_block})),
    )


def _mandatory_courses(
    pages: list[CurriculumTextPage],
) -> tuple[tuple[CurriculumCourse, ...], tuple[UnresolvedCurriculumFact, ...]]:
    current_year: int | None = None
    current_semester: str | None = None
    occurrences: dict[str, list[CurriculumCourse]] = {}
    in_curriculum = False
    tagged_lines = [
        (page.page_number, line)
        for page in pages
        for line in _lines(page)
    ]
    index = 0
    while index < len(tagged_lines):
        _, line = tagged_lines[index]
        if _SECTION_3.match(line):
            break
        section = _SECTION_2.match(line)
        if section:
            in_curriculum = True
            current_year = int(section.group(1))
            if section.group(2):
                current_semester = "a" if section.group(2) == "1" else "b"
            index += 1
            continue
        course_match = _COURSE_ID.match(line)
        if in_curriculum and current_year and current_semester and course_match:
            course_id = _normal_course_id(course_match.group(0))
            block = [tagged_lines[index]]
            index += 1
            while index < len(tagged_lines):
                next_line = tagged_lines[index][1]
                if _COURSE_ID.match(next_line) or _SECTION_2.match(next_line) or _SECTION_3.match(next_line):
                    break
                block.append(tagged_lines[index])
                index += 1
            parsed = _course_from_block(
                course_id,
                block,
                year=current_year,
                semester=current_semester,
            )
            if parsed:
                occurrences.setdefault(course_id, []).append(parsed)
            continue
        index += 1

    accepted: list[CurriculumCourse] = []
    unresolved: list[UnresolvedCurriculumFact] = []
    for course_id in sorted(occurrences):
        versions = occurrences[course_id]
        facts = {
            (
                item.name_he,
                item.year,
                item.semester,
                item.weekly_hours,
                item.credit_hours,
                item.prerequisite_course_ids,
                item.concurrent_course_ids,
            )
            for item in versions
        }
        pages_for_fact = tuple(sorted({page for item in versions for page in item.source_pages}))
        if len(facts) != 1:
            unresolved.append(
                UnresolvedCurriculumFact(
                    course_id=course_id,
                    reason="conflicting_authoritative_course_facts",
                    source_pages=pages_for_fact,
                )
            )
            continue
        item = versions[0]
        accepted.append(
            CurriculumCourse(
                **{**item.__dict__, "source_pages": pages_for_fact},
            )
        )
    return tuple(accepted), tuple(unresolved)


_HEBREW_COUNT = {
    "אחד": 1,
    "אחת": 1,
    "שני": 2,
    "שתי": 2,
    "שניים": 2,
    "שתיים": 2,
    "שלושה": 3,
    "שלוש": 3,
    "ארבעה": 4,
    "ארבע": 4,
}


def _count(raw: str) -> int:
    normalized = raw.strip()
    if normalized.isdigit():
        return int(normalized)
    if normalized not in _HEBREW_COUNT:
        raise CurriculumSourceMismatch(f"Unsupported authoritative count: {raw!r}")
    return _HEBREW_COUNT[normalized]


def _selection_rule(
    pages: list[CurriculumTextPage],
    source: CurriculumSource,
) -> CurriculumSelectionRule:
    claims: list[CurriculumSelectionRule] = []
    number = r"(\d+|אחד|אחת|שני|שתי|שניים|שתיים|שלושה|שלוש|ארבעה|ארבע)"
    for page in pages:
        text = re.sub(r"\s+", " ", page.text).replace("״", '"')
        total = re.search(rf"סה[\"']כ\s+{number}\s+קורסים\s+\)?לא כולל מעבדות", text)
        core = re.search(rf"לפחות\s+{number}\s+קורסים\s+מוגדרים\s+[\"']קורס ליבה[\"']", text)
        core_tracks = re.search(rf"מ{number}\s+מסלולים\s+שונים", text)
        labs = re.search(rf"יש\s+להשלים\s+{number}\s+מעבדות\s+מתקדמות", text)
        lab_tracks = re.search(rf"ב{number}\s+מסלולים\s+שונים", text)
        if not any((total, core, core_tracks, labs, lab_tracks)):
            continue
        if not all((total, core, core_tracks, labs, lab_tracks)):
            raise CurriculumSourceMismatch("Selection rule is incomplete in the authoritative source")
        claims.append(
            CurriculumSelectionRule(
                total_track_courses=_count(total.group(1)),
                minimum_core_courses=_count(core.group(1)),
                minimum_distinct_core_tracks=_count(core_tracks.group(1)),
                advanced_labs_required=_count(labs.group(1)),
                minimum_distinct_lab_tracks=_count(lab_tracks.group(1)),
                labs_require_prerequisites="דרישות הקדם למעבדה" in text,
                source_pages=(page.page_number,),
                source_url=source.source_url,
                academic_year=source.academic_year,
            )
        )
    if not claims:
        raise CurriculumSourceMismatch("Authoritative selection rule is missing")
    semantic_claims = {claim._semantic_identity() for claim in claims}
    if len(semantic_claims) != 1:
        raise CurriculumSourceMismatch("Authoritative document contains conflicting selection rules")
    claim = claims[0]
    return CurriculumSelectionRule(
        **{
            **claim.__dict__,
            "source_pages": tuple(sorted({page for item in claims for page in item.source_pages})),
        }
    )


def parse_curriculum_document(
    pages: Iterable[CurriculumTextPage],
    source: CurriculumSource,
) -> ParsedCurriculumDocument:
    """Parse authoritative extracted pages after verifying declared identity."""
    ordered_pages = sorted(pages, key=lambda page: (page.page_number, page.text))
    if not ordered_pages:
        raise CurriculumSourceMismatch("Curriculum document has no pages")
    identity = _document_identity(ordered_pages, source)
    structure, total_required_hours = _structure(ordered_pages)
    selection_rule = _selection_rule(ordered_pages, source)
    mandatory_courses, unresolved = _mandatory_courses(ordered_pages)
    return ParsedCurriculumDocument(
        identity=identity,
        total_required_hours=total_required_hours,
        structure=structure,
        selection_rule=selection_rule,
        mandatory_courses=mandatory_courses,
        unresolved=unresolved,
    )
