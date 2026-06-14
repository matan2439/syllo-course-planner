"""
Tests for PART J — board-iteration UX (per-course action menu and related
infrastructure introduced in commit e25d761) in semester_board_viewer.html.

Like test_viewer_structure.py, these are static source-structure checks (regex /
substring assertions on the HTML+JS source) rather than a browser test run.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_HTML_PATH = Path("app/web/semester_board_viewer.html")


@pytest.fixture(scope="module")
def html() -> str:
    return _HTML_PATH.read_text(encoding="utf-8")


def _function_body(html: str, name: str) -> str:
    m = re.search(r"function " + re.escape(name) + r"\([^)]*\)\s*\{", html)
    assert m, f"function {name} not found"
    start = m.end()
    depth = 1
    i = start
    while depth > 0:
        if html[i] == "{":
            depth += 1
        elif html[i] == "}":
            depth -= 1
        i += 1
    return html[start:i]


# ---------------------------------------------------------------------------
# 1. After Apply, state.semesters updates and cards remain draggable.
# ---------------------------------------------------------------------------

def test_apply_proposal_draft_updates_state_semesters_and_clears_draft(html):
    body = _function_body(html, "applyProposalDraft")
    assert "state.semesters[sem.id] = [...(draft.semesters[sem.id] || [])]" in body
    assert "state.proposalDraft = null" in body
    assert "renderAll()" in body


def test_card_draggable_attr_depends_on_draft_not_committed_state(html):
    """draggableAttr is only suppressed by removedHere (draft overlay), so once
    proposalDraft is cleared by Apply, re-rendered cards are draggable again."""
    body = _function_body(html, "cardHtml")
    assert re.search(
        r"const draggableAttr = \(canDrag && !removedHere\) \? 'draggable=\"true\"' : 'draggable=\"false\"'",
        body,
    )
    # removedHere is only ever set when a draftDiff exists.
    assert "if (draftDiff) {" in body


# ---------------------------------------------------------------------------
# 2. Quick-action request payload uses current state.semesters.
# ---------------------------------------------------------------------------

def test_build_plan_context_reads_from_current_state_semesters(html):
    body = _function_body(html, "buildPlanContext")
    assert "state.semesters" in body
    assert "(state.semesters[sem.id] || [])" in body


def test_request_plan_proposal_uses_build_plan_context(html):
    m = re.search(r"async function requestPlanProposal\(prefs, actionType\)(.*?)\n\}", html, re.DOTALL)
    assert m, "requestPlanProposal not found"
    body = m.group(1)
    assert "buildPlanContext()" in body


# ---------------------------------------------------------------------------
# 3. "מצא חלופה" (findCourseAlternatives / swapCourseInDraft) works on an
#    applied (non-draft) course.
# ---------------------------------------------------------------------------

def test_find_course_alternatives_reads_current_board_placement(html):
    body = _function_body(html, "findCourseAlternatives")
    assert "courseMap" in body


def test_swap_course_in_draft_builds_draft_from_current_semesters(html):
    body = _function_body(html, "swapCourseInDraft")
    # Must clone the *current* board (committed semesters), not a stale snapshot.
    assert re.search(r"proposalDraft\s*\|\|.*clone\(state\.semesters\)|clone\(state\.semesters\)", body)
    assert "renderAll()" in body
    assert "setSidebarTab('draft')" in body


def test_alt_action_button_present_for_placed_cards(html):
    assert 'data-act="alt"' in html
    assert "מצא חלופה" in html


# ---------------------------------------------------------------------------
# 4. removeCourseFromBoard triggers diagnostics recompute for newly-missing
#    requirement.
# ---------------------------------------------------------------------------

def test_remove_course_from_board_recomputes_completion_analysis(html):
    body = _function_body(html, "removeCourseFromBoard")
    assert "buildPlanContext()" in body
    assert "buildCompletionAnalysisLocal" in body
    assert "showBoardNotify" in body
    # Notify message must surface a newly-missing requirement.
    assert "יחסרו" in body


def test_remove_course_from_board_noop_when_not_placed(html):
    body = _function_body(html, "removeCourseFromBoard")
    assert "findCoursePlacementSemId(cid)" in body
    assert "הקורס אינו משובץ בלוח" in body


# ---------------------------------------------------------------------------
# 5. One-click repair produces a proposalDraft without mutating
#    state.semesters directly.
# ---------------------------------------------------------------------------

def test_repair_local_functions_do_not_mutate_state_semesters(html):
    for fn_name in [
        "repairAddMissingMandatoryLocal",
        "repairAddMissingElectivesLocal",
        "repairAddHoursToDegreeLocal",
        "repairAddGeneralCoursesLocal",
    ]:
        body = _function_body(html, fn_name)
        assert "state.semesters" not in body, f"{fn_name} must not mutate state.semesters directly"
        # Each repair operates on a `proposal` and returns a (new) proposal/result.
        assert "proposal" in body
        assert "return" in body


# ---------------------------------------------------------------------------
# 6. Pinned courses remain set across apply/iterate cycle.
# ---------------------------------------------------------------------------

def test_toggle_pin_mutates_pinned_course_ids_array(html):
    body = _function_body(html, "togglePin")
    assert "state.pinnedCourseIds" in body


def test_apply_proposal_draft_does_not_touch_pinned_course_ids(html):
    body = _function_body(html, "applyProposalDraft")
    assert "pinnedCourseIds" not in body


def test_request_plan_proposal_forwards_pinned_course_ids(html):
    assert "pinned_course_ids: [...(state?.pinnedCourseIds || [])]" in html


# ---------------------------------------------------------------------------
# 7. "שפר את המערכת הנוכחית" / minimal-changes mode emphasizes minimal changes.
# ---------------------------------------------------------------------------

def test_minimal_changes_action_type_used_for_improve_current_plan(html):
    assert "_aiPlanLastPreferences = { ...prefs, action_type: 'minimal_changes' }" in html
    assert "requestPlanProposalFromDraft(prefs, 'minimal_changes')" in html


def test_minimal_changes_request_uses_draft_as_base(html):
    body = _function_body(html, "requestPlanProposalFromDraft")
    assert "state.proposalDraft" in body
    assert "state.semesters = draft.semesters" in body


# ---------------------------------------------------------------------------
# 8. Full-plan rebuild is a distinct, separately-gated action from
#    minimal-changes (a precondition for adding a confirmation step).
# ---------------------------------------------------------------------------

def test_full_plan_action_type_distinct_from_minimal_changes(html):
    assert "run('full_plan')" in html
    assert "'minimal_changes'" in html
    assert "'full_plan'" in html


def test_full_plan_rebuild_does_not_reuse_existing_draft(html):
    """The full-plan ('בנה תוכנית מלאה') path calls requestPlanProposal directly,
    not requestPlanProposalFromDraft, i.e. it rebuilds from scratch rather than
    iterating on the current draft — the property a confirmation guard protects."""
    m = re.search(
        r"document\.getElementById\('sidebar-ai-generate'\)\.addEventListener\('click', \(\) => run\('full_plan'\)\);",
        html,
    )
    assert m
    run_body = _function_body(html, "run") if "function run(" in html else None
    # `run` is a local arrow fn; locate its definition explicitly.
    run_def = re.search(r"const run = actionType => \{(.*?)\n  \};", html, re.DOTALL)
    assert run_def, "sidebar `run` helper not found"
    assert "requestPlanProposal(prefs, actionType)" in run_def.group(1)
    assert "requestPlanProposalFromDraft" not in run_def.group(1)


# ---------------------------------------------------------------------------
# 9. AI chat/planning context includes current board state + preferences
#    (_aiPickerState wanted/avoided/pinned).
# ---------------------------------------------------------------------------

def test_sidebar_quick_action_prefs_includes_picker_state(html):
    body = _function_body(html, "sidebarQuickActionPrefs")
    assert "_aiPickerState.wanted" in body
    assert "_aiPickerState.unwanted" in body
    assert "wanted_course_ids:       wanted" in body
    assert "unwanted_course_ids:     unwanted" in body


def test_plan_context_marks_pinned_courses(html):
    body = _function_body(html, "buildPlanContext")
    assert "pinned:                (state.pinnedCourseIds || []).includes(c.course_id) || undefined" in body


# ---------------------------------------------------------------------------
# 10. After Apply, UI allows triggering another action immediately without a
#     full reset/reload.
# ---------------------------------------------------------------------------

def test_apply_proposal_draft_does_not_reload_page(html):
    body = _function_body(html, "applyProposalDraft")
    assert "location.reload" not in body
    assert "renderAll()" in body
    assert "saveState()" in body


def test_apply_proposal_draft_clears_last_proposal_state_for_fresh_actions(html):
    body = _function_body(html, "applyProposalDraft")
    assert "_aiPlanLastProposal = null" in body
    assert "_aiPlanLastPreviewArgs = null" in body
