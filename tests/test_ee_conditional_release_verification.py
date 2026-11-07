import copy
import json
from pathlib import Path

import pytest

from app.degrees.checks.consistency import check_rules_enforced
from app.degrees.spec import load_spec


ROOT = Path(__file__).resolve().parents[1]
RULES = ['english-two-courses', 'cohort-spring-0512-4162', 'year-0509-4010', 'year-0512-3000',
         'cohort-0512-4013', 'load-min-75pct-approval', 'duration-extension', 'year-progression',
         'graduate-courses-max-2-per-semester', 'optional-high-current-pathway', 'labs-two-distinct-tracks',
         'technician-exemption-eligibility', 'additional-course-recognition']


def scenario(rule_id):
    spec = load_spec(ROOT / 'data/degrees/tau/electrical_engineering/2027/spec.json')
    rule = next(r for r in spec.course_rules if r.rule_id == rule_id)
    isolated = spec.model_copy(update={'course_rules': [rule]})
    boards = {key: json.loads((ROOT / f'data/boards/{name}_2027.json').read_text(encoding='utf-8'))
              for key, name in [('board', 'electrical_engineering'), ('early_years', 'electrical_engineering_years_1_2')]}
    return isolated, boards


@pytest.mark.parametrize('rule_id', RULES)
def test_conditional_rules_reach_both_windows_exactly(rule_id):
    spec, boards = scenario(rule_id)
    assert spec.course_rules[0].enforced_by == 'board'
    result = check_rules_enforced(spec, boards)
    assert result.passed, result.problems


@pytest.mark.parametrize('rule_id', RULES)
@pytest.mark.parametrize('window', ['board', 'early_years'])
def test_removed_or_widened_condition_fails_release(rule_id, window):
    spec, boards = scenario(rule_id)
    rules = boards[window]['metadata']['degree_rules']
    index = next(i for i, r in enumerate(rules) if r['rule_id'] == rule_id)
    original = copy.deepcopy(rules[index])
    rules[index]['params'] = {}
    assert not check_rules_enforced(spec, boards).passed
    rules[index] = original
    rules.pop(index)
    assert not check_rules_enforced(spec, boards).passed


def test_dropping_a_track_from_early_window_cannot_hide_supplementary_approval_requirement():
    spec, boards = scenario('additional-course-recognition')
    boards['early_years']['metadata']['degree_rule_track_course_ids'].pop()
    assert not check_rules_enforced(spec, boards).passed


def test_moving_a_mandatory_home_to_a_later_year_cannot_weaken_progression_in_early_window():
    spec, boards = scenario('year-progression')
    homes = boards['early_years']['metadata']['degree_rule_mandatory_semesters']
    first = next(iter(homes))
    homes[first] = 'year_6_semester_a'
    assert not check_rules_enforced(spec, boards).passed
