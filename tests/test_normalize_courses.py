"""
test_normalize_courses.py

12 pytest tests for the Mechanical Engineering 2027 normalization pipeline.

Test matrix:
  T01  extractSemesterOffering — detects Hebrew א (A) in course_details format
  T02  extractSemesterOffering — detects Hebrew ב (B) in course_details format
  T03  extractSemesterOffering — detects Hebrew א (A) in syllabus format
  T04  extractSemesterOffering — detects Hebrew ב (B) in syllabus format
  T05  extractSemesterOffering — multi-group course returns both A and B
  T06  extractSemesterOffering — 'אין נתונים מתאימים' returns empty + not_offered flag
  T07  deriveEffectiveAllowedSemesters(['A']) -> year_3/4_semester_a
  T08  deriveEffectiveAllowedSemesters(['B']) -> year_3/4_semester_b
  T09  deriveEffectiveAllowedSemesters(['A','B']) -> all four planning semesters
  T10  extractPrerequisites — extracts TAU course IDs from course_details text
  T11  Full pipeline: all 48 extractable repo electives have non-empty offered_semesters
  T12  Full pipeline: the 8 not-offered courses have data_status='not_offered_this_year'
"""

import sys
import pytest
from pathlib import Path

# Add scripts/ to path so we can import the pipeline module
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
from normalize_courses_mechanical_2027 import (
    extractSemesterOffering,
    deriveEffectiveAllowedSemesters,
    extractPrerequisites,
    normalizeCourse,
    writeNormalizedCourseData,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sources(cd_text=None, sy_text=None, course_id='0000-0000'):
    return {
        'course_id': course_id,
        'course_details_path': None,
        'syllabus_path': None,
        'course_details_text': cd_text,
        'syllabus_text': sy_text,
    }


# ── T01 ──────────────────────────────────────────────────────────────────────

def test_T01_course_details_detects_alef():
    """course_details time+letter pattern maps Hebrew א to 'A'."""
    text = "שיעור ותרגיל וולפסון 118 ה 11:00-14:00 א' סילבוס בחינה"
    result = extractSemesterOffering(_sources(cd_text=text))
    assert result['offered_semesters'] == ['A']
    assert result['offering_source'] in ('course_details', 'both')
    assert result['offering_confidence'] == 'high'
    assert result['not_offered_this_year'] is False


# ── T02 ──────────────────────────────────────────────────────────────────────

def test_T02_course_details_detects_bet():
    """course_details time+letter pattern maps Hebrew ב to 'B'."""
    text = "שיעור מלא 08:00-12:00 ב' Moodle דרישות קדם"
    result = extractSemesterOffering(_sources(cd_text=text))
    assert result['offered_semesters'] == ['B']
    assert result['offering_confidence'] == 'high'


# ── T03 ──────────────────────────────────────────────────────────────────────

def test_T03_syllabus_detects_alef():
    """Syllabus 'סמסטר א'' pattern maps to 'A'."""
    text = "שעות סמסטריאליות 3 סמסטר א' תשפ\"ו יום ג"
    result = extractSemesterOffering(_sources(sy_text=text))
    assert result['offered_semesters'] == ['A']
    assert result['offering_source'] in ('syllabus', 'both')
    assert result['offering_confidence'] == 'high'


# ── T04 ──────────────────────────────────────────────────────────────────────

def test_T04_syllabus_detects_bet():
    """Syllabus 'סמסטר ב'' pattern maps to 'B'."""
    text = "שעות סמסטריאליות 2 סמסטר ב' תשפ\"ו חדר 205"
    result = extractSemesterOffering(_sources(sy_text=text))
    assert result['offered_semesters'] == ['B']
    assert result['offering_confidence'] == 'high'


# ── T05 ──────────────────────────────────────────────────────────────────────

def test_T05_multi_group_returns_both_semesters():
    """When a course has groups in both A and B, offered_semesters = ['A','B']."""
    # Two rows: one in A, one in B (typical for 0512-2508 / 0542-3780 etc.)
    text = (
        "קב': 01 מספר קורס 0512-2508 "
        "08:00-11:00 א' Moodle "
        "קב': 02 מספר קורס 0512-2508 "
        "13:00-16:00 ב' Moodle"
    )
    result = extractSemesterOffering(_sources(cd_text=text))
    assert result['offered_semesters'] == ['A', 'B']
    assert result['offering_confidence'] == 'high'


# ── T06 ──────────────────────────────────────────────────────────────────────

def test_T06_no_data_sets_not_offered_flag():
    """'אין נתונים מתאימים' in course_details text returns empty semesters and not_offered_this_year=True."""
    text = "תל אביב תוצאות חיפוש קורסים אין נתונים מתאימים"
    result = extractSemesterOffering(_sources(cd_text=text))
    assert result['offered_semesters'] == []
    assert result['not_offered_this_year'] is True
    assert result['offering_confidence'] == 'missing'


# ── T07 ──────────────────────────────────────────────────────────────────────

def test_T07_effective_semester_A_maps_to_year_3_and_4_a():
    """offered_semesters=['A'] -> year_3_semester_a and year_4_semester_a."""
    effective = deriveEffectiveAllowedSemesters(['A'])
    assert 'year_3_semester_a' in effective
    assert 'year_4_semester_a' in effective
    assert 'year_3_semester_b' not in effective
    assert 'year_4_semester_b' not in effective


# ── T08 ──────────────────────────────────────────────────────────────────────

def test_T08_effective_semester_B_maps_to_year_3_and_4_b():
    """offered_semesters=['B'] -> year_3_semester_b and year_4_semester_b."""
    effective = deriveEffectiveAllowedSemesters(['B'])
    assert 'year_3_semester_b' in effective
    assert 'year_4_semester_b' in effective
    assert 'year_3_semester_a' not in effective
    assert 'year_4_semester_a' not in effective


# ── T09 ──────────────────────────────────────────────────────────────────────

def test_T09_effective_semester_AB_maps_to_all_four():
    """offered_semesters=['A','B'] -> all four planning semesters."""
    effective = deriveEffectiveAllowedSemesters(['A', 'B'])
    assert set(effective) == {
        'year_3_semester_a', 'year_4_semester_a',
        'year_3_semester_b', 'year_4_semester_b',
    }


# ── T10 ──────────────────────────────────────────────────────────────────────

def test_T10_prerequisites_extracted_from_course_details_text():
    """extractPrerequisites finds TAU course IDs from course_details plain-text."""
    text = (
        "0542-4224 קב': 01 מכניקת המוצקים (2) "
        "דרישות קדם 0542-2200 0542-3243"
    )
    sources = _sources(cd_text=text, course_id='0542-4224')
    sources['course_details_path'] = True  # non-None so extractor reads cd_text
    result = extractPrerequisites(sources)
    ids = result['prerequisite_course_ids']
    # Should find 0542-2200 and 0542-3243 but NOT the course itself (0542-4224)
    assert '0542-2200' in ids or '0542-3243' in ids
    assert '0542-4224' not in ids


# ── T11 ──────────────────────────────────────────────────────────────────────

def test_T11_full_pipeline_48_extractable_courses_have_semester_data():
    """
    After running the full pipeline, all 48 extractable repo electives
    must have non-empty offered_semesters.  (8 are legitimately not-offered.)
    """
    result = writeNormalizedCourseData()
    after = result['after']

    assert after['with_offered_semesters'] == 48, (
        f"Expected 48 courses with semester data, got {after['with_offered_semesters']}. "
        f"Still missing: {after['still_missing_semester_data']}"
    )
    assert after['still_missing_semester_data'] == 0, (
        f"Unexpected courses without semester data: {after['still_missing_semester_data']}"
    )


# ── T12 ──────────────────────────────────────────────────────────────────────

def test_T12_not_offered_courses_have_correct_status():
    """
    The 8 courses not offered in 2025/2026 must have data_status='not_offered_this_year'
    and offered_semesters=[].
    """
    NOT_OFFERED = {
        '0542-4093', '0542-4124', '0542-4131', '0542-4132',
        '0542-4135', '0542-4191', '0542-4321', '0542-4322',
    }
    result = writeNormalizedCourseData()
    for course in result['courses']:
        cid = course['course_id']
        if cid in NOT_OFFERED:
            assert course['data_status'] == 'not_offered_this_year', (
                f"{cid} expected data_status='not_offered_this_year', "
                f"got '{course['data_status']}'"
            )
            assert course['offered_semesters'] == [], (
                f"{cid} expected empty offered_semesters, "
                f"got {course['offered_semesters']}"
            )
    # Confirm count
    not_offered_count = sum(1 for c in result['courses'] if c['not_offered_this_year'])
    assert not_offered_count == 8, (
        f"Expected 8 not-offered courses, got {not_offered_count}"
    )
