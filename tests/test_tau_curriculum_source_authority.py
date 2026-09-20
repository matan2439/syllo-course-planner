import pytest

import app.analysis.program_requirements as program_requirements
import app.parsing.tau_curriculum_document as curriculum_document

from app.parsing.tau_curriculum_document import (
    CurriculumAdvancedLabMembership,
    CurriculumMembershipCatalog,
    CurriculumSelectionRule,
    CurriculumSourceMismatch,
    CurriculumTextPage,
    CurriculumTrackMembership,
    _course_from_block,
    parse_advanced_lab_memberships,
    parse_curriculum_membership_catalog,
    parse_track_memberships,
    normalize_track_label,
    restore_rtl_pdf_line,
    validate_membership_completeness,
)


def test_restores_reversed_hebrew_while_preserving_course_ids_and_numbers() -> None:
    assert restore_rtl_pdf_line(
        '- "הביל סרוק" םירדגומ םיסרוק העברא תוחפל םכותמש '
        ')תודבעמ ללוכ אל( םיסרוק 12 כ"הס רובצל שי הריחבה ילולסמב'
    ) == (
        'במסלולי הבחירה יש לצבור סה"כ 12 קורסים (לא כולל מעבדות) '
        'שמתוכם לפחות ארבעה קורסים מוגדרים "קורס ליבה" -'
    )
    assert restore_rtl_pdf_line("0512-4264 תיטסיטטס הנוכמ תדימלל אובמ") == (
        "מבוא ללמידת מכונה סטטיסטית 0512-4264"
    )


def test_newer_academic_year_supersedes_a_conflicting_older_official_rule() -> None:
    older = CurriculumSelectionRule(
        total_track_courses=12,
        minimum_core_courses=3,
        minimum_distinct_core_tracks=3,
        advanced_labs_required=2,
        minimum_distinct_lab_tracks=2,
        labs_require_prerequisites=True,
        source_url="https://www.tau.ac.il/tochniot/pdf/2024/heb/051211010000.pdf",
        academic_year=2024,
    )
    newer = CurriculumSelectionRule(
        total_track_courses=12,
        minimum_core_courses=4,
        minimum_distinct_core_tracks=4,
        advanced_labs_required=2,
        minimum_distinct_lab_tracks=2,
        labs_require_prerequisites=True,
        source_url="https://www.tau.ac.il/tochniot/pdf/2025/heb/051211010000.pdf",
        academic_year=2025,
    )

    resolution = older.reconcile(newer)

    assert resolution.resolved_rule == newer
    assert resolution.reason == "newer_academic_year_authority"
    assert resolution.source_urls == (older.source_url, newer.source_url)


def test_claimed_year_cannot_override_the_year_encoded_by_its_source_url() -> None:
    older = CurriculumSelectionRule(
        total_track_courses=12,
        minimum_core_courses=3,
        minimum_distinct_core_tracks=3,
        advanced_labs_required=2,
        minimum_distinct_lab_tracks=2,
        labs_require_prerequisites=True,
        source_url="https://www.tau.ac.il/tochniot/pdf/2024/heb/051211010000.pdf",
        academic_year=2024,
    )
    mislabeled = CurriculumSelectionRule(
        total_track_courses=12,
        minimum_core_courses=4,
        minimum_distinct_core_tracks=4,
        advanced_labs_required=2,
        minimum_distinct_lab_tracks=2,
        labs_require_prerequisites=True,
        source_url="https://www.tau.ac.il/tochniot/pdf/2024/heb/051211010000.pdf",
        academic_year=2025,
    )

    resolution = older.reconcile(mislabeled)

    assert resolution.resolved_rule is None
    assert resolution.reason == "conflicting_authoritative_selection_rules"


def test_course_block_preserves_each_explicit_core_track_label() -> None:
    course = _course_from_block(
        "0512-4601",
        [
            (37, "0512-4601 אופן הוראה סה\"כ שעות משקל בציון"),
            (37, "מבוא ללייזרים שיעור 3 ש\"ס"),
            (37, "תרגיל 1 ש\"ס"),
            (37, "4 4"),
            (37, "• קורס ליבה מסלול אופטיקה ופוטוניקה"),
            (37, "קורס ליבה במסלול ביו אלקטורניקה"),
            (37, "דרישות קדם"),
            (37, "מבוא לפיזיקה של מוליכים למחצה )0512-2507("),
        ],
        year=3,
        semester="b",
    )

    assert course is not None
    assert course.core_track_names == ("אופטיקה ופוטוניקה", "ביו אלקטורניקה")


