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
    """Missing syllabus note should mention official source, not imply invalid data."""
    assert "המידע הרשמי הזמין מהידיעון" in html, \
        "Syllabus note should reference official source data"


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
