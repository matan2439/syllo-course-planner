import json
import pytest
from pathlib import Path

from app.analysis.course_plan_builder import build_course_plan, _rank_score


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _eligible(course_id, difficulty_score=2.0, weekly_hours=3.0, **kwargs):
    return {
        "course_id": course_id,
        "name_he": course_id,
        "status": "eligible",
        "difficulty_score": difficulty_score,
        "difficulty_level": "medium",
        "weekly_hours": weekly_hours,
        "missing_prerequisites": [],
        "satisfied_prerequisites": [],
        "reasons": [],
        **kwargs,
    }


def _blocked(course_id):
    return {
        "course_id": course_id,
        "name_he": course_id,
        "status": "blocked",
        "difficulty_score": 2.0,
        "difficulty_level": "medium",
        "weekly_hours": 3.0,
        "missing_prerequisites": ["X"],
        "satisfied_prerequisites": [],
        "reasons": [],
    }


def _no_db(tmp_path) -> Path:
    return tmp_path / "no.db"


# ---------------------------------------------------------------------------
# Excludes non-eligible
# ---------------------------------------------------------------------------

def test_excludes_blocked_courses(tmp_path):
    audit = [_eligible("A"), _blocked("B"), _eligible("C")]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    ids = [c["course_id"] for c in plan["selected_courses"]]
    assert "B" not in ids


def test_excludes_missing_from_db(tmp_path):
    audit = [
        _eligible("A"),
        {"course_id": "X", "status": "missing_from_db",
         "difficulty_score": None, "weekly_hours": None, "reasons": []},
    ]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    ids = [c["course_id"] for c in plan["selected_courses"]]
    assert "X" not in ids


def test_only_eligible_counted_in_total(tmp_path):
    audit = [_eligible("A"), _blocked("B")]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    assert plan["rejected_courses_summary"]["total_eligible"] == 1


def test_all_blocked_returns_empty_plan(tmp_path):
    plan = build_course_plan([_blocked("A"), _blocked("B")], db_path=_no_db(tmp_path))
    assert plan["selected_courses"] == []


def test_empty_audit_returns_empty_plan(tmp_path):
    plan = build_course_plan([], db_path=_no_db(tmp_path))
    assert plan["selected_courses"] == []
    assert plan["total_weekly_hours"] is None


# ---------------------------------------------------------------------------
# Limit
# ---------------------------------------------------------------------------

def test_respects_limit(tmp_path):
    audit = [_eligible(str(i)) for i in range(10)]
    plan = build_course_plan(audit, limit=3, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) <= 3


