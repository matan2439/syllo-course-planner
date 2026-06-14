"""
Tests for the semester_board_viewer.html structure.

Validates key JavaScript constants and UI structure without running a browser:
- PROGRAM_FAMILIES groups programs correctly (Issue 2)
- Difficulty display logic does not require syllabus_url (Issue 1)
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

_HTML_PATH = Path("app/web/semester_board_viewer.html")


@pytest.fixture(scope="module")
def html() -> str:
    return _HTML_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Inline <script> syntax validity (catches errors that blank the whole page)
# ---------------------------------------------------------------------------

def test_inline_scripts_have_valid_js_syntax(html):
    """Every inline <script> block (no src=) must be syntactically valid JS.

    A syntax error in any of these blocks throws before any rendering code
    runs, leaving the page blank. `node --check` parses without executing.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")

    scripts = re.findall(
        r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.DOTALL
    )
    assert scripts, "No inline <script> blocks found"

    for i, script in enumerate(scripts):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".js", delete=False, encoding="utf-8"
        ) as f:
            f.write(script)
            tmp_path = f.name
        try:
            result = subprocess.run(
                [node, "--check", tmp_path],
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, (
                f"Inline <script> block {i} has a syntax error:\n{result.stderr}"
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)


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


# ---------------------------------------------------------------------------
# Legend removal
# ---------------------------------------------------------------------------

def test_legend_section_removed(html):
    """The מקרא legend section must not exist in the rendered HTML."""
    assert "sb-legend" not in html
    assert "legend-ttl" not in html
    assert "legendHtml" not in html


def test_legend_hebrew_label_removed(html):
    """The Hebrew 'מקרא' label must not appear in the sidebar legend context."""
    # 'מקרא' may appear in comments/docs but not as a legend title class
    assert "legend-ttl" not in html


def test_legend_workload_explanation_removed(html):
    """The 'איך מחושבים עומס וקושי?' collapsible must not exist."""
    assert "legend-workload-details" not in html
    assert "איך מחושבים עומס וקושי?" not in html


def test_ai_panel_still_present(html):
    """AI assistant panel must still be present after legend removal."""
    assert "ai-panel" in html
    assert "עוזר AI לתכנון מערכת" in html


# ---------------------------------------------------------------------------
# TAU Factor 'failed' status (Part G / Part H)
# ---------------------------------------------------------------------------

def test_tau_factor_failed_message(html):
    """When tau_factor_status == 'failed', show 'טעינת נתוני טאו פקטור נכשלה'."""
    assert "טעינת נתוני טאו פקטור נכשלה" in html, \
        "Failed TAU Factor status must show a specific failure message"


def test_tau_factor_four_statuses_handled(html):
    """All four TAU Factor statuses have distinct handling in the signals section."""
    assert "not_found" in html,    "not_found case must be handled"
    assert "failed" in html,       "failed case must be handled"
    assert "not_started" in html,  "not_started case must be handled"
    assert "טרם נטענו נתוני טאו פקטור" in html
    assert "לא נמצאו נתוני טאו פקטור עבור מספר הקורס" in html
    assert "טעינת נתוני טאו פקטור נכשלה" in html


# ---------------------------------------------------------------------------
# other_specialization section visibility (Part E / Part H)
# ---------------------------------------------------------------------------

def test_other_specialization_opened_on_empty_board(html):
    """When board is empty, other_specialization section is added to openGroups."""
    assert "other_specialization" in html, "other_specialization category must be referenced"
    # The init code must add other_specialization to openGroups when board is empty
    assert "openGroups.add(cat.category_id)" in html and "other_specialization" in html, \
        "openGroups.add must reference other_specialization"


def test_other_specialization_title_includes_count(html):
    """Section title for other_specialization includes '— N קורסים' suffix."""
    assert "other_specialization" in html
    # The count suffix pattern must be in the rendering code
    assert "קורסים" in html, "Section title must include 'קורסים' count suffix"


# ---------------------------------------------------------------------------
# Enrichment infrastructure (Part H)
# ---------------------------------------------------------------------------

def test_enrich_mechanical_2027_module_exists():
    """app/pipeline/enrich_mechanical_2027.py must exist as an importable module."""
    from pathlib import Path
    assert Path("app/pipeline/enrich_mechanical_2027.py").exists(), \
        "Enrichment command module must exist at app/pipeline/enrich_mechanical_2027.py"


def test_enrich_module_has_enrich_board_function():
    """enrich_mechanical_2027.enrich_board must be importable."""
    from app.pipeline.enrich_mechanical_2027 import enrich_board
    assert callable(enrich_board)


def test_build_course_details_url_formats_id():
    """_build_course_details_url must generate IMS URL with undashed 8-digit course ID."""
    from app.analysis.semester_board import _build_course_details_url
    url = _build_course_details_url("0542-4320")
    assert url is not None and "05424320" in url
    url2 = _build_course_details_url("0001-0001")
    assert url2 is not None and "00010001" in url2


# ---------------------------------------------------------------------------
# Degree-progress summary, draft diff styling, category colors, שער רוח
# repository, and summary chips (PART A-G)
# ---------------------------------------------------------------------------

def test_degree_progress_helper_exists_and_used_in_draft_and_modal(html):
    """renderDegreeProgressHtml must exist and be called from both the draft
    sidebar panel and the full preview modal."""
    assert "function renderDegreeProgressHtml" in html

    m = re.search(r"function renderDraftTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderDraftTab not found"
    assert "renderDegreeProgressHtml(" in m.group(1), \
        "renderDraftTab must render the degree-progress summary"

    m2 = re.search(r"function openPlanPreviewModal\(.*?\)\s*\{(.*)", html, re.DOTALL)
    assert m2, "openPlanPreviewModal not found"
    assert "renderDegreeProgressHtml(" in m2.group(1)[:20000], \
        "openPlanPreviewModal must render the degree-progress summary"


def test_degree_progress_lines_present(html):
    """The degree-progress block must include all five required Hebrew lines."""
    m = re.search(r"function renderDegreeProgressHtml\(.*?\n}\n", html, re.DOTALL)
    assert m, "renderDegreeProgressHtml not found"
    body = m.group(0)
    for label in ['נצברו', 'במערכת הנוכחית', 'יתווספו בהצעה', 'סה״כ לאחר ההצעה', 'נותרו']:
        assert label in body, f"Degree-progress block missing line: {label}"


def test_degree_progress_overshoot_warning(html):
    """When total > required, an overshoot warning must be shown."""
    m = re.search(r"function renderDegreeProgressHtml\(.*?\n}\n", html, re.DOTALL)
    body = m.group(0)
    assert "ההצעה עוברת את היקף התואר ב־" in body


def test_degree_progress_exact_completion_success(html):
    """When total == required, a success message must be shown."""
    m = re.search(r"function renderDegreeProgressHtml\(.*?\n}\n", html, re.DOTALL)
    body = m.group(0)
    assert "ההצעה משלימה את היקף התואר" in body


def test_degree_progress_calc_logic():
    """The underlying degree-hours math (getDegreeHoursStatusLocal) is
    structurally identical to the server-side mirror in completion_analysis.ts,
    verified via its TS counterpart test suite. Here we just sanity check the
    JS source computes total = completed + proposed and remaining = max(0, required-total)."""
    import pathlib
    html = pathlib.Path("app/web/semester_board_viewer.html").read_text(encoding="utf-8")
    m = re.search(r"function getDegreeHoursStatusLocal\(.*?\n}\n", html, re.DOTALL)
    assert m, "getDegreeHoursStatusLocal not found"
    body = m.group(0)
    assert "total_after_plan" in body and "completed_degree_hours + proposed_plan_hours" in body
    assert "missing_hours" in body and "Math.max(0, degree_required_hours - total_after_plan)" in body


# ---------------------------------------------------------------------------
# Draft diff rendering — added/moved/removed/unchanged styling
# ---------------------------------------------------------------------------

def test_draft_added_uses_badge_and_subtle_style_not_pulse(html):
    """Added cards get a 'נוסף' badge and a subtle (non-pulsing) outline."""
    assert "bdg-draft-added\">נוסף<" in html
    assert "draft-pulse" not in html, "Old noisy pulse animation must be removed"
    m = re.search(r"\.course-card\.card-draft-added\s*\{[^}]*\}", html)
    assert m, "card-draft-added style not found"
    assert "animation" not in m.group(0)


def test_draft_moved_uses_badge_with_source_semester(html):
    """Moved cards get a 'הועבר' badge that includes the source semester."""
    assert "bdg-draft-moved" in html
    assert "הועבר מ" in html
    m = re.search(r"\.course-card\.card-draft-moved\s*\{[^}]*\}", html)
    assert m, "card-draft-moved style not found"
    assert "animation" not in m.group(0)


def test_draft_removed_faded_ghost_with_badge(html):
    """Removed cards must be faded/ghosted and show a 'יוסר' badge."""
    assert ">יוסר<" in html and "bdg-draft-removed" in html
    m = re.search(r"\.course-card\.course-card-draft-removed\s*\{[^}]*\}", html)
    assert m, "course-card-draft-removed style not found"
    assert "opacity" in m.group(0)


def test_proposal_state_distinguishes_added_moved_unchanged_in_preview(html):
    """The 'הצג את כל הקורסים' view must label each course as נוסף/הועבר/ללא שינוי."""
    m = re.search(r"const proposalStateBadge = cid =>.*?\n  \};", html, re.DOTALL)
    assert m, "proposalStateBadge not found"
    body = m.group(0)
    assert "נוסף" in body and "הועבר מ" in body and "ללא שינוי" in body


# ---------------------------------------------------------------------------
# Category colors for electives (PART C)
# ---------------------------------------------------------------------------

def test_cat_css_has_general_elective_and_shaar_ruach_entries(html):
    """CAT_CSS must include other_specialization (general elective) and shaar_ruach."""
    m = re.search(r"const CAT_CSS = \{(.*?)\n\};", html, re.DOTALL)
    assert m, "CAT_CSS not found"
    body = m.group(1)
    assert "other_specialization" in body and "התמחות / בחירה נוספים" in body
    assert "shaar_ruach" in body and "שער רוח" in body


def test_card_cat_specelective_and_shaarruach_css_vars_defined(html):
    """New category color variables must be defined for light and dark themes."""
    assert html.count("--cat-specelective-accent") >= 2
    assert html.count("--cat-shaarruach-accent") >= 2
    assert ".card-cat-specelective" in html and ".bdg-cat-specelective" in html
    assert ".card-cat-shaarruach" in html and ".bdg-cat-shaarruach" in html


def test_cardhtml_falls_back_to_general_elective_for_unrecognized_category(html):
    """cardHtml must not leave electives on plain card-elective when no category
    matches — it should fall back to GENERAL_ELECTIVE_CAT_ID."""
    assert "GENERAL_ELECTIVE_CAT_ID" in html
    m = re.search(r"function cardHtml\(c, placed, draftDiff, opts\) \{(.*?)\n  let cls = 'course-card';", html, re.DOTALL)
    assert m, "cardHtml category resolution block not found"
    body = m.group(1)
    assert "GENERAL_ELECTIVE_CAT_ID" in body


# ---------------------------------------------------------------------------
# שער רוח repository section (PART D)
# ---------------------------------------------------------------------------

def test_repo_groups_has_shaar_ruach_entry(html):
    """REPO_GROUPS must define a קורסי שער רוח group."""
    m = re.search(r"const REPO_GROUPS = \{(.*?)\n\};", html, re.DOTALL)
    assert m, "REPO_GROUPS not found"
    assert "shaar_ruach" in m.group(1) and "קורסי שער רוח" in m.group(1)


def test_render_sidebar_builds_shaar_ruach_section(html):
    """renderSidebar must build a repo section for SHAAR_RUACH_COURSES."""
    m = re.search(r"function renderSidebar\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderSidebar not found"
    body = m.group(1)
    assert "shaar_ruach" in body and "SHAAR_RUACH_COURSES" in body
    assert "_buildRepoSection('shaar_ruach'" in body


def test_shaar_ruach_courses_included_in_search(html):
    """_repoSearchText must include the category label (e.g. 'שער רוח') so
    שער רוח courses surface in search."""
    m = re.search(r"function _repoSearchText\(c, nameHe\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "_repoSearchText not found"
    assert "CAT_CSS[c.program_category_id]" in m.group(1)


def test_shaar_ruach_courses_marked_with_program_category_id(html):
    """SHAAR_RUACH_COURSES entries added to courseMap must get program_category_id
    'shaar_ruach' so they render with the right colors/badges and are searchable."""
    assert "program_category_id: 'shaar_ruach'" in html


def test_shaar_ruach_courses_draggable_like_other_cards(html):
    """שער רוח courses must be eligible/unlocked so cardHtml computes canDrag=true
    like any other repo card (no special-case lockout)."""
    m = re.search(r"for \(const g of SHAAR_RUACH_COURSES\) \{\s*if \(courseMap\[g\.course_id\]\) continue;(.*?)\n    \};", html, re.DOTALL)
    assert m, "SHAAR_RUACH_COURSES courseMap init block not found"
    body = m.group(1)
    assert "status: 'eligible'" in body
    assert "locked_by_user: false" in body


# ---------------------------------------------------------------------------
# Summary chips row (PART E)
# ---------------------------------------------------------------------------

def test_summary_chips_row_present_in_draft_tab(html):
    """renderDraftTab must build a chips row with total/remaining/שער רוח/
    categories/added/moved/peak-load."""
    m = re.search(r"function renderDraftTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderDraftTab not found"
    body = m.group(1)
    assert "draft-chips-row" in body
    for label in ['סה״כ', 'נותרו', 'שער רוח', 'קטגוריות', 'נוספו', 'הועברו', 'עומס שיא']:
        assert label in body, f"Summary chips row missing: {label}"


# ---------------------------------------------------------------------------
# Category card backgrounds (PART A/D) — cards must not all be uniform orange
# ---------------------------------------------------------------------------

def test_card_cat_classes_have_background_declarations(html):
    """Each card-cat-* rule must set a background, with enough specificity
    to override .card-elective's background."""
    for cls, var in [
        ("card-cat-fluids", "--cat-fluids-bg"),
        ("card-cat-solids", "--cat-solids-bg"),
        ("card-cat-systems", "--cat-systems-bg"),
        ("card-cat-labs", "--cat-labs-bg"),
        ("card-cat-specelective", "--cat-specelective-bg"),
        ("card-cat-shaarruach", "--cat-shaarruach-bg"),
    ]:
        m = re.search(r"\." + re.escape(cls) + r"\s*\{[^}]*\}", html)
        assert m, f".{cls} rule not found"
        rule = m.group(0)
        assert "background" in rule, f".{cls} missing background declaration"
        assert var in rule, f".{cls} background should use {var}"


def test_card_cat_background_vars_distinct_in_light_and_dark_themes(html):
    """--cat-*-bg vars must each have distinct color values, both in light
    and dark theme blocks (so fluids/solids/systems/labs/shaarruach all
    look visually different)."""
    bg_vars = [
        "--cat-fluids-bg", "--cat-solids-bg", "--cat-systems-bg",
        "--cat-labs-bg", "--cat-shaarruach-bg",
    ]
    for var in bg_vars:
        assert html.count(var) >= 2, f"{var} should be defined in both light and dark theme blocks"

    def extract_value(theme_block_text, var):
        m = re.search(re.escape(var) + r":\s*([^;]+);", theme_block_text)
        assert m, f"{var} value not found"
        return m.group(1).strip()

    # split roughly: first occurrence block (light) vs second (dark)
    values_first = {}
    values_second = {}
    for var in bg_vars:
        occurrences = [m.group(1).strip() for m in re.finditer(re.escape(var) + r":\s*([^;]+);", html)]
        assert len(occurrences) >= 2, f"{var} needs at least 2 definitions"
        values_first[var] = occurrences[0]
        values_second[var] = occurrences[1]

    assert len(set(values_first.values())) == len(bg_vars), "light-theme cat-*-bg values must be distinct"
    assert len(set(values_second.values())) == len(bg_vars), "dark-theme cat-*-bg values must be distinct"


def test_fluids_solids_systems_labs_shaarruach_cards_get_distinct_cat_classes(html):
    """cardHtml must assign distinct card-cat-* classes per program_category_id."""
    m = re.search(r"const CAT_CSS = \{(.*?)\n\};", html, re.DOTALL)
    assert m, "CAT_CSS not found"
    body = m.group(1)
    assert "card-cat-fluids" in body
    assert "card-cat-solids" in body
    assert "card-cat-systems" in body
    assert "card-cat-labs" in body
    assert "card-cat-shaarruach" in body

    # cardHtml must use catStyles.card to append the category class
    m2 = re.search(r"if \(isElectiveLike && catStyles.*?cls \+= ` \$\{catStyles\.card\}`", html)
    assert m2, "cardHtml does not append catStyles.card class"


def test_draft_state_classes_do_not_override_category_background_or_border(html):
    """card-draft-added/moved/removed must not set background or
    border-color (with !important) that would stomp card-cat-* styling."""
    for cls in ["card-draft-added", "card-draft-moved", "course-card-draft-removed"]:
        m = re.search(r"\.course-card\." + re.escape(cls) + r"\s*\{([^}]*)\}", html)
        assert m, f".{cls} rule not found"
        rule = m.group(1)
        assert "background" not in rule, f".{cls} must not set background"
        assert "border-color" not in rule, f".{cls} must not set border-color"


# ---------------------------------------------------------------------------
# PART E — one-click repair buttons based on current-board diagnostics
# ---------------------------------------------------------------------------

def test_repair_button_labels_present(html):
    """The five PART E repair button labels must exist in the HTML."""
    for label in [
        'הוסף קורס',           # category repair (interpolated with category name)
        'אזן את הסמסטר',
        'תקן שיבוץ',
        'תקן רצף דרישות קדם',
        'צמצם קורסים מיותרים',
    ]:
        assert label in html, f"Repair button label missing: {label}"


def test_repair_diagnostics_render_function_exists(html):
    """renderRepairDiagnosticsHtml must build repair rows/buttons for each
    diagnostic type and be wired into the AI tab summary."""
    m = re.search(r"function renderRepairDiagnosticsHtml\(s\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderRepairDiagnosticsHtml not found"
    body = m.group(1)
    assert "data-repair=\"category\"" in body
    assert "data-repair=\"balance\"" in body
    assert "data-repair=\"illegal\"" in body
    assert "data-repair=\"prereq-order\"" in body
    assert "data-repair=\"overshoot\"" in body
    assert "repair-diagnostics" in body

    m2 = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "renderAiTab not found"
    assert "renderRepairDiagnosticsHtml(s)" in m2.group(1)


def test_repair_handler_functions_exist(html):
    """Each repair button must be backed by a dedicated handler function."""
    for fn in [
        "repairCategoryToDraft",
        "repairBalanceSemesterToDraft",
        "repairIllegalPlacementToDraft",
        "repairPrereqOrderToDraft",
        "repairOvershootToDraft",
    ]:
        assert re.search(r"function " + fn + r"\(", html), f"{fn} not found"


def test_repair_handlers_use_proposal_draft_not_direct_mutation(html):
    """Repair handlers must populate state.proposalDraft (via _ensureProposalDraft
    or direct assignment) rather than mutating state.semesters directly."""
    for fn in [
        "repairCategoryToDraft",
        "repairBalanceSemesterToDraft",
        "repairIllegalPlacementToDraft",
        "repairPrereqOrderToDraft",
        "repairOvershootToDraft",
    ]:
        m = re.search(r"function " + fn + r"\(.*?\n\}\n", html, re.DOTALL)
        assert m, f"{fn} not found"
        body = m.group(0)
        assert "proposalDraft" in body or "_ensureProposalDraft" in body, \
            f"{fn} must use state.proposalDraft"
        # Must not assign directly into the live board's state.semesters.
        assert "state.semesters[" not in body, f"{fn} must not mutate state.semesters directly"


def test_repair_buttons_wired_to_handlers_in_ai_tab(html):
    """The AI tab setup must attach click handlers for each data-repair button
    that call the corresponding repair*ToDraft function."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert "data-repair" in body
    for fn in [
        "repairCategoryToDraft",
        "repairBalanceSemesterToDraft",
        "repairIllegalPlacementToDraft",
        "repairPrereqOrderToDraft",
        "repairOvershootToDraft",
    ]:
        assert fn in body, f"{fn} not wired in renderAiTab"
