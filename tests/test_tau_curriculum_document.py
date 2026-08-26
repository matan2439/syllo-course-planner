from __future__ import annotations

import pytest

from app.parsing.tau_curriculum_document import (
    CurriculumSource,
    CurriculumSourceMismatch,
    CurriculumTextPage,
    parse_curriculum_document,
)


SOURCE = CurriculumSource(
    program_code="0512-11-01-0000",
    program_title_he="תוכנית חד-חוגית בהנדסת חשמל",
    academic_year_he='תשפ"ה',
    source_url="https://www.tau.ac.il/tochniot/pdf/2024/heb/051211010000.pdf",
    printed_on="21/07/25",
)


def _official_excerpt_pages() -> list[CurriculumTextPage]:
    return [
        CurriculumTextPage(
            page_number=1,
            text='''
תוכנית חד-חוגית בהנדסת חשמל
שם התואר המוענק:
Sc.B. בהנדסת חשמל
שנת הידיעון:
תשפ"ה תאריך הדפסה 21/07/25
''',
        ),
        CurriculumTextPage(
            page_number=7,
            text='''
תוכנית חד-חוגית בהנדסת חשמל 0512-11-01-0000 תשפ"ה
1.2 מבנה הלימודים
47 ש"ס
שנה א' - קורסי חובה
45 ש"ס
שנה ב' - קורסי חובה
19 ש"ס
שנה ג' - קורסי חובה
8 ש"ס
שנה ד' - קורסי חובה
48 ש"ס
קורסי מסלול שנים ג' + ד'
6-8 ש"ס
מעבדות מתקדמות )שנים ג' - ד'(
6 ש"ס
קורסי שאר רוח
מכסת שעות לתואר 179 ש"ס תאריך הדפסה 21/07/25
''',
        ),
        CurriculumTextPage(
            page_number=10,
            text='''
תוכנית חד-חוגית בהנדסת חשמל 0512-11-01-0000 תשפ"ה
2.1 שנה א' - קורסי חובה
2.1.1 סמסטר א' - קורסי חובה
0509-1117 אופן הוראה סה"כ שעות משקל בציון
כלים מתמטיים לפיזיקה שיעור 2 ש"ס
תרגיל 2 ש"ס
3.5 4
0509-1118 אופן הוראה סה"כ שעות משקל בציון
מכניקה קלאסית להנדסת חשמל שיעור 4 ש"ס
תרגיל 2 ש"ס
5.5 6
דרישות מקבילות
כלים מתמטיים לפיזיקה )0509-1117(
''',
        ),
        CurriculumTextPage(
            page_number=11,
            text='''
תוכנית חד-חוגית בהנדסת חשמל 0512-11-01-0000 תשפ"ה
2.1.2 סמסטר ב' - קורסי חובה
0509-1745 אופן הוראה סה"כ שעות משקל בציון
משוואות דיפרנציאליות רגילות להנדסת חשמל ואלקטרוניקה
שיעור 3 ש"ס
תרגיל 1 ש"ס
4 4
דרישות קדם
אלגברה לינארית )0509-1824( או
אלגברה לינארית להנדסת חשמל ואלקטרוניקה )0509-1724(
דרישות מקבילות
חשבון דיפרנציאלי ואינטגרלי 2ב' )0509-1747(
3. מערכת שעות לשנת הלימודים תשפ"ה
3.1 שנה א' - קורסי חובה
3.1.1 סמסטר א' - קורסי חובה
0509-1117 אופן הוראה סה"כ שעות משקל בציון
כלים מתמטיים לפיזיקה שיעור 2 ש"ס
''',
        ),
    ]


def test_parses_authoritative_identity_and_degree_structure() -> None:
    result = parse_curriculum_document(_official_excerpt_pages(), SOURCE)

    assert result.identity.program_code == "0512-11-01-0000"
    assert result.identity.program_title_he == "תוכנית חד-חוגית בהנדסת חשמל"
    assert result.identity.degree_name == "Sc.B. בהנדסת חשמל"
    assert result.identity.academic_year_he == 'תשפ"ה'
    assert result.identity.printed_on == "21/07/25"
    assert result.identity.source_url == SOURCE.source_url
    assert result.total_required_hours == 179
    assert [(part.kind, part.hours_min, part.hours_max) for part in result.structure] == [
        ("mandatory_year_1", 47.0, 47.0),
        ("mandatory_year_2", 45.0, 45.0),
        ("mandatory_year_3", 19.0, 19.0),
        ("mandatory_year_4", 8.0, 8.0),
        ("track_courses", 48.0, 48.0),
        ("advanced_labs", 6.0, 8.0),
        ("humanities", 6.0, 6.0),
    ]


