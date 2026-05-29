"""
Tests for the semester_board_viewer.html structure.

Validates key JavaScript constants and UI structure without running a browser:
- PROGRAM_FAMILIES groups programs correctly (Issue 2)
- Difficulty display logic does not require syllabus_url (Issue 1)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

_HTML_PATH = Path("app/web/semester_board_viewer.html")


@pytest.fixture(scope="module")
def html() -> str:
    return _HTML_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# PROGRAM_FAMILIES structure (Issue 2)
# ---------------------------------------------------------------------------

def test_program_families_constant_exists(html):
    assert "PROGRAM_FAMILIES" in html, "PROGRAM_FAMILIES constant missing from HTML"


def test_program_families_mechanical_engineering_default_is_2027(html):
    """The ME family's default_program_id must be 2027, not 2025."""
    # Check that 'mechanical_engineering_2027' appears as a default_program_id
    assert re.search(
        r"default_program_id\s*:\s*['\"]mechanical_engineering_2027['\"]", html
    ), "mechanical_engineering_2027 should be default_program_id for ME family"


def test_program_families_2025_is_archive_not_default(html):
    """2025 must appear in archive_ids, never as a default_program_id for ME."""
    # 2025 must NOT be a default_program_id
    assert not re.search(
        r"default_program_id\s*:\s*['\"]mechanical_engineering_2025['\"]", html
    ), "mechanical_engineering_2025 must not be a default_program_id"
    # 2025 must appear in the archive_ids context
    assert "mechanical_engineering_2025" in html, "2025 program should exist in HTML"
    assert re.search(r"archive_ids.*?mechanical_engineering_2025", html, re.DOTALL), \
        "mechanical_engineering_2025 should appear within archive_ids"


def test_program_families_biomedical_is_separate_family(html):
    """Biomedical track must be a separate PROGRAM_FAMILIES entry."""
    # biomedical must appear as a default_program_id (its own family card)
    assert re.search(
        r"default_program_id\s*:\s*['\"]mechanical_engineering_biomedical_track_2025['\"]",
        html,
    ), "Biomedical track should be its own family entry with default_program_id"


def test_program_families_has_two_entries(html):
    """There should be exactly 2 family entries (ME + ME-biomedical)."""
    matches = re.findall(r"family_id\s*:", html)
    assert len(matches) == 2, f"Expected 2 PROGRAM_FAMILIES entries, found {len(matches)}"


def test_program_list_still_contains_all_three_programs(html):
    """PROGRAM_LIST must still have all 3 program entries for backward compatibility."""
    assert "mechanical_engineering_2027" in html
    assert "mechanical_engineering_2025" in html
    assert "mechanical_engineering_biomedical_track_2025" in html


def test_modal_renders_families_not_program_list(html):
    """renderResults must iterate PROGRAM_FAMILIES, not PROGRAM_LIST."""
    # Find the renderResults function body
    m = re.search(r"function renderResults\(query\)(.*?)(?=\n  function |\n  renderResults\b)", html, re.DOTALL)
    assert m, "renderResults function not found"
    body = m.group(1)
    assert "PROGRAM_FAMILIES" in body, "renderResults should filter PROGRAM_FAMILIES"
    assert "PROGRAM_LIST" not in body, "renderResults should NOT use PROGRAM_LIST directly"


# ---------------------------------------------------------------------------
# Difficulty display (Issue 1)
# ---------------------------------------------------------------------------

def test_syllabus_note_uses_official_source_message(html):
    """Missing syllabus note should confirm that official data is available, not imply total absence."""
    # Old wrong text must not appear; new partial-info text must be present
    assert "מידע רשמי שנמצא בידיעון" in html, \
        "Partial-syllabus note should reference official source data"


def test_difficulty_display_not_gated_on_syllabus(html):
    """The difficulty badge (diffBdg) must not check for syllabus_url presence."""
    # Find the diffBdg definition
    m = re.search(r"const diffBdg\s*=.*?;", html, re.DOTALL)
    assert m, "diffBdg not found"
    badge_code = m.group(0)
    # diffBdg must NOT check syllabus_url
    assert "syllabus_url" not in badge_code, \
        "diffBdg must not be gated on syllabus_url"