def test_track_memberships_come_only_from_authoritative_section_boundaries() -> None:
    memberships = parse_track_memberships(
        [
            CurriculumTextPage(
                58,
                """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
• קורס ליבה במסלול תקשורת
0512-4200 אופן הוראה סה"כ שעות משקל בציון
עיבוד אותות מתקדם שיעור 3 ש"ס
4 4
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
עיבוד אותות מתקדם שיעור 3 ש"ס
4 4
• קורס ליבה במסלול עיבוד אותות
2.6 מעבדות מתקדמות )שנים ג' - ד'(
0512-4190 מעבדה מתקדמת בתקשורת
""",
            )
        ]
    )

    assert [
        (item.course_id, item.track_name, item.is_core, item.source_pages)
        for item in memberships
    ] == [
        ("0512-4100", "תקשורת", True, (58,)),
        ("0512-4200", "תקשורת", False, (58,)),
        ("0512-4200", "עיבוד אותות", True, (58,)),
    ]


def test_advanced_lab_memberships_come_only_from_26_section_boundaries() -> None:
    memberships = parse_advanced_lab_memberships(
        [
            CurriculumTextPage(
                80,
                """
2.6.1 מעבדה מתקדמת מסלול תקשורת
0512-4190 אופן הוראה סה"כ שעות משקל בציון
מעבדה מתקדמת בתקשורת מעבדה 3 ש"ס
3 2
2.6.2 מעבדה מתקדמת במסלול התקנים וננו אלקטרוניקה
0512-4790 אופן הוראה סה"כ שעות משקל בציון
מעבדה מתקדמת בהתקנים מעבדה 3 ש"ס
3 2
2.7 קורסי שאר רוח
0512-4990 מעבדה שאינה חלק מסעיף המעבדות המתקדמות
""",
            )
        ]
    )

    assert [
        (item.course_id, item.track_name, item.source_pages)
        for item in memberships
    ] == [
        ("0512-4190", "תקשורת", (80,)),
        ("0512-4790", "התקנים וננו אלקטרוניקה", (80,)),
    ]


def test_duplicate_advanced_lab_membership_merges_source_pages() -> None:
    memberships = parse_advanced_lab_memberships(
        [
            CurriculumTextPage(
                80,
                """
2.6.1 מעבדה מתקדמת במסלול תקשורת
0512-4190 אופן הוראה סה"כ שעות משקל בציון
""",
            ),
            CurriculumTextPage(
                81,
                """
2.6.1 מעבדה מתקדמת במסלול תקשורת
0512-4190 אופן הוראה סה"כ שעות משקל בציון
2.7 קורסי שאר רוח
""",
            ),
        ]
    )

    assert memberships == (
        CurriculumAdvancedLabMembership(
            "0512-4190",
            "תקשורת",
            (80, 81),
        ),
    )


def test_conflicting_duplicate_track_membership_fails_closed() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
• קורס ליבה במסלול תקשורת
""",
        ),
        CurriculumTextPage(
            59,
            """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
2.6 מעבדות מתקדמות )שנים ג' - ד'(
""",
        ),
    ]

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Conflicting track membership for 0512-4100 in תקשורת",
    ):
        parse_track_memberships(pages)


def test_core_label_for_different_track_fails_closed() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול מערכות מחשב
0512-4100 אופן הוראה סה"כ שעות משקל בציון
ארכיטקטורת מחשבים שיעור 3 ש"ס
4 4
• קורס ליבה במסלול מחשבים
2.6 מעבדות מתקדמות )שנים ג' - ד'(
""",
        )
    ]

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Core track label mismatch for 0512-4100: section מערכות מחשב, label מחשבים",
    ):
        parse_track_memberships(pages)


def test_membership_catalog_requires_enough_distinct_core_tracks() -> None:
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
    )
    labs = (
        CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
        CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Expected at least 3 distinct core tracks, found 2",
    ):
        validate_membership_completeness(tracks, labs, rule)


def test_membership_catalog_requires_enough_distinct_lab_tracks() -> None:
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
        CurriculumTrackMembership("0512-4300", "בקרה", True, (60,)),
    )
    labs = (CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),)

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Expected at least 2 distinct lab tracks, found 1",
    ):
        validate_membership_completeness(tracks, labs, rule)