def test_limit_does_not_exclude_when_fewer_than_limit(tmp_path):
    audit = [_eligible(str(i)) for i in range(2)]
    plan = build_course_plan(audit, limit=5, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 2


def test_limit_rejection_reason_populated(tmp_path):
    audit = [_eligible(str(i)) for i in range(6)]
    plan = build_course_plan(audit, limit=3, db_path=_no_db(tmp_path))
    assert plan["rejected_courses_summary"]["rejection_reasons"]["limit_reached"] == 3


def test_limit_one_selects_best(tmp_path):
    audit = [_eligible("EASY", difficulty_score=1.0), _eligible("HARD", difficulty_score=4.0)]
    plan = build_course_plan(audit, limit=1, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 1


# ---------------------------------------------------------------------------
# Max total weekly hours
# ---------------------------------------------------------------------------

def test_respects_max_weekly_hours(tmp_path):
    audit = [_eligible(str(i), weekly_hours=4.0) for i in range(5)]
    plan = build_course_plan(audit, max_total_weekly_hours=10.0, db_path=_no_db(tmp_path))
    assert (plan["total_weekly_hours"] or 0.0) <= 10.0


def test_hours_budget_rejection_reason(tmp_path):
    audit = [_eligible(str(i), weekly_hours=4.0) for i in range(5)]
    plan = build_course_plan(audit, max_total_weekly_hours=10.0, limit=10,
                             db_path=_no_db(tmp_path))
    assert plan["rejected_courses_summary"]["rejection_reasons"]["over_hours_budget"] >= 1


def test_no_hours_budget_selects_up_to_limit(tmp_path):
    audit = [_eligible(str(i), weekly_hours=4.0) for i in range(3)]
    plan = build_course_plan(audit, max_total_weekly_hours=None, limit=5,
                             db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 3


def test_exact_budget_fit_selects_course(tmp_path):
    # Budget exactly matches one course — should be selected
    audit = [_eligible("A", weekly_hours=4.0)]
    plan = build_course_plan(audit, max_total_weekly_hours=4.0, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 1


def test_unknown_hours_not_charged_to_budget(tmp_path):
    # Course with weekly_hours=None should not consume budget
    audit = [_eligible("A", weekly_hours=None), _eligible("B", weekly_hours=4.0)]
    plan = build_course_plan(audit, max_total_weekly_hours=4.0, limit=5,
                             db_path=_no_db(tmp_path))
    ids = [c["course_id"] for c in plan["selected_courses"]]
    assert "A" in ids
    assert "B" in ids


# ---------------------------------------------------------------------------
# Max difficulty
# ---------------------------------------------------------------------------

def test_difficulty_filter_excludes_hard_courses(tmp_path):
    audit = [_eligible("EASY", difficulty_score=1.5), _eligible("HARD", difficulty_score=4.0)]
    plan = build_course_plan(audit, max_difficulty=3.0, db_path=_no_db(tmp_path))
    ids = [c["course_id"] for c in plan["selected_courses"]]
    assert "HARD" not in ids
    assert "EASY" in ids


def test_difficulty_filter_rejection_reason(tmp_path):
    audit = [_eligible("A", difficulty_score=1.5), _eligible("B", difficulty_score=4.0)]
    plan = build_course_plan(audit, max_difficulty=3.0, db_path=_no_db(tmp_path))
    assert plan["rejected_courses_summary"]["rejection_reasons"]["over_difficulty"] == 1


def test_no_difficulty_filter_includes_all(tmp_path):
    audit = [_eligible("A", difficulty_score=1.5), _eligible("B", difficulty_score=4.0)]
    plan = build_course_plan(audit, max_difficulty=None, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 2


def test_none_difficulty_score_not_filtered(tmp_path):
    # A course with difficulty_score=None should pass through the difficulty filter
    audit = [_eligible("A", difficulty_score=None)]
    plan = build_course_plan(audit, max_difficulty=2.0, db_path=_no_db(tmp_path))
    assert len(plan["selected_courses"]) == 1


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def test_ranks_lower_difficulty_first(tmp_path):
    audit = [_eligible("HARD", difficulty_score=3.5), _eligible("EASY", difficulty_score=1.0)]
    plan = build_course_plan(audit, limit=1, db_path=_no_db(tmp_path))
    assert plan["selected_courses"][0]["course_id"] == "EASY"


def test_rank_score_lower_difficulty_higher_score():
    easy = _eligible("E", difficulty_score=1.0)
    hard = _eligible("H", difficulty_score=4.0)
    assert _rank_score(easy, 0) > _rank_score(hard, 0)


def test_rank_score_unlocked_boosts_score():
    c = _eligible("X", difficulty_score=2.0)
    assert _rank_score(c, 3) > _rank_score(c, 0)


def test_rank_score_known_hours_preferred():
    with_hours    = _eligible("A", weekly_hours=3.0)
    without_hours = _eligible("B", weekly_hours=None)
    assert _rank_score(with_hours, 0) > _rank_score(without_hours, 0)


def test_rank_unlocked_beats_slightly_lower_difficulty(tmp_path):
    # Course with 5 unlocked beats one with difficulty 0.5 lower and no unlocks
    low_diff   = _eligible("LD", difficulty_score=1.5)
    high_unlk  = _eligible("HU", difficulty_score=2.0)
    assert _rank_score(high_unlk, 5) > _rank_score(low_diff, 0)


# ---------------------------------------------------------------------------
# Output structure
# ---------------------------------------------------------------------------

def test_output_has_all_keys(tmp_path):
    plan = build_course_plan([_eligible("A")], db_path=_no_db(tmp_path))
    assert {
        "selected_courses", "total_weekly_hours", "average_difficulty",
        "explanation", "rejected_courses_summary",
    } == set(plan.keys())


def test_selected_course_has_expected_fields(tmp_path):
    plan = build_course_plan([_eligible("A")], db_path=_no_db(tmp_path))
    c = plan["selected_courses"][0]
    assert {
        "course_id", "name_he", "difficulty_score", "difficulty_level",
        "weekly_hours", "unlocked_courses_count",
    } == set(c.keys())


def test_average_difficulty_computed(tmp_path):
    audit = [_eligible("A", difficulty_score=2.0), _eligible("B", difficulty_score=3.0)]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    assert plan["average_difficulty"] == pytest.approx(2.5)


def test_total_weekly_hours_summed(tmp_path):
    audit = [_eligible("A", weekly_hours=3.0), _eligible("B", weekly_hours=4.0)]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    assert plan["total_weekly_hours"] == pytest.approx(7.0)


def test_total_weekly_hours_none_when_all_unknown(tmp_path):
    audit = [_eligible("A", weekly_hours=None), _eligible("B", weekly_hours=None)]
    plan = build_course_plan(audit, db_path=_no_db(tmp_path))
    assert plan["total_weekly_hours"] is None


def test_explanation_is_non_empty_string(tmp_path):
    plan = build_course_plan([_eligible("A")], db_path=_no_db(tmp_path))
    assert isinstance(plan["explanation"], str)
    assert len(plan["explanation"]) > 0


def test_rejected_summary_structure(tmp_path):
    plan = build_course_plan([_eligible("A")], db_path=_no_db(tmp_path))
    rs = plan["rejected_courses_summary"]
    assert {"total_eligible", "not_selected", "rejection_reasons"} == set(rs.keys())
    assert {"over_difficulty", "over_hours_budget", "limit_reached"} == set(rs["rejection_reasons"].keys())


# ---------------------------------------------------------------------------
# Integration: real audit JSON
# ---------------------------------------------------------------------------

_REAL_AUDIT   = Path("data/parsed_json/mechanical_electives_profile_audit.json")
_REAL_PROFILE = Path("data/user_profiles/example_mechanical_profile.json")


@pytest.fixture
def real_audit():
    if not _REAL_AUDIT.exists():
        pytest.skip(f"Missing: {_REAL_AUDIT}")
    return json.loads(_REAL_AUDIT.read_text(encoding="utf-8"))


@pytest.fixture
def real_profile():
    if not _REAL_PROFILE.exists():
        pytest.skip(f"Missing: {_REAL_PROFILE}")
    from app.models.user_profile import load_user_profile
    return load_user_profile(_REAL_PROFILE)


def test_real_plan_selects_eligible_only(real_audit):
    plan = build_course_plan(real_audit, limit=5)
    for c in plan["selected_courses"]:
        match = next(r for r in real_audit if r["course_id"] == c["course_id"])
        assert match["status"] == "eligible"


def test_real_plan_respects_hours_budget(real_audit):
    plan = build_course_plan(real_audit, max_total_weekly_hours=12.0, limit=5)
    assert plan["total_weekly_hours"] is None or plan["total_weekly_hours"] <= 12.0


def test_real_plan_with_profile_difficulty(real_audit, real_profile):
    plan = build_course_plan(
        real_audit,
        max_difficulty=real_profile.max_difficulty,
        max_total_weekly_hours=12.0,
        limit=5,
    )
    for c in plan["selected_courses"]:
        if c["difficulty_score"] is not None and real_profile.max_difficulty is not None:
            assert c["difficulty_score"] <= real_profile.max_difficulty


def test_real_plan_count_within_limit(real_audit):
    plan = build_course_plan(real_audit, limit=3)
    assert len(plan["selected_courses"]) <= 3