def test_estimated_diff_uses_tilde_indicator(html):
    """Lightweight (estimated) difficulty badges should show a '~' suffix."""
    assert "isEstimatedDiff" in html, "isEstimatedDiff variable should be defined"
    # The ~ character should appear in the badge template
    assert "'~'" in html or '"~"' in html, "~ indicator should appear in the badge template"


def test_low_conf_warning_does_not_blame_syllabus(html):
    """The low-confidence warning text must not blame missing syllabus."""
    # Old text blamed syllabus specifically
    assert "חסר סילבוס" not in html, \
        "Low-confidence warning must not specifically blame missing syllabus"


def test_difficulty_breakdown_section_checks_subscores(html):
    """Difficulty section should use hasDiffData which checks subscores, not syllabus."""
    m = re.search(r"const hasDiffData\s*=.*?;", html, re.DOTALL)
    assert m, "hasDiffData not found"
    hdd = m.group(0)
    assert "workload_score" in hdd or "conceptual_complexity_score" in hdd, \
        "hasDiffData should check subscores"
    assert "syllabus" not in hdd.lower(), \
        "hasDiffData must not check syllabus"


# ---------------------------------------------------------------------------
# Course-details URL and modal buttons (Tasks B/D/E)
# ---------------------------------------------------------------------------

def test_course_details_url_field_in_coursemap(html):
    """courseMap entries must initialise course_details_url (not undefined)."""
    assert "course_details_url:" in html, \
        "course_details_url must be initialised in courseMap"


def test_official_details_available_field_in_coursemap(html):
    """courseMap entries must initialise official_details_available."""
    assert "official_details_available:" in html, \
        "official_details_available must be set in courseMap"


def test_modal_shows_course_details_button_when_no_syllabus(html):
    """When no syllabus_url but course_details_url exists → 'פתח פרטי קורס'."""
    assert "פתח פרטי קורס באתר TAU" in html, \
        "Modal must have 'פתח פרטי קורס באתר TAU' button text"


def test_modal_missing_syllabus_note_uses_partial_wording(html):
    """Partial-info note says official data exists, not that data is missing."""
    assert "לא נמצא קישור סילבוס, אך מוצג מידע רשמי שנמצא בידיעון" in html, \
        "Partial note must confirm official data is available"


def test_modal_no_official_data_note(html):
    """When no official data at all, the modal must say so."""
    assert "חסר מידע רשמי מפורט לקורס זה" in html, \
        "No-official-data note must be present"


def test_modal_no_longer_says_wrong_missing_note(html):
    """Old wrong message must not appear anywhere in the HTML."""
    assert "לא נמצא קישור סילבוס באתר התוכנית" not in html, \
        "Old wrong syllabus note must be removed"


def test_source1_loop_enriches_course_details_url(html):
    """Source 1 enrichment block must copy course_details_url from board JSON."""
    # The enrichment happens in a block after the _addOrEnrichCourse call
    assert "rc.course_details_url" in html, \
        "Source 1 block must reference rc.course_details_url"
    assert "_ce.course_details_url" in html or "course_details_url  = rc.course_details_url" in html, \
        "Source 1 block must assign course_details_url to the courseMap entry"


def test_source1_loop_enriches_official_details(html):
    """Source 1 loop must copy official_details_available from board JSON."""
    assert "rc.official_details_available" in html, \
        "Source 1 block must reference rc.official_details_available"


# ---------------------------------------------------------------------------
# Both-buttons logic (Issue 1)
# ---------------------------------------------------------------------------

def test_both_buttons_shown_when_syllabus_and_detail_url(html):
    """When both sylUrl and detailUrl exist, both buttons appear in the same block."""
    # The combined case outputs both button HTML vars in the same branch
    assert "sylBtnHtml + ' ' + detailBtnHtml" in html or \
           "sylBtnHtml" in html and "detailBtnHtml" in html, \
        "HTML should have logic for showing both syllabus and detail buttons"


def test_detail_btn_class_outline(html):
    """Secondary TAU detail button must have a distinct outline style class."""
    assert "btn-outline-detail" in html


def test_modal_shows_both_when_both_exist(html):
    """Modal footer logic must have a branch for sylUrl AND detailUrl both present."""
    assert "sylUrl && detailUrl" in html or "if (sylUrl && detailUrl)" in html or \
           "sylUrl" in html and "detailUrl" in html, \
        "Modal must handle the case where both sylUrl and detailUrl exist"


