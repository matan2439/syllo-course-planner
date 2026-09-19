import json
from pathlib import Path

from app.analysis.semester_board import _build_shaar_ruach_repository_courses


def test_program_rule_sets_every_shaar_ruach_course_to_two_weekly_hours(tmp_path):
    source = tmp_path / 'courses.json'
    source.write_text(json.dumps({'courses': [
        {'course_id': '0609-1005', 'credits': 2, 'offered_semesters': ['A']},
    ]}), encoding='utf-8')
    course = _build_shaar_ruach_repository_courses('shaar_ruach', 'שער רוח', source)[0]
    assert course['credits'] == 2
    assert course['weekly_hours'] == 2


def test_syllabus_verified_hours_are_preserved(tmp_path):
    source = tmp_path / 'courses.json'
    source.write_text(json.dumps({'courses': [
        {'course_id': '0609-1005', 'credits': 2, 'weekly_hours': 2,
         'weekly_hours_verified_from_syllabus': True,
         'syllabus_url': 'https://example.org/syllabus', 'offered_semesters': ['A']},
    ]}), encoding='utf-8')
    course = _build_shaar_ruach_repository_courses('shaar_ruach', 'שער רוח', source)[0]
    assert course['weekly_hours'] == 2


def test_bidit_verified_hours_are_preserved_without_a_syllabus_link(tmp_path):
    source = tmp_path / 'courses.json'
    source.write_text(json.dumps({'courses': [
        {'course_id': '0609-1002', 'credits': 2, 'weekly_hours': 2,
         'weekly_hours_verified_from_bidit': True,
         'offered_semesters': ['A']},
    ]}), encoding='utf-8')
    course = _build_shaar_ruach_repository_courses('shaar_ruach', 'שער רוח', source)[0]
    assert course['weekly_hours'] == 2


def test_shaar_ruach_catalog_is_shipped_to_the_planner_repository_with_two_hours():
    root = Path(__file__).resolve().parents[1]
    source_courses = json.loads(
        (root / 'data' / 'general_courses_shaar_ruach.json').read_text(encoding='utf-8')
    )['courses']
    board_courses = json.loads(
        (root / 'data' / 'boards' / 'mechanical_engineering_2027.json').read_text(encoding='utf-8')
    )['metadata']['program_repository_courses']

    shaar_ruach = [course for course in board_courses if course['category_id'] == 'shaar_ruach']
    assert len(shaar_ruach) == len(source_courses) == 88
    assert {course['program_category_name_he'] for course in shaar_ruach} == {'קורסי שער רוח'}
    assert all(course['weekly_hours'] == 2 for course in source_courses)
    assert all(course['weekly_hours'] == 2 for course in shaar_ruach)