def test_membership_catalog_requires_enough_distinct_track_courses() -> None:
    rule = CurriculumSelectionRule(4, 3, 3, 2, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
        CurriculumTrackMembership("0512-4300", "בקרה", True, (60,)),
    )
    labs = (
        CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
        CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Expected at least 4 distinct track courses, found 3",
    ):
        validate_membership_completeness(tracks, labs, rule)


def test_membership_catalog_requires_enough_distinct_core_courses() -> None:
    rule = CurriculumSelectionRule(3, 3, 2, 2, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
        CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
    )
    labs = (
        CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
        CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Expected at least 3 distinct core courses, found 2",
    ):
        validate_membership_completeness(tracks, labs, rule)


def test_membership_catalog_requires_enough_distinct_advanced_labs() -> None:
    rule = CurriculumSelectionRule(3, 2, 2, 3, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
        CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
    )
    labs = (
        CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
        CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Expected at least 3 distinct advanced labs, found 2",
    ):
        validate_membership_completeness(tracks, labs, rule)


def test_membership_catalog_composes_parsers_and_completeness_gate() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול תקשורת
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול עיבוד אותות
2.5.3 מסלול בקרה
0512-4300 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול בקרה
2.6.1 מעבדה מתקדמת מסלול תקשורת
0512-4190 אופן הוראה סה"כ שעות משקל בציון
3 2
2.6.2 מעבדה מתקדמת במסלול עיבוד אותות
0512-4290 אופן הוראה סה"כ שעות משקל בציון
3 2
2.7 קורסי שאר רוח
""",
        )
    ]
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)

    catalog = parse_curriculum_membership_catalog(pages, rule)

    assert len(catalog.track_memberships) == 3
    assert len(catalog.advanced_lab_memberships) == 2


def test_membership_catalog_uses_course_track_label_for_typographic_lab_variant() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול מעגלים משולבים VLSI
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול מעגלים משולבים VLSI
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול עיבוד אותות
2.5.3 מסלול בקרה
0512-4300 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול בקרה
2.6.1 מעבדה מתקדמת במסלול מעגלים משולבים )VLSI(
0512-4190 אופן הוראה סה"כ שעות משקל בציון
3 2
2.6.2 מעבדה מתקדמת במסלול עיבוד אותות
0512-4290 אופן הוראה סה"כ שעות משקל בציון
3 2
2.7 קורסי שאר רוח
""",
        )
    ]
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)

    catalog = parse_curriculum_membership_catalog(pages, rule)

    assert catalog.advanced_lab_memberships[0].track_name == "מעגלים משולבים VLSI"


def test_membership_catalog_merges_lab_duplicates_after_label_canonicalization() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול מעגלים משולבים VLSI
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול מעגלים משולבים VLSI
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול עיבוד אותות
2.5.3 מסלול בקרה
0512-4300 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול בקרה
""",
        ),
        CurriculumTextPage(
            80,
            """
2.6.1 מעבדה מתקדמת במסלול מעגלים משולבים VLSI
0512-4190 אופן הוראה סה"כ שעות משקל בציון
""",
        ),
        CurriculumTextPage(
            81,
            """
2.6.1 מעבדה מתקדמת במסלול מעגלים משולבים )VLSI(
0512-4190 אופן הוראה סה"כ שעות משקל בציון
2.6.2 מעבדה מתקדמת במסלול עיבוד אותות
0512-4290 אופן הוראה סה"כ שעות משקל בציון
2.7 קורסי שאר רוח
""",
        ),
    ]
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)

    catalog = parse_curriculum_membership_catalog(pages, rule)

    assert catalog.advanced_lab_memberships == (
        CurriculumAdvancedLabMembership(
            "0512-4190",
            "מעגלים משולבים VLSI",
            (80, 81),
        ),
        CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
    )


def test_membership_catalog_merges_track_duplicates_after_label_canonicalization() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול מעגלים משולבים VLSI
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול מעגלים משולבים VLSI
""",
        ),
        CurriculumTextPage(
            59,
            """
2.5.1 מסלול מעגלים משולבים )VLSI(
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול מעגלים משולבים )VLSI(
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול עיבוד אותות
2.5.3 מסלול בקרה
0512-4300 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול בקרה
2.6.1 מעבדה מתקדמת במסלול מעגלים משולבים VLSI
0512-4190 אופן הוראה סה"כ שעות משקל בציון
2.6.2 מעבדה מתקדמת במסלול עיבוד אותות
0512-4290 אופן הוראה סה"כ שעות משקל בציון
2.7 קורסי שאר רוח
""",
        ),
    ]
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)

    catalog = parse_curriculum_membership_catalog(pages, rule)

    assert catalog.track_memberships[0] == CurriculumTrackMembership(
        "0512-4100",
        "מעגלים משולבים VLSI",
        True,
        (58, 59),
    )
    assert len(catalog.track_memberships) == 3