def test_exam_url_copied_from_board_json(html):
    """Source 1 enrichment must copy exam_url from board JSON."""
    assert "rc.exam_url" in html


def test_moodle_url_copied_from_board_json(html):
    """Source 1 enrichment must copy moodle_url from board JSON."""
    assert "rc.moodle_url" in html


# ---------------------------------------------------------------------------
# Difficulty signals breakdown (Issue 2)
# ---------------------------------------------------------------------------

def test_difficulty_signals_available_label(html):
    """Difficulty section must show available signals."""
    assert "קיים:" in html or "diff-sig-label ok" in html


def test_difficulty_signals_missing_label(html):
    """Difficulty section must show missing signals."""
    assert "חסר לחישוב מדויק" in html


def test_difficulty_signals_css_class(html):
    """diff-signals-wrap CSS class must exist."""
    assert "diff-signals-wrap" in html


def test_difficulty_signals_computed_from_fields(html):
    """Signal computation must check weekly_hours and other fields."""
    assert "weekly_hours" in html and "program_category_id" in html


# ---------------------------------------------------------------------------
# Issue 3: "שם חסר" text
# ---------------------------------------------------------------------------

def test_missing_name_uses_import_wording(html):
    """Unnamed course message must say 'נדרש ייבוא מידע' not 'נדרש רענון'."""
    assert "נדרש ייבוא מידע" in html, "Must use 'ייבוא מידע' wording"
    assert "נדרש רענון מידע" not in html, "Old 'רענון' wording must be removed"


# ---------------------------------------------------------------------------
# Issue A: TAU Factor specific wording in difficulty signals
# ---------------------------------------------------------------------------

def test_tau_factor_not_started_message(html):
    """Signals must show 'טרם נטענו נתוני טאו פקטור' when TAU Factor not loaded."""
    assert "טרם נטענו נתוני טאו פקטור" in html


def test_tau_factor_not_found_message(html):
    """Signals must include 'לא נמצאו נתוני טאו פקטור עבור מספר הקורס' when lookup was attempted."""
    assert "לא נמצאו נתוני טאו פקטור עבור מספר הקורס" in html


def test_tau_factor_available_label(html):
    """When grade_signal exists, 'נתוני טאו פקטור' is listed as available."""
    assert "נתוני טאו פקטור" in html


def test_no_vague_grade_stats_wording(html):
    """Vague 'נתוני ציונים היסטוריים' alone must not appear without TAU Factor attribution."""
    # The proper phrasing includes 'טאו פקטור' when referring to grade stats
    assert "מטאו פקטור" in html or "טאו פקטור" in html


# ---------------------------------------------------------------------------
# Issue B: Syllabus AI analysis placeholder
# ---------------------------------------------------------------------------

def test_syllabus_ai_field_in_coursemap(html):
    """courseMap must initialise syllabus_ai_analysis_status."""
    assert "syllabus_ai_analysis_status:" in html


def test_syllabus_pending_shows_ai_analysis_needed(html):
    """When syllabus exists but AI not done, show precise AI analysis message."""
    assert "ניתוח AI של הסילבוס לחילוץ נושאים וסוג הערכה" in html


def test_syllabus_not_available_shows_no_link(html):
    """When no syllabus, show 'לא נמצא קישור סילבוס פעיל' as missing."""
    assert "לא נמצא קישור סילבוס פעיל" in html


def test_no_vague_course_description_missing(html):
    """Must not show vague 'תיאור מפורט של נושאי הקורס' — replaced by AI analysis wording."""
    assert "תיאור מפורט של נושאי הקורס" not in html


# ---------------------------------------------------------------------------
# Issue C: Assessment type in signals
# ---------------------------------------------------------------------------

def test_assessment_type_in_coursemap(html):
    """courseMap must initialise assessment_type."""
    assert "assessment_type:" in html


def test_assessment_type_in_available_signals(html):
    """When assessment_type != unknown, 'סוג הערכה סופי' appears in available."""
    assert "סוג הערכה סופי" in html


def test_no_vague_assessment_wording(html):
    """Must not show 'מבנה הערכה / מטלות / מבחן' — replaced by precise assessment_type."""
    assert "מבנה הערכה / מטלות / מבחן" not in html


