#!/usr/bin/env python3
"""
normalize_courses_mechanical_2027.py

Full course-data normalization pipeline for the Mechanical Engineering 2027 repository.

Reads raw HTML from:
  data/raw_html/course_details/course_XXXXXXXX_2025.html  — TAU course-search results (68 files)
  data/raw_html/syllabus/syllabus_XXXXXXXX.html           — TAU syllabus pages (60 files)

Produces: data/import_reports/normalized_courses_mechanical_2027.json

Pipeline:
  1. collectCourseSources(course_id)     -> dict of text/path sources
  2. extractSemesterOffering(sources)    -> offered_semesters, confidence, source
  3. deriveEffectiveAllowedSemesters(s)  -> list of planning-semester IDs
  4. extractPrerequisites(sources)       -> prereq IDs extracted from HTML
  5. normalizeCourse(course_id, entry)   -> full normalized record
  6. writeNormalizedCourseData()         -> main entry point, writes JSON + prints report
"""

import json
import re
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    raise ImportError("Run: pip install beautifulsoup4")

# ── Constants ────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent.parent  # tau-course-planner root

# Regex: time slot immediately followed by semester letter (course_details format)
# e.g.  "11:00-14:00 א'"  or  "08:00–12:00 ב׳"
SEMS_RE_CD = re.compile(r'\d{1,2}:\d{2}[-–]\d{1,2}:\d{2}\s*([א-ב])[׳\']')

# Regex: explicit label in syllabus (syllabus format)
# e.g.  "סמסטר א' תשפ"ו"
SEMS_RE_SY = re.compile(r'סמסטר\s+([א-ב])[׳\']')

# "No matching data" — course not offered in 2025/2026
NO_DATA_RE = re.compile(r'אין\s+נתונים\s+מתאימים')

# Course-ID pattern: NNNN-NNNN
COURSE_ID_RE = re.compile(r'\b(\d{4}-\d{4})\b')

# Known TAU faculty prefixes that can appear as prerequisites
TAU_PREFIXES = frozenset({'0512', '0542', '0509', '0555', '0571', '0581', '0341',
                          '0365', '0366', '0368', '0321', '0519', '0546', '0560'})

HEB_TO_ENG = {'א': 'A', 'ב': 'B'}  # א→A  ב→B

EFFECTIVE_SEMESTER_MAP = {
    'A': ['year_3_semester_a', 'year_4_semester_a'],
    'B': ['year_3_semester_b', 'year_4_semester_b'],
}


# ── Step 1: collectCourseSources ─────────────────────────────────────────────

def collectCourseSources(course_id: str) -> dict:
    """
    Locate all raw HTML files for course_id and return their parsed plain-text.

    Returns a dict with keys:
      course_id               str
      course_details_path     Path | None
      syllabus_path           Path | None
      course_details_text     str | None  (BeautifulSoup plain-text)
      syllabus_text           str | None
    """
    raw_id = course_id.replace('-', '')

    cd_path = BASE / 'data/raw_html/course_details' / f'course_{raw_id}_2025.html'
    sy_path = BASE / 'data/raw_html/syllabus' / f'syllabus_{raw_id}.html'

    sources = {
        'course_id': course_id,
        'course_details_path': None,
        'syllabus_path': None,
        'course_details_text': None,
        'syllabus_text': None,
    }

    if cd_path.exists():
        sources['course_details_path'] = cd_path
        raw = cd_path.read_bytes().decode('utf-8', errors='replace')
        sources['course_details_text'] = BeautifulSoup(raw, 'html.parser').get_text(' ', strip=True)

    if sy_path.exists():
        sources['syllabus_path'] = sy_path
        raw = sy_path.read_bytes().decode('utf-8', errors='replace')
        sources['syllabus_text'] = BeautifulSoup(raw, 'html.parser').get_text(' ', strip=True)

    return sources


# ── Step 2: extractSemesterOffering ──────────────────────────────────────────

