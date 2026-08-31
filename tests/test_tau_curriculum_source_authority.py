from app.parsing.tau_curriculum_document import (
    CurriculumSelectionRule,
    CurriculumTextPage,
    _course_from_block,
    parse_track_memberships,
    restore_rtl_pdf_line,
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