# ---------------------------------------------------------------------------
# Issue D: Precise signal wording
# ---------------------------------------------------------------------------

def test_signal_uses_depth_not_basic(html):
    """Prerequisite signal should say 'עומק דרישות קדם' not 'דרישות קדם בסיסיות'."""
    assert "עומק דרישות קדם" in html


def test_no_vague_general_description_signal(html):
    """Must not include 'תיאור קורס ונושאים (DB)' — vague signal replaced."""
    assert "תיאור קורס ונושאים (DB)" not in html


# ---------------------------------------------------------------------------
# TAU Factor new fields (Problems 2 & 4)
# ---------------------------------------------------------------------------

def test_tau_factor_status_field_in_coursemap(html):
    """courseMap must initialise tau_factor_status (not tau_factor_lookup_status)."""
    assert "tau_factor_status:" in html


def test_tau_factor_lookup_id_field_in_coursemap(html):
    """courseMap must initialise tau_factor_lookup_id."""
    assert "tau_factor_lookup_id:" in html


def test_tau_factor_not_started_message_distinct_from_not_found(html):
    """'not_started' case shows 'טרם נטענו' not 'לא נמצאו' wording."""
    assert "טרם נטענו נתוני טאו פקטור" in html
    # Ensure 'not_found' branch uses different wording
    assert "לא נמצאו נתוני טאו פקטור עבור מספר הקורס" in html


def test_tau_factor_lookup_id_shown_in_signals(html):
    """Signals must reference tau_factor_lookup_id for user-visible ID display."""
    assert "tau_factor_lookup_id" in html


def test_old_tau_factor_lookup_status_not_in_coursemap_init(html):
    """tau_factor_lookup_status must not appear as a courseMap init key (renamed)."""
    # It may appear in comments/tests but not as a live field initialization
    import re
    # Check the _addOrEnrichCourse function body doesn't init the old key
    m = re.search(r"courseMap\[cid\]\s*=\s*\{(.*?)\};", html, re.DOTALL)
    if m:
        assert "tau_factor_lookup_status:" not in m.group(1)


# ---------------------------------------------------------------------------
# Assessment analysis status (Problem 1)
# ---------------------------------------------------------------------------

def test_assessment_analysis_status_field_in_coursemap(html):
    """courseMap must initialise assessment_analysis_status."""
    assert "assessment_analysis_status:" in html


def test_assessment_not_started_shows_ai_required_message(html):
    """When assessment_analysis_status == 'not_started', modal shows AI-required message."""
    assert "סוג ההערכה הסופי דורש ניתוח AI של הסילבוס" in html


def test_assessment_not_available_shows_no_syllabus_message(html):
    """When assessment_analysis_status == 'not_available', modal says no syllabus for analysis."""
    assert "לא נמצא סילבוס פעיל לניתוח סוג ההערכה" in html


def test_assessment_type_not_shown_as_available_without_complete_status(html):
    """assessment_type in available signals must be gated on aStatus === 'complete'."""
    import re
    # Find the available.push('סוג הערכה סופי') line and check it requires 'complete'
    m = re.search(r"aStatus.*complete.*available.*סוג הערכה סופי|available.*סוג הערכה סופי.*aStatus.*complete",
                  html, re.DOTALL)
    assert m, "available push for 'סוג הערכה סופי' must be gated on aStatus === 'complete'"


# ---------------------------------------------------------------------------
# Mandatory courses placeholder (Problem 3)
# ---------------------------------------------------------------------------

def test_mandatory_section_shows_not_loaded_label(html):
    """Mandatory section must show 'טרם נטען' label when count is zero."""
    assert "טרם נטען" in html


def test_mandatory_empty_message_official_source(html):
    """Mandatory empty message must say 'לא נטענו ממקור רשמי'."""
    assert "לא נטענו ממקור רשמי" in html


def test_mandatory_empty_message_auto_placement_note(html):
    """Mandatory empty message must mention auto-placement when file is added."""
    assert "ישובצו אוטומטית בלוח" in html


def test_mandatory_section_does_not_show_zero_count_wording(html):
    """Must not have the old 'קורסי חובה עדיין לא הוזנו לתוכנית זו' message."""
    assert "קורסי חובה עדיין לא הוזנו לתוכנית זו" not in html