def extractSemesterOffering(sources: dict) -> dict:
    """
    Extract offered semesters from the course's HTML sources.

    Handles multi-group courses (e.g. a course that runs in both A and B).
    Returns "not_offered_this_year" when the course-details page shows
    'אין נתונים מתאימים' (no matching data for 2025/2026).

    Returns:
      {
        'offered_semesters':   ['A'] | ['B'] | ['A','B'] | [],
        'offering_source':     'syllabus'|'course_details'|'both'|'none',
        'offering_confidence': 'high' | 'missing',
        'not_offered_this_year': bool,
      }
    """
    cd_text = sources.get('course_details_text') or ''
    sy_text = sources.get('syllabus_text') or ''

    # A course_details page that exists but reports no schedule data
    if cd_text and NO_DATA_RE.search(cd_text):
        return {
            'offered_semesters': [],
            'offering_source': 'course_details',
            'offering_confidence': 'missing',
            'not_offered_this_year': True,
        }

    sems_cd: list[str] = []
    sems_sy: list[str] = []

    if cd_text:
        sems_cd = sorted({HEB_TO_ENG[c] for c in SEMS_RE_CD.findall(cd_text) if c in HEB_TO_ENG})
    if sy_text:
        sems_sy = sorted({HEB_TO_ENG[c] for c in SEMS_RE_SY.findall(sy_text) if c in HEB_TO_ENG})

    combined = sorted(set(sems_cd) | set(sems_sy))

    if combined:
        if sems_cd and sems_sy:
            source = 'both'
        elif sems_sy:
            source = 'syllabus'
        else:
            source = 'course_details'
        return {
            'offered_semesters': combined,
            'offering_source': source,
            'offering_confidence': 'high',
            'not_offered_this_year': False,
        }

    return {
        'offered_semesters': [],
        'offering_source': 'none',
        'offering_confidence': 'missing',
        'not_offered_this_year': False,
    }


# ── Step 3: deriveEffectiveAllowedSemesters ───────────────────────────────────

def deriveEffectiveAllowedSemesters(offered_semesters: list[str]) -> list[str]:
    """
    Map offered_semesters (['A'], ['B'], or ['A','B']) to the set of legal
    planning-semester IDs used by the board.

      ['A']      -> ['year_3_semester_a', 'year_4_semester_a']
      ['B']      -> ['year_3_semester_b', 'year_4_semester_b']
      ['A','B']  -> all four
    """
    result: list[str] = []
    for sem in offered_semesters:
        result.extend(EFFECTIVE_SEMESTER_MAP.get(sem, []))
    return result


# ── Step 4: extractPrerequisites ─────────────────────────────────────────────

def extractPrerequisites(sources: dict) -> dict:
    """
    Extract prerequisite course IDs from the course_details HTML.

    The course-details page lists prerequisites as course IDs in the schedule
    table row for the course.  We extract all course-ID patterns that look like
    TAU faculty IDs and are not the course itself.

    Returns:
      {
        'prerequisite_course_ids': [str, ...],   # deduplicated, order-preserved
        'prerequisites_raw_text':  str,           # up to 800 chars of the section
      }
    """
    course_id = sources.get('course_id', '')
    cd_text = sources.get('course_details_text') or ''

    ids: list[str] = []
    seen: set[str] = set()
    for cid in COURSE_ID_RE.findall(cd_text):
        if cid == course_id:
            continue
        prefix = cid.split('-')[0]
        if prefix in TAU_PREFIXES and cid not in seen:
            seen.add(cid)
            ids.append(cid)

    return {
        'prerequisite_course_ids': ids,
        'prerequisites_raw_text': cd_text[:800] if cd_text else '',
    }


# ── Step 5: normalizeCourse ───────────────────────────────────────────────────

