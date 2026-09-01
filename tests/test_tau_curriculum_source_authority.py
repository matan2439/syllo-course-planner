import pytest

from app.parsing.tau_curriculum_document import (
    CurriculumAdvancedLabMembership,
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


def test_membership_catalog_requires_enough_distinct_core_tracks() -> None:
    rule = CurriculumSelectionRule(12, 3, 3, 2, 2, True)
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
    rule = CurriculumSelectionRule(12, 3, 3, 2, 2, True)
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
    rule = CurriculumSelectionRule(12, 3, 3, 2, 2, True)

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
    rule = CurriculumSelectionRule(12, 3, 3, 2, 2, True)

    catalog = parse_curriculum_membership_catalog(pages, rule)

    assert catalog.advanced_lab_memberships[0].track_name == "מעגלים משולבים VLSI"


def test_track_label_normalization_is_typographic_only() -> None:
    assert normalize_track_label("מעגלים משולבים )VLSI )") == normalize_track_label(
        "מעגלים משולבים VLSI"
    )
    assert normalize_track_label("ביו - אלקטרוניקה") == normalize_track_label(
        "ביו אלקטרוניקה"
    )
    assert normalize_track_label("מערכות מחשב") != normalize_track_label("מחשבים")


def test_unknown_advanced_lab_track_fails_closed() -> None:
    rule = CurriculumSelectionRule(12, 3, 3, 2, 2, True)
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