def test_membership_catalog_rejects_core_conflict_after_label_canonicalization() -> None:
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול מעגלים משולבים VLSI
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול מעגלים משולבים VLSI
""",
        ),
        CurriculumTextPage(
            59,
            """
2.5.1 מסלול מעגלים משולבים )VLSI(
0512-4100 אופן הוראה סה"כ שעות משקל בציון
4 4
2.5.2 מסלול עיבוד אותות
0512-4200 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול עיבוד אותות
2.5.3 מסלול בקרה
0512-4300 אופן הוראה סה"כ שעות משקל בציון
4 4
• קורס ליבה במסלול בקרה
2.6.1 מעבדה מתקדמת במסלול מעגלים משולבים VLSI
0512-4190 אופן הוראה סה"כ שעות משקל בציון
2.6.2 מעבדה מתקדמת במסלול עיבוד אותות
0512-4290 אופן הוראה סה"כ שעות משקל בציון
2.7 קורסי שאר רוח
""",
        ),
    ]
    rule = CurriculumSelectionRule(3, 2, 2, 2, 2, True)

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Conflicting canonical track membership for 0512-4100 in מעגלים משולבים VLSI",
    ):
        parse_curriculum_membership_catalog(pages, rule)


def test_track_label_normalization_is_typographic_only() -> None:
    assert normalize_track_label("מעגלים משולבים )VLSI )") == normalize_track_label(
        "מעגלים משולבים VLSI"
    )
    assert normalize_track_label("ביו - אלקטרוניקה") == normalize_track_label(
        "ביו אלקטרוניקה"
    )
    assert normalize_track_label("מערכות מחשב") != normalize_track_label("מחשבים")


def test_unknown_advanced_lab_track_fails_closed() -> None:
    rule = CurriculumSelectionRule(3, 3, 3, 2, 2, True)
    tracks = (
        CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
        CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
        CurriculumTrackMembership("0512-4300", "בקרה", True, (60,)),
    )
    labs = (
        CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
        CurriculumAdvancedLabMembership("0512-4990", "מסלול לא מוכר", (81,)),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Advanced lab track has no course-track section: מסלול לא מוכר",
    ):
        validate_membership_completeness(tracks, labs, rule)


def _program_source_document(
    unresolved: tuple[curriculum_document.UnresolvedCurriculumFact, ...] = (),
) -> curriculum_document.ParsedCurriculumDocument:
    return curriculum_document.ParsedCurriculumDocument(
        identity=curriculum_document.CurriculumIdentity(
            program_code="0512-11-01-0000",
            program_title_he="הנדסת חשמל",
            degree_name="בוגר אוניברסיטה",
            academic_year_he='תשפ"ה',
            printed_on="01/01/25",
            source_url="https://www.tau.ac.il/tochniot/pdf/2025/heb/051211010000.pdf",
        ),
        total_required_hours=179,
        structure=(),
        selection_rule=CurriculumSelectionRule(3, 2, 2, 2, 2, True),
        mandatory_courses=(),
        unresolved=unresolved,
    )


def _parsed_catalog_courses(
    *course_ids: str,
) -> curriculum_document.ParsedCurriculumCatalogCourses:
    return curriculum_document.ParsedCurriculumCatalogCourses(
        tuple(
            curriculum_document.CurriculumCatalogCourse(
                course_id=course_id,
                name_he=course_id,
                weekly_hours=4,
                credit_hours=4,
                prerequisite_course_ids=(),
                concurrent_course_ids=(),
                source_pages=(58,),
            )
            for course_id in course_ids
        ),
        (),
    )


def test_program_source_model_rejects_unresolved_curriculum_facts() -> None:
    materialize = getattr(curriculum_document, "materialize_program_source_model", None)
    assert materialize is not None
    document = _program_source_document(
        (
            curriculum_document.UnresolvedCurriculumFact(
                "0512-1000",
                "conflicting_authoritative_course_facts",
                (12, 13),
            ),
        )
    )
    catalog = CurriculumMembershipCatalog((), ())

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Cannot materialize program source model with unresolved facts: 0512-1000",
    ):
        materialize(
            document,
            catalog,
            curriculum_document.ParsedCurriculumCatalogCourses((), ()),
        )


def test_program_source_model_preserves_validated_document_and_memberships() -> None:
    materialize = getattr(curriculum_document, "materialize_program_source_model", None)
    assert materialize is not None
    document = _program_source_document()
    catalog = CurriculumMembershipCatalog(
        (
            CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
            CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
        ),
        (
            CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
            CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
        ),
    )

    model = materialize(
        document,
        catalog,
        _parsed_catalog_courses(
            "0512-4100",
            "0512-4190",
            "0512-4200",
            "0512-4290",
            "0512-4300",
        ),
    )

    assert model.identity == document.identity
    assert model.selection_rule == document.selection_rule
    assert model.track_memberships == catalog.track_memberships
    assert model.advanced_lab_memberships == catalog.advanced_lab_memberships


def test_program_source_model_preserves_validated_catalog_courses() -> None:
    materialize = getattr(curriculum_document, "materialize_program_source_model", None)
    assert materialize is not None
    document = _program_source_document()
    memberships = CurriculumMembershipCatalog(
        (
            CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
            CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
        ),
        (
            CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
            CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
        ),
    )
    catalog_courses = _parsed_catalog_courses(
        "0512-4100",
        "0512-4190",
        "0512-4200",
        "0512-4290",
        "0512-4300",
    )

    model = materialize(document, memberships, catalog_courses)

    assert model.catalog_courses == catalog_courses.courses


def test_program_source_model_rejects_unresolved_catalog_courses() -> None:
    materialize = getattr(curriculum_document, "materialize_program_source_model", None)
    assert materialize is not None
    document = _program_source_document()
    memberships = CurriculumMembershipCatalog(
        (
            CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
            CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
        ),
        (
            CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
            CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
        ),
    )
    catalog_courses = curriculum_document.ParsedCurriculumCatalogCourses(
        (),
        (
            curriculum_document.UnresolvedCurriculumFact(
                "0512-4100",
                "conflicting_authoritative_catalog_course_facts",
                (58, 59),
            ),
        ),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match="Cannot materialize program source model with unresolved catalog courses: 0512-4100",
    ):
        materialize(document, memberships, catalog_courses)


def test_program_source_model_rejects_memberships_without_catalog_facts() -> None:
    materialize = getattr(curriculum_document, "materialize_program_source_model", None)
    assert materialize is not None
    document = _program_source_document()
    memberships = CurriculumMembershipCatalog(
        (
            CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
            CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
        ),
        (
            CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
            CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
        ),
    )

    with pytest.raises(
        CurriculumSourceMismatch,
        match=(
            "Cannot materialize program source model without catalog facts for: "
            "0512-4100, 0512-4190, 0512-4200, 0512-4290, 0512-4300"
        ),
    ):
        materialize(
            document,
            memberships,
            curriculum_document.ParsedCurriculumCatalogCourses((), ()),
        )


def test_planner_requirements_preserve_cross_track_selection_semantics() -> None:
    materialize_requirements = getattr(
        curriculum_document,
        "materialize_planner_requirements",
        None,
    )
    assert materialize_requirements is not None
    document = _program_source_document()
    model = curriculum_document.CurriculumProgramSourceModel(
        identity=document.identity,
        total_required_hours=document.total_required_hours,
        structure=document.structure,
        selection_rule=document.selection_rule,
        mandatory_courses=(),
        track_memberships=(
            CurriculumTrackMembership("0512-4100", "תקשורת", True, (58,)),
            CurriculumTrackMembership("0512-4100", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4200", "עיבוד אותות", True, (59,)),
            CurriculumTrackMembership("0512-4300", "בקרה", False, (60,)),
        ),
        advanced_lab_memberships=(
            CurriculumAdvancedLabMembership("0512-4190", "תקשורת", (80,)),
            CurriculumAdvancedLabMembership("0512-4290", "עיבוד אותות", (81,)),
        ),
        catalog_courses=(),
    )

    requirements = materialize_requirements(model)

    assert requirements.total_required_hours == 179
    assert requirements.total_track_courses == 3
    assert requirements.minimum_core_courses == 2
    assert requirements.minimum_distinct_core_tracks == 2
    assert requirements.advanced_labs_required == 2
    assert requirements.minimum_distinct_lab_tracks == 2
    assert requirements.track_categories == (
        curriculum_document.CurriculumPlannerTrackCategory(
            "בקרה", ("0512-4300",), (),
        ),
        curriculum_document.CurriculumPlannerTrackCategory(
            "עיבוד אותות", ("0512-4100", "0512-4200"), ("0512-4100", "0512-4200"),
        ),
        curriculum_document.CurriculumPlannerTrackCategory(
            "תקשורת", ("0512-4100",), ("0512-4100",),
        ),
    )
    assert requirements.advanced_lab_categories == (
        curriculum_document.CurriculumPlannerLabCategory(
            "עיבוד אותות", ("0512-4290",),
        ),
        curriculum_document.CurriculumPlannerLabCategory(
            "תקשורת", ("0512-4190",),
        ),
    )


def test_cross_track_validator_does_not_count_one_course_as_two_tracks() -> None:
    validate = getattr(program_requirements, "validate_cross_track_requirements", None)
    assert validate is not None
    requirements = curriculum_document.CurriculumPlannerRequirements(
        total_required_hours=179,
        mandatory_course_ids=(),
        total_track_courses=1,
        minimum_core_courses=1,
        minimum_distinct_core_tracks=2,
        track_categories=(
            curriculum_document.CurriculumPlannerTrackCategory(
                "עיבוד אותות", ("0512-4100",), ("0512-4100",),
            ),
            curriculum_document.CurriculumPlannerTrackCategory(
                "תקשורת", ("0512-4100",), ("0512-4100",),
            ),
        ),
        advanced_labs_required=0,
        minimum_distinct_lab_tracks=0,
        advanced_lab_categories=(),
        labs_require_prerequisites=True,
    )

    result = validate(("0512-4100",), requirements)

    assert result.selected_core_courses == 1
    assert result.distinct_core_tracks == 1
    assert not result.valid


def test_catalog_course_facts_merge_identical_cross_track_occurrences() -> None:
    parse_catalog_courses = getattr(curriculum_document, "parse_catalog_courses", None)
    assert parse_catalog_courses is not None
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
• קורס ליבה במסלול תקשורת
דרישות קדם
0512-2100 מבוא לתקשורת
""",
        ),
        CurriculumTextPage(
            59,
            """
2.5.2 מסלול עיבוד אותות
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
• קורס ליבה במסלול עיבוד אותות
דרישות קדם
0512-2100 מבוא לתקשורת
2.6 מעבדות מתקדמות
""",
        ),
    ]

    parsed = parse_catalog_courses(pages)

    assert parsed.unresolved == ()
    assert parsed.courses == (
        curriculum_document.CurriculumCatalogCourse(
            course_id="0512-4100",
            name_he="תקשורת ספרתית",
            weekly_hours=4,
            credit_hours=4,
            prerequisite_course_ids=("0512-2100",),
            concurrent_course_ids=(),
            source_pages=(58, 59),
        ),
    )


def test_catalog_course_facts_retain_conflicting_occurrences_as_unresolved() -> None:
    parse_catalog_courses = getattr(curriculum_document, "parse_catalog_courses", None)
    assert parse_catalog_courses is not None
    pages = [
        CurriculumTextPage(
            58,
            """
2.5.1 מסלול תקשורת
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
4 4
""",
        ),
        CurriculumTextPage(
            59,
            """
2.5.2 מסלול עיבוד אותות
0512-4100 אופן הוראה סה"כ שעות משקל בציון
תקשורת ספרתית שיעור 3 ש"ס
3 3
2.6 מעבדות מתקדמות
""",
        ),
    ]

    parsed = parse_catalog_courses(pages)

    assert parsed.courses == ()
    assert parsed.unresolved == (
        curriculum_document.UnresolvedCurriculumFact(
            course_id="0512-4100",
            reason="conflicting_authoritative_catalog_course_facts",
            source_pages=(58, 59),
        ),
    )