def normalizeCourse(course_id: str, repo_entry: dict) -> dict:
    """
    Produce a fully normalized course record for course_id.

    data_status values:
      complete             — has semester data and all required fields
      not_offered_this_year — explicitly marked as not offered in 2025/2026
      missing_source       — no HTML source found at all
    """
    sources = collectCourseSources(course_id)
    sem_info = extractSemesterOffering(sources)
    prereq_info = extractPrerequisites(sources)

    offered = sem_info['offered_semesters']
    effective = deriveEffectiveAllowedSemesters(offered)

    if sem_info['not_offered_this_year']:
        data_status = 'not_offered_this_year'
    elif not sources['course_details_path'] and not sources['syllabus_path']:
        data_status = 'missing_source'
    elif offered:
        data_status = 'complete'
    else:
        data_status = 'missing_source'

    return {
        'course_id': course_id,
        'course_name': repo_entry.get('course_name') or repo_entry.get('name_he') or '',
        'weekly_hours': repo_entry.get('weekly_hours') or repo_entry.get('semester_hours'),
        'category': repo_entry.get('category', ''),
        'prerequisites_raw_text': prereq_info['prerequisites_raw_text'],
        'prerequisite_course_ids': prereq_info['prerequisite_course_ids'],
        'offered_semesters': offered,
        'effective_allowed_semesters': effective,
        'offering_source': sem_info['offering_source'],
        'offering_confidence': sem_info['offering_confidence'],
        'not_offered_this_year': sem_info['not_offered_this_year'],
        'data_status': data_status,
    }


# ── Step 6: writeNormalizedCourseData ────────────────────────────────────────

def writeNormalizedCourseData() -> dict:
    """
    Normalize all repo electives and write the result to
    data/import_reports/normalized_courses_mechanical_2027.json.

    Returns the full audit dict (before + after + courses).
    """
    backup_path = BASE / 'supabase_board_backup_2027_pre_sync.json'
    backup = json.loads(backup_path.read_text(encoding='utf-8'))
    repo_courses: list[dict] = backup['metadata']['program_repository_courses']

    # Before state
    before_with_offered = sum(1 for c in repo_courses if c.get('offered_semesters'))
    before_with_effective = sum(1 for c in repo_courses if c.get('effective_allowed_semesters'))

    # Normalize every repo elective
    normalized: list[dict] = []
    for entry in sorted(repo_courses, key=lambda c: c['course_id']):
        normalized.append(normalizeCourse(entry['course_id'], entry))

    # After state
    after_with_offered = sum(1 for c in normalized if c['offered_semesters'])
    after_not_offered = sum(1 for c in normalized if c['not_offered_this_year'])
    after_with_effective = sum(1 for c in normalized if c['effective_allowed_semesters'])
    still_missing = sum(
        1 for c in normalized
        if not c['offered_semesters'] and not c['not_offered_this_year']
    )

    audit = {
        'pipeline_version': '1.0.0',
        'program': 'mechanical_engineering_2027',
        'source_directories': [
            'data/raw_html/course_details/ (68 files)',
            'data/raw_html/syllabus/ (60 files)',
        ],
        'before': {
            'total_repo_courses': len(repo_courses),
            'with_offered_semesters': before_with_offered,
            'with_effective_allowed_semesters': before_with_effective,
            'missing_semester_data': len(repo_courses) - before_with_offered,
        },
        'after': {
            'total_repo_courses': len(normalized),
            'with_offered_semesters': after_with_offered,
            'not_offered_this_year': after_not_offered,
            'with_effective_allowed_semesters': after_with_effective,
            'still_missing_semester_data': still_missing,
        },
        'courses': normalized,
    }

    out_path = BASE / 'data/import_reports/normalized_courses_mechanical_2027.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    return audit


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    result = writeNormalizedCourseData()
    b = result['before']
    a = result['after']
    fixed = a['with_offered_semesters'] - b['with_offered_semesters']

    print('=== Normalization pipeline — Mechanical Engineering 2027 ===')
    print()
    print(f"  Before: {b['with_offered_semesters']}/{b['total_repo_courses']} courses had semester data")
    print(f"  After:  {a['with_offered_semesters']}/{a['total_repo_courses']} courses have semester data")
    print(f"  Fixed:  +{fixed} courses now have offered_semesters")
    print(f"  Not offered this year: {a['not_offered_this_year']} (legitimately missing)")
    print(f"  Still missing: {a['still_missing_semester_data']} (unexpected — investigate)")
    print()

    # Per-course summary
    statuses = {}
    for c in result['courses']:
        statuses.setdefault(c['data_status'], []).append(c['course_id'])
    for status, ids in sorted(statuses.items()):
        print(f"  {status}: {len(ids)} courses")
        for cid in ids:
            print(f"    {cid}")

    print()
    out = BASE / 'data/import_reports/normalized_courses_mechanical_2027.json'
    print(f"  Output written to: {out}")
