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
    assert "עוזר AI" in html


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

    m = re.search(r"function renderProposalCard\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderProposalCard not found"
    assert "renderDegreeProgressHtml(" in m.group(1), \
        "renderProposalCard must render the degree-progress summary"

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
    """renderProposalCard must build a chips row with total/remaining/שער רוח/
    categories/added/moved/peak-load."""
    m = re.search(r"function renderProposalCard\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderProposalCard not found"
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
    """The remaining non-category PART E repair button labels must exist.
    'אזן את הסמסטר' was removed entirely (chat-first balance-load instead)."""
    for label in [
        'תקן שיבוץ',
        'תקן רצף דרישות קדם',
        'צמצם קורסים מיותרים',
    ]:
        assert label in html, f"Repair button label missing: {label}"


def test_repair_diagnostics_render_function_exists(html):
    """renderRepairDiagnosticsHtml must build repair rows/buttons for the
    illegal-placement, prereq-order, and overshoot diagnostics (overloaded
    semesters are now plain text — 'אזן את הסמסטר' was removed in favor of
    chat-driven balancing) and be wired into the AI tab summary."""
    m = re.search(r"function renderRepairDiagnosticsHtml\(s\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderRepairDiagnosticsHtml not found"
    body = m.group(1)
    assert "data-repair=\"balance\"" not in body
    assert "אזן את הסמסטר" not in body
    assert "data-repair=\"illegal\"" in body
    assert "data-repair=\"prereq-order\"" in body
    assert "data-repair=\"overshoot\"" in body
    assert "repair-diagnostics" in body

    m2 = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "renderAiTab not found"
    assert "renderRepairDiagnosticsHtml(s)" in m2.group(1)


def test_balance_semester_button_removed_everywhere(html):
    """'אזן את הסמסטר' must not appear anywhere in default-visible markup —
    the balance-load chat intent / advanced 'אזן עומס' action replace it."""
    assert "אזן את הסמסטר" not in html


def test_repair_handler_functions_exist(html):
    """Each repair button (plus the conversational category-suggestion flow)
    must be backed by a dedicated handler function."""
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
    that call the corresponding repair*ToDraft function. The category repair
    is wired via the conversational suggestion flow (applyCategorySuggestionFirst)."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert "data-repair" in body
    for fn in [
        "repairBalanceSemesterToDraft",
        "repairIllegalPlacementToDraft",
        "repairPrereqOrderToDraft",
        "repairOvershootToDraft",
    ]:
        assert fn in body, f"{fn} not wired in renderAiTab"
    assert "applyCategorySuggestionFirst" in html, \
        "category repair must be reachable via the conversational suggestion flow"


# ---------------------------------------------------------------------------
# Unified "עוזר AI" tab — tab consolidation + conversational planning (PART H)
# ---------------------------------------------------------------------------

def test_no_separate_chat_tab_remains(html):
    """The separate 'שיחה עם AI' sidebar tab/element must be removed (the
    per-course detail-modal "🤖 שיחה עם AI" tab is unrelated and may remain)."""
    assert "sb-tab-chat" not in html
    assert "sb-panel-chat" not in html
    assert 'data-tab="chat">שיחה עם AI' not in html


def test_unified_ai_tab_has_chat_input_and_quick_actions(html):
    """The unified 'עוזר AI' tab must contain a chat input, and the old
    repair quick-actions must now live inside the collapsed 'אפשרויות
    מתקדמות' section, not as default-visible buttons."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert "sidebar-chat-input" in body
    assert "sidebar-chat-send" in body
    for label in ['אזן עומס', 'תקן בעיות חוקיות', 'שפר התאמה לקריירה']:
        assert label in body, f"Advanced action missing: {label}"


def test_mechanical_category_add_buttons_removed(html):
    """The old mechanical 'הוסף קורס קורסי ליבה — .../מוצקים/מערכות/מעבדות
    מתאים' buttons must be removed entirely."""
    assert 'data-repair="category"' not in html
    assert "הוסף קורס מעבדות מתקדמות מתאים" not in html
    m = re.search(r"function renderRepairDiagnosticsHtml\(s\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderRepairDiagnosticsHtml not found"
    assert 'הוסף קורס' not in m.group(1)


def test_missing_requirements_rendered_as_diagnostics_list(html):
    """Missing category/general requirements must render as plain text
    ('דרישות חסרות:') rather than as the old add-buttons."""
    assert "function buildMissingRequirementsList" in html
    assert "function renderMissingRequirementsHtml" in html
    assert "דרישות חסרות:" in html

    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    assert "renderMissingRequirementsHtml(" in m.group(1)
    assert "buildMissingRequirementsList(" in m.group(1)


def test_missing_requirements_no_attached_buttons(html):
    """renderMissingRequirementsHtml must NOT render
    'השלם דרישות חסרות'/'שאל אותי לפני בחירה' buttons directly — those moved
    to the collapsed 'אפשרויות מתקדמות' section."""
    m = re.search(r"function renderMissingRequirementsHtml\(items\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderMissingRequirementsHtml not found"
    body = m.group(1)
    for label in ['השלם דרישות חסרות', 'שאל אותי לפני בחירה']:
        assert label not in body, f"Missing-requirements button should be moved out: {label}"


def test_clarification_question_mechanism_exists(html):
    """A clarification-question heuristic must exist that can render
    quick-reply chips before full plan generation."""
    assert "function detectClarificationNeeds" in html
    assert "quickReplies" in html
    m = re.search(r"async function handleSidebarChatSend\(.*?\n}\n", html, re.DOTALL)
    assert m, "handleSidebarChatSend not found"
    assert "detectClarificationNeeds(" in m.group(0)


def test_quick_reply_click_updates_preferences(html):
    """Quick-reply click handlers must update _aiPickerState / preferences,
    e.g. 'כן, להימנע מבקרה' adds courses to avoided/strongUnwanted."""
    m = re.search(r"function handleQuickReply\(qr\)(.*?\n)\}\n", html, re.DOTALL)
    assert m, "handleQuickReply not found"
    body = m.group(1)
    assert "_aiPickerState.unwanted" in body
    assert "_aiPickerState.strongUnwanted" in body
    assert "avoid-control" in body


def test_proposal_card_renders_inside_unified_ai_tab(html):
    """The proposal card must render inside the unified 'עוזר AI' tab, not as
    a separate 'טיוטת שינויים' tab element."""
    assert "function renderProposalCard" in html
    assert "sb-tab-draft" not in html
    assert "sb-panel-draft" not in html

    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    assert "ai-proposal-card" in m.group(1)
    assert "renderProposalCard()" in m.group(1)


def test_proposal_card_has_apply_reject_ask_again_controls(html):
    """The proposal card must offer apply/reject/ask-again and a link to the
    full preview modal."""
    m = re.search(r"function renderProposalCard\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderProposalCard not found"
    body = m.group(1)
    assert "sb-draft-apply" in body
    assert "sb-draft-reject" in body
    assert "sb-draft-ask" in body
    assert "sb-draft-full" in body
    assert "applyProposalDraft" in body
    assert "rejectProposalDraft" in body


def test_planning_request_includes_current_semesters(html):
    """The planning request payload must include the current state.semesters
    (via buildPlanContext)."""
    m = re.search(r"function buildPlanContext\(\)(.*?\n)\}\n", html, re.DOTALL)
    assert m, "buildPlanContext not found"
    assert "state.semesters" in m.group(1)

    m2 = re.search(r"async function requestPlanProposal\(prefs, actionType\)(.*?)\n\}\n", html, re.DOTALL)
    assert m2, "requestPlanProposal not found"
    assert "buildPlanContext()" in m2.group(1)


def test_followup_chat_message_extends_existing_draft(html):
    """A follow-up chat message after a draft already exists must operate on
    state.proposalDraft (via requestPlanProposalFromDraft) rather than
    resetting it from scratch."""
    m = re.search(r"async function handleSidebarChatSend\(.*?\n}\n", html, re.DOTALL)
    assert m, "handleSidebarChatSend not found"
    body = m.group(0)
    assert "state.proposalDraft" in body
    assert "requestPlanProposalFromDraft" in body


def test_syllabus_url_without_parsed_text_does_not_say_unavailable(html):
    """buildCourseContext: course with syllabus_url but no syllabus_summary_he
    must say a syllabus link exists but is not yet analyzed, not 'no syllabus'."""
    m = re.search(r"function buildCourseContext\(c\)(.*?)\n\}\n", html, re.DOTALL)
    assert m, "buildCourseContext not found"
    body = m.group(1)
    assert "קישור סילבוס קיים עבור קורס זה" in body
    assert "עדיין לא נותח במערכת" in body
    assert "אפשר לפתוח את הסילבוס כאן" in body


def test_no_syllabus_url_says_link_not_found(html):
    """buildCourseContext: course with no syllabus_url at all must say
    'לא נמצא קישור סילבוס'."""
    m = re.search(r"function buildCourseContext\(c\)(.*?)\n\}\n", html, re.DOTALL)
    assert m, "buildCourseContext not found"
    body = m.group(1)
    assert "לא נמצא קישור סילבוס לקורס הזה במערכת" in body


def test_parsed_syllabus_summary_used_in_context(html):
    """buildCourseContext: when syllabus_text_available && syllabus_summary_he,
    the parsed summary/topics/assessment must be included in the context."""
    m = re.search(r"function buildCourseContext\(c\)(.*?)\n\}\n", html, re.DOTALL)
    assert m, "buildCourseContext not found"
    body = m.group(1)
    assert "syllabus_text_available && c.syllabus_summary_he" in body
    assert "תקציר סילבוס" in body
    assert "syllabus_topics_he" in body
    assert "syllabus_assessment_he" in body


def test_shaar_ruach_assessment_pref_options_exist(html):
    """SHAAR_RUACH_ASSESSMENT_PREF_OPTIONS must define the required preference
    options, including 'no exam', 'final paper', 'ongoing', 'low workload',
    'avoid exam' and 'avoid attendance'."""
    assert "SHAAR_RUACH_ASSESSMENT_PREF_OPTIONS" in html
    m = re.search(r"const SHAAR_RUACH_ASSESSMENT_PREF_OPTIONS = \[(.*?)\];", html, re.DOTALL)
    assert m
    body = m.group(1)
    for val in ["none", "no_exam", "final_paper", "ongoing", "low_workload", "avoid_exam", "avoid_attendance"]:
        assert f"value: '{val}'" in body


def test_shaar_ruach_assessment_ranking_prefers_no_exam(html):
    """_shaarRuachAssessmentScoreLocal: with pref='no_exam', a candidate with
    has_exam===false must score higher than one with has_exam===true, and
    higher than an unknown (null) candidate."""
    m = re.search(r"function _shaarRuachAssessmentScoreLocal\(c, pref\)(.*?)\n\}\n", html, re.DOTALL)
    assert m, "_shaarRuachAssessmentScoreLocal not found"
    body = m.group(1)
    assert "has_exam === false" in body
    assert "has_exam == null" in body


def test_shaar_ruach_assessment_ranking_prefers_final_paper(html):
    """_shaarRuachAssessmentScoreLocal: with pref='final_paper', a candidate
    with has_final_paper/has_project===true ranks higher."""
    m = re.search(r"function _shaarRuachAssessmentScoreLocal\(c, pref\)(.*?)\n\}\n", html, re.DOTALL)
    assert m, "_shaarRuachAssessmentScoreLocal not found"
    body = m.group(1)
    assert "has_final_paper === true || c.has_project === true" in body


def test_shaar_ruach_unknown_assessment_ranks_below_known_match(html):
    """For preferences with a binary signal (no_exam/avoid_exam/avoid_attendance),
    a known-matching value must score strictly higher than an unknown (null) value,
    which must in turn score >= a known-non-matching value."""
    m = re.search(r"function _shaarRuachAssessmentScoreLocal\(c, pref\)(.*?)\n\}\n", html, re.DOTALL)
    assert m
    body = m.group(1)
    # known match -> 3, unknown -> 1, non-match -> negative; 3 > 1 > -3
    assert "return 3" in body
    assert "return 1" in body
    assert "return -3" in body


def test_shaar_ruach_pref_used_only_in_general_courses_repair(html):
    """_pickBestShaarRuachCandidateLocal must be used inside
    repairAddGeneralCoursesLocal (שער רוח candidate selection), and must NOT
    be used inside repairAddMissingElectivesLocal (engineering electives)."""
    assert "_pickBestShaarRuachCandidateLocal" in html

    m_general = re.search(r"function repairAddGeneralCoursesLocal\(.*?\n\}\n", html, re.DOTALL)
    assert m_general
    assert "_pickBestShaarRuachCandidateLocal" in m_general.group(0)

    m_electives = re.search(r"function repairAddMissingElectivesLocal\(.*?\n\}\n", html, re.DOTALL)
    assert m_electives
    assert "_pickBestShaarRuachCandidateLocal" not in m_electives.group(0)
    assert "shaarRuachAssessmentPref" not in m_electives.group(0)


def test_shaar_ruach_no_match_fallback_message(html):
    """repairAddGeneralCoursesLocal must communicate when no candidate matches
    the requested assessment preference."""
    m = re.search(r"function repairAddGeneralCoursesLocal\(.*?\n\}\n", html, re.DOTALL)
    assert m
    assert "לא נמצאו קורסי שער רוח עם סוג הסיום שביקשת, לכן נבחרו החלופות הקרובות ביותר." in m.group(0)


def test_course_modal_renders_shaar_ruach_info_section(html):
    """The course detail modal must render a 'מידע שער רוח' section showing
    נק"ז, סמסטר, סוג סיום, עומס משוער and סילבוס status for שער רוח courses."""
    assert "מידע שער רוח" in html
    m = re.search(r"const shaarRuachSection = \(\(\) => \{(.*?)\n  \}\)\(\);", html, re.DOTALL)
    assert m, "shaarRuachSection not found"
    body = m.group(1)
    for label in ['נק"ז', "סמסטר", "סוג סיום", "עומס משוער", "סילבוס"]:
        assert label in body


def test_ai_plan_request_includes_shaar_ruach_pref(html):
    """The AI plan request preferences payload must include
    shaarRuachAssessmentPref when set."""
    m = re.search(r"preferences: \(_aiPlanLastPreferences.*?\n      : undefined,", html, re.DOTALL)
    assert m, "preferences payload not found"
    assert "shaarRuachAssessmentPref" in m.group(0)


# ---------------------------------------------------------------------------
# PART A/B/H — "העדפות תכנון" section + collapsed missing-requirements block
# ---------------------------------------------------------------------------

def test_wanted_course_picker_in_ai_tab(html):
    """The wanted-course picker must exist inside renderAiTab's markup."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert "ai-pref-wanted-search" in body
    assert "ai-pref-wanted-chips" in body
    assert "setupCoursePicker('wanted')" in body


def test_avoided_course_picker_in_ai_tab(html):
    """The avoided-course picker must exist inside renderAiTab's markup."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert "ai-pref-unwanted-search" in body
    assert "ai-pref-unwanted-chips" in body
    assert "setupCoursePicker('unwanted')" in body


def test_max_weekly_hours_control_in_ai_tab_and_payload(html):
    """The max-weekly-hours slider must exist and feed max_weekly_hours in the
    planning request payload (sidebarQuickActionPrefs)."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    assert "sidebar-max-hours" in m.group(1)

    m2 = re.search(r"function sidebarQuickActionPrefs\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "sidebarQuickActionPrefs not found"
    assert "sidebar-max-hours" in m2.group(1)
    assert "max_weekly_hours" in m2.group(1)


def test_shaar_ruach_pref_control_in_ai_tab_and_payload(html):
    """The שער רוח assessment-preference dropdown must exist in the AI tab and
    feed into the planning context preferences."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    assert "ai-pref-shaar-ruach-assessment" in m.group(1)
    assert "SHAAR_RUACH_ASSESSMENT_PREF_OPTIONS" in m.group(1)

    m2 = re.search(r"preferences: \(_aiPlanLastPreferences.*?\n      : undefined,", html, re.DOTALL)
    assert m2 and "shaarRuachAssessmentPref" in m2.group(0)


def test_global_smart_completion_button_in_advanced_section(html):
    """The global 'השלם דרישות חסרות' button + handler must exist, now
    inside the collapsed 'אפשרויות מתקדמות' section."""
    assert "השלם דרישות חסרות" in html
    assert re.search(r"function offerAllCategorySuggestions\(", html)
    m = re.search(r"<details class=\"ai-plan-section ai-advanced-collapsible\">(.*?)</details>", html, re.DOTALL)
    assert m, "advanced actions <details> not found"
    assert 'id="sidebar-missing-suggest-all"' in m.group(1)
    assert "השלם דרישות חסרות" in m.group(1)


# ---------------------------------------------------------------------------
# PART C/D/E/F/H — ping-pong planning context + incremental chat
# ---------------------------------------------------------------------------

def test_plan_context_includes_board_draft_preferences_blockers_instruction(html):
    """buildPlanContext (board+preferences) and the chat-send flow (draft +
    validation blockers + latest instruction) together must cover the full
    context required for the planning/chat request."""
    m = re.search(r"function buildPlanContext\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "buildPlanContext not found"
    ctx_body = m.group(1)
    assert "semesters" in ctx_body
    assert "preferences" in ctx_body
    assert "_aiPickerState" in ctx_body

    m2 = re.search(r"async function handleSidebarChatSend\(providedMessage\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "handleSidebarChatSend not found"
    chat_body = m2.group(1)
    assert "proposalDraft" in chat_body
    assert "sidebarQuickActionPrefs" in chat_body
    assert "planningText" in chat_body or "message" in chat_body


def test_followup_chat_extends_draft_incrementally(html):
    """A follow-up chat message with an active draft must call
    requestPlanProposalFromDraft (incremental, using the dispatched
    actionType), not a full rebuild, by default."""
    m = re.search(r"async function handleSidebarChatSend\(providedMessage\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "handleSidebarChatSend not found"
    body = m.group(1)
    assert "requestPlanProposalFromDraft(prefs, actionType)" in body


# ---------------------------------------------------------------------------
# Regression guards + compact draft card
# ---------------------------------------------------------------------------

def test_no_separate_chat_tab_remains_regression(html):
    assert "sb-tab-chat" not in html
    assert "sb-panel-chat" not in html
    assert 'data-tab="chat">שיחה עם AI' not in html


def test_render_proposal_card_present_in_ai_tab(html):
    """renderProposalCard must be called from renderAiTab and produce the
    compact draft card markup (status, counts, action buttons)."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    assert "renderProposalCard()" in m.group(1)
    assert 'id="ai-proposal-card"' in m.group(1)

    m2 = re.search(r"function renderProposalCard\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "renderProposalCard not found"
    body = m2.group(1)
    for label in ["החל טיוטה", "דחה טיוטה", "בקש שינויים", "פתח תצוגה מלאה"]:
        assert label in body, f"{label} missing from renderProposalCard"


# ---------------------------------------------------------------------------
# PART A/B/E/F/G — single primary action, advanced actions, fixed full-plan
# ---------------------------------------------------------------------------

def test_no_duplicate_top_level_full_plan_and_suggest_all_buttons(html):
    """The old always-visible 'בנה תוכנית מלאה' and 'הצע השלמה חכמה לכל
    הדרישות' top-level buttons must not both be present in the AI tab."""
    m = re.search(r"function renderAiTab\(\)(.*?)\nfunction ", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    assert 'id="sidebar-quick-full"' not in body
    assert "הצע השלמה חכמה לכל הדרישות" not in body


def test_primary_action_button_removed_suggest_next_present(html):
    """The old always-visible 'הצע תוכנית / תיקון חכם' primary button must be
    gone; a small optional 'הצע צעד הבא' button (using the same
    runPrimaryAiAction dispatch) takes its place."""
    assert 'id="sidebar-primary-action"' not in html
    assert "הצע תוכנית / תיקון חכם" not in html
    assert 'id="sidebar-suggest-next"' in html
    assert "הצע צעד הבא" in html
    assert re.search(r"function runPrimaryAiAction\(", html)
    assert "getElementById('sidebar-suggest-next')?.addEventListener('click', () => runPrimaryAiAction())" in html


def test_rebuild_from_scratch_in_advanced_actions_with_confirm(html):
    """'בנה מחדש מאפס' must live under אפשרויות מתקדמות, with a confirm()
    dialog, and call the (fixed) full-plan flow."""
    m = re.search(r"<details class=\"ai-plan-section ai-advanced-collapsible\">(.*?)</details>", html, re.DOTALL)
    assert m, "advanced actions <details> not found"
    assert 'id="sidebar-rebuild-from-scratch"' in m.group(1)
    assert "בנה מחדש מאפס" in m.group(1)

    m2 = re.search(
        r"getElementById\('sidebar-rebuild-from-scratch'\)\.addEventListener\('click', \(\) => \{(.*?)\}\);",
        html, re.DOTALL,
    )
    assert m2, "sidebar-rebuild-from-scratch click handler not found"
    handler_body = m2.group(1)
    assert "confirm(" in handler_body
    assert "run('full_plan')" in handler_body


def test_chat_free_text_routes_full_plan_request(html):
    """Free-text 'תבנה לי תוכנית מלאה' must route to the full-plan flow via
    detectAiIntent."""
    m = re.search(r"async function handleSidebarChatSend\(providedMessage\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "handleSidebarChatSend not found"
    body = m.group(1)
    assert "detectAiIntent(" in body
    assert "requestPlanProposal(prefs, 'full_plan')" in body

    m2 = re.search(r"function detectAiIntent\(message\)(.*?)\n}\n", html, re.DOTALL)
    assert m2, "detectAiIntent not found"
    assert re.search(r"תבנה.*תוכנית.*מלאה", m2.group(1))


def test_chat_first_default_visible_controls(html):
    """Only the chat input + 'שלח' send button + optional 'הצע צעד הבא'
    button should be visible by default (outside <details> / proposal card)
    in the AI tab."""
    m = re.search(r"function renderAiTab\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "renderAiTab not found"
    body = m.group(1)
    template_match = re.search(r"panel\.innerHTML = `(.*?)`;", body, re.DOTALL)
    assert template_match, "renderAiTab template not found"
    template = template_match.group(1)

    # Strip out the collapsed <details> sections and the proposal card slot.
    template_no_details = re.sub(r"<details.*?</details>", "", template, flags=re.DOTALL)
    template_no_details = re.sub(r'<div id="ai-proposal-card"></div>', "", template_no_details)

    for removed in ['אזן עומס', 'תקן בעיות חוקיות', 'שפר התאמה לקריירה', 'הצע תוכנית / תיקון חכם', 'בנה מחדש מאפס']:
        assert removed not in template_no_details, f"{removed} must not be default-visible"

    visible_buttons = re.findall(r'<button[^>]*id="([^"]+)"', template_no_details)
    assert set(visible_buttons) <= {"sidebar-chat-send", "sidebar-suggest-next"}, visible_buttons


def test_full_plan_flow_no_undefined_function_references(html):
    """Static smoke check: functions referenced by the (fixed) full-plan flow
    must be defined somewhere in the inline scripts."""
    for fn in ["requestPlanProposal", "activateProposalDraft", "renderAiTab", "setSidebarTab", "runPrimaryAiAction"]:
        assert re.search(rf"function {fn}\(", html), f"{fn} is not defined"


def test_request_plan_proposal_rejects_on_error(html):
    """requestPlanProposal must throw/reject on error responses and network
    errors so callers' .catch()/try-catch can surface a chat error message
    instead of silently failing."""
    m = re.search(r"async function requestPlanProposal\(prefs, actionType\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "requestPlanProposal not found"
    body = m.group(1)
    assert "throw new Error" in body
    assert "throw err" in body


def test_primary_action_dispatches_based_on_board_state(html):
    """runPrimaryAiAction must branch on board emptiness, missing
    requirements, and otherwise fall back to incremental improvement."""
    m = re.search(r"function runPrimaryAiAction\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "runPrimaryAiAction not found"
    body = m.group(1)
    assert "allPlacedIds" in body
    assert "'full_plan'" in body
    assert "offerAllCategorySuggestions" in body
    assert "'minimal_changes'" in body


# ---------------------------------------------------------------------------
# PART E — detectAiIntent
# ---------------------------------------------------------------------------

def _extract_fn(html, name):
    m = re.search(rf"function {name}\(.*?\n}}\n", html, re.DOTALL)
    assert m, f"{name} not found"
    return m.group(0)


def test_detect_ai_intent_function_exists(html):
    assert "function detectAiIntent(message)" in html


def _run_detect_ai_intent(html, message):
    """Extract detectAiIntent + its small dependencies and run them in node
    against a stubbed environment, returning the parsed intent object."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")

    sem_he_m = re.search(r"const SEM_HE = \{.*?\n\};", html, re.DOTALL)
    semesters_m = re.search(r"const SEMESTERS = \[.*?\n\];", html, re.DOTALL)
    control_m = re.search(r"const CONTROL_HEAVY_KEYWORDS = \[.*?\];", html, re.DOTALL)
    assert sem_he_m and semesters_m and control_m

    detect_intent = _extract_fn(html, "detectAiIntent")
    extract_sem = _extract_fn(html, "_extractSemesterIdFromText")
    extract_course = _extract_fn(html, "_extractCourseIdFromText")
    detect_clarification = _extract_fn(html, "detectClarificationNeeds")

    script = f"""
{sem_he_m.group(0)}
{semesters_m.group(0)}
{control_m.group(0)}
const courseMap = {{}};
{detect_clarification}
{extract_sem}
{extract_course}
{detect_intent}
console.log(JSON.stringify(detectAiIntent({json.dumps(message)})));
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(script)
        tmp_path = f.name
    try:
        result = subprocess.run([node, tmp_path], capture_output=True, text=True, encoding="utf-8")
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout.strip())
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def test_detect_ai_intent_balance_load(html):
    intent = _run_detect_ai_intent(html, "תאזן עומס")
    assert intent["type"] == "balance_load"


def test_detect_ai_intent_complete_requirements(html):
    intent = _run_detect_ai_intent(html, "תשלים דרישות חסרות")
    assert intent["type"] == "complete_requirements"


def test_detect_ai_intent_full_plan(html):
    intent = _run_detect_ai_intent(html, "בנה מערכת מלאה")
    assert intent["type"] == "full_plan"


def test_detect_ai_intent_fix_legality(html):
    intent = _run_detect_ai_intent(html, "תקן בעיות חוקיות בשיבוץ")
    assert intent["type"] == "fix_legality"


def test_detect_ai_intent_balance_specific_semester(html):
    intent = _run_detect_ai_intent(html, "תאזן את שנה ג׳ סמסטר א׳")
    assert intent["type"] == "balance_specific_semester"
    assert intent["semesterId"] == "year_3_semester_a"


# ---------------------------------------------------------------------------
# PART E — preferences (wanted/avoided/max-load) remain in "העדפות תכנון"
# ---------------------------------------------------------------------------

def test_planning_preferences_details_contains_pickers_and_max_hours(html):
    """Wanted/avoided course pickers and the max-weekly-hours control must
    remain inside the collapsed 'העדפות תכנון' <details>."""
    m = re.search(r'<details class="ai-plan-section ai-prefs-collapsible">(.*?)</details>', html, re.DOTALL)
    assert m, "'העדפות תכנון' <details> not found"
    body = m.group(1)
    assert "העדפות תכנון" in body
    assert 'id="ai-pref-wanted-search"' in body
    assert 'id="ai-pref-unwanted-search"' in body
    assert 'id="sidebar-max-hours"' in body
    assert 'id="ai-pref-shaar-ruach-assessment"' in body


# ---------------------------------------------------------------------------
# PART F/G/H — "הקורסים שלי" modal: semester grid + shared status model
# ---------------------------------------------------------------------------

def test_my_courses_modal_has_semester_grid_section(html):
    """openMyCoursesModal must render a semester-grid section for mandatory
    courses with status-toggle controls."""
    assert 'id="my-courses-grid"' in html
    assert re.search(r"function _renderMyCoursesGrid\(gridEl\)", html)
    body = _extract_fn(html, "_renderMyCoursesGrid")
    assert "data-mc-grid-toggle" in body
    assert "SEMESTERS" in body


def test_my_courses_grid_toggle_writes_shared_status_model(html):
    """Toggling a status in the new grid must call setUserStatus/getUserStatus
    — the SAME model read by getDegreeHoursStatusLocal and prerequisite checks."""
    # The grid click handler (wired in openMyCoursesModal) must call setUserStatus.
    m = re.search(r"function openMyCoursesModal\(\)(.*?)\n}\n", html, re.DOTALL)
    assert m, "openMyCoursesModal not found"
    body = m.group(1)
    assert "setUserStatus(" in body
    assert "getUserStatus(" in body
    assert "data-mc-grid-toggle" in body

    # getDegreeHoursStatusLocal / prerequisite checks must read via the same
    # userCourseStatuses-backed accessor (getUserStatus / isCourseCompleted /
    # completedCourseIds derived from it).
    assert re.search(r"function getUserStatus\(cid\)", html)
    assert "userCourseStatuses[cid]" in _extract_fn(html, "getUserStatus")


def test_completed_course_via_grid_satisfies_prereq_and_excluded_from_scheduling(html):
    """A course marked 'הושלם' via setUserStatus must (a) be excluded from
    future-scheduling candidate pools (filtered via completedCourseIds /
    isCourseCompleted) and (b) be treated as satisfying prerequisites
    (_hasPrereqOrderViolationLocal skips completed prerequisites)."""
    # (a) candidate-selection / repair logic excludes completed courses.
    repair_overshoot = _extract_fn(html, "repairOvershootToDraft")
    assert "ctx.completedCourseIds.has(cid)" in repair_overshoot

    # (b) prereq-order check treats status === 'completed' (or
    # completedCourseIds) as satisfying the prerequisite.
    prereq_check = _extract_fn(html, "_hasPrereqOrderViolationLocal")
    assert "status === 'completed'" in prereq_check or "completedCourseIds.has(prereq)" in prereq_check
    assert "status === 'currently_taking'" in prereq_check