def test_parses_mandatory_courses_with_source_provenance_and_prerequisites() -> None:
    result = parse_curriculum_document(_official_excerpt_pages(), SOURCE)
    courses = {course.course_id: course for course in result.mandatory_courses}

    assert sorted(courses) == ["0509-1117", "0509-1118", "0509-1745"]
    assert courses["0509-1117"].year == 1
    assert courses["0509-1117"].semester == "a"
    assert courses["0509-1117"].weekly_hours == 4.0
    assert courses["0509-1117"].credit_hours == 3.5
    assert courses["0509-1117"].source_pages == (10,)
    assert courses["0509-1118"].concurrent_course_ids == ("0509-1117",)
    assert courses["0509-1745"].prerequisite_course_ids == ("0509-1724", "0509-1824")
    assert courses["0509-1745"].concurrent_course_ids == ("0509-1747",)


def test_ignores_later_schedule_copy_instead_of_double_counting_course() -> None:
    result = parse_curriculum_document(_official_excerpt_pages(), SOURCE)

    course = next(course for course in result.mandatory_courses if course.course_id == "0509-1117")
    assert course.source_pages == (10,)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("program_code", "0512-11-99-9999"),
        ("program_title_he", "תוכנית אחרת"),
        ("academic_year_he", 'תשפ"ו'),
        ("printed_on", "01/01/26"),
    ],
)
def test_fails_closed_when_document_identity_does_not_match_source(field: str, replacement: str) -> None:
    source_values = SOURCE.__dict__ | {field: replacement}
    mismatched = CurriculumSource(**source_values)

    with pytest.raises(CurriculumSourceMismatch):
        parse_curriculum_document(_official_excerpt_pages(), mismatched)


def test_conflicting_duplicate_course_facts_are_unresolved_not_selected_by_order() -> None:
    pages = _official_excerpt_pages()
    pages.insert(
        3,
        CurriculumTextPage(
            page_number=10,
            text='''
2.1.1 סמסטר א' - קורסי חובה
0509-1117 אופן הוראה סה"כ שעות משקל בציון
כלים מתמטיים לפיזיקה שיעור 3 ש"ס
תרגיל 2 ש"ס
4.5 5
''',
        ),
    )

    result = parse_curriculum_document(pages, SOURCE)

    assert "0509-1117" not in {course.course_id for course in result.mandatory_courses}
    conflict = next(item for item in result.unresolved if item.course_id == "0509-1117")
    assert conflict.reason == "conflicting_authoritative_course_facts"
    assert conflict.source_pages == (10,)


def test_page_order_does_not_change_the_parsed_identity_or_courses() -> None:
    pages = _official_excerpt_pages()

    forward = parse_curriculum_document(pages, SOURCE)
    reverse = parse_curriculum_document(list(reversed(pages)), SOURCE)

    assert reverse.identity == forward.identity
    assert reverse.total_required_hours == forward.total_required_hours
    assert reverse.structure == forward.structure
    assert reverse.mandatory_courses == forward.mandatory_courses


def test_course_block_can_continue_across_a_pdf_page_boundary() -> None:
    pages = _official_excerpt_pages()[:3]
    pages.extend(
        [
            CurriculumTextPage(
                page_number=11,
                text='''
2.1.2 סמסטר ב' - קורסי חובה
0509-1745 אופן הוראה סה"כ שעות משקל בציון
משוואות דיפרנציאליות רגילות להנדסת חשמל ואלקטרוניקה
שיעור 3 ש"ס
תרגיל 1 ש"ס
4 4
דרישות קדם
''',
            ),
            CurriculumTextPage(
                page_number=12,
                text='''
תוכנית חד-חוגית בהנדסת חשמל 0512-11-01-0000 תשפ"ה
12 מתוך 294
אלגברה לינארית )0509-1824( או
אלגברה לינארית להנדסת חשמל ואלקטרוניקה )0509-1724(
דרישות מקבילות
חשבון דיפרנציאלי ואינטגרלי 2ב' )0509-1747(
3. מערכת שעות לשנת הלימודים תשפ"ה
''',
            ),
        ]
    )

    result = parse_curriculum_document(pages, SOURCE)
    course = next(course for course in result.mandatory_courses if course.course_id == "0509-1745")

    assert course.prerequisite_course_ids == ("0509-1724", "0509-1824")
    assert course.concurrent_course_ids == ("0509-1747",)
    assert course.source_pages == (11, 12)
