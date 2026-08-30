from app.parsing.tau_curriculum_document import (
    CurriculumSelectionRule,
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
