import json
import pytest
from pathlib import Path

from app.models.user_profile import UserProfile, load_user_profile
from app.database.db import init_db, save_merged_course
from app.analysis.elective_audit import audit_courses
from app.analysis.recommendation_engine import recommend_courses


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _course(course_id: str, **kwargs) -> dict:
    base = {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": None, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": [], "source_files": {},
    }
    base.update(kwargs)
    return base


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "profile_test.sqlite"
    init_db(db)
    return db


@pytest.fixture
def populated_db(tmp_db):
    save_merged_course(_course("FREE",  lecture_hours=2.0), tmp_db)
    save_merged_course(_course("GATED", prerequisite_course_ids=["FREE"],
                               lecture_hours=3.0, exam_info="final"), tmp_db)
    save_merged_course(_course("HEAVY", lecture_hours=8.0), tmp_db)
    return tmp_db


def _write_profile(tmp_path, data: dict) -> Path:
    p = tmp_path / "profile.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# load_user_profile — basic loading
# ---------------------------------------------------------------------------

def test_load_profile_valid(tmp_path):
    p = _write_profile(tmp_path, {
        "profile_name": "test_profile",
        "completed_course_ids": ["A", "B"],
        "max_difficulty": 3.0,
        "max_weekly_hours": 6.0,
    })
    profile = load_user_profile(p)
    assert profile.profile_name == "test_profile"
    assert profile.completed_course_ids == ["A", "B"]
    assert profile.max_difficulty == 3.0
    assert profile.max_weekly_hours == 6.0


def test_load_profile_defaults(tmp_path):
    p = _write_profile(tmp_path, {"profile_name": "minimal"})
    profile = load_user_profile(p)
    assert profile.completed_course_ids == []
    assert profile.preferred_topics == []
    assert profile.avoided_topics == []
    assert profile.max_difficulty is None
    assert profile.max_weekly_hours is None
    assert profile.target_specialization is None


def test_load_profile_file_not_found():
    with pytest.raises(FileNotFoundError):
        load_user_profile(Path("does_not_exist_xyz.json"))


def test_load_profile_string_path(tmp_path):
    p = _write_profile(tmp_path, {"profile_name": "str_path"})
    profile = load_user_profile(str(p))
    assert profile.profile_name == "str_path"


def test_load_profile_ignores_extra_fields(tmp_path):
    p = _write_profile(tmp_path, {
        "profile_name": "extra",
        "unknown_field": "should_be_ignored",
    })
    profile = load_user_profile(p)
    assert profile.profile_name == "extra"
    assert not hasattr(profile, "unknown_field")


def test_load_profile_target_specialization(tmp_path):
    p = _write_profile(tmp_path, {
        "profile_name": "spec",
        "target_specialization": "mechanical_electives",
    })
    profile = load_user_profile(p)
    assert profile.target_specialization == "mechanical_electives"


# ---------------------------------------------------------------------------
# UserProfile model
# ---------------------------------------------------------------------------

def test_profile_model_direct():
    profile = UserProfile(
        profile_name="direct",
        completed_course_ids=["X", "Y"],
        max_difficulty=2.5,
    )
    assert profile.max_difficulty == 2.5
    assert "X" in profile.completed_course_ids


def test_profile_max_weekly_hours_int(tmp_path):
    # max_weekly_hours=5 (int in JSON) should coerce to float
    p = _write_profile(tmp_path, {"profile_name": "t", "max_weekly_hours": 5})
    profile = load_user_profile(p)
    assert profile.max_weekly_hours == 5.0


# ---------------------------------------------------------------------------
# elective_audit uses profile completed_course_ids
# ---------------------------------------------------------------------------

def test_audit_profile_completed_unlocks_gated(populated_db):
    profile = UserProfile(profile_name="t", completed_course_ids=["FREE"])
    results = audit_courses(["GATED"], profile.completed_course_ids, db_path=populated_db)
    assert results[0]["status"] == "eligible"


def test_audit_no_profile_gated_stays_blocked(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    assert results[0]["status"] == "blocked"


def test_audit_profile_max_difficulty_filters(populated_db):
    profile = UserProfile(profile_name="t", max_difficulty=1.5)
    results = audit_courses(["HEAVY"], [], max_difficulty=profile.max_difficulty,
                            db_path=populated_db)
    assert results[0]["status"] == "filtered_out"


def test_audit_profile_max_weekly_hours_filters(populated_db):
    profile = UserProfile(profile_name="t", max_weekly_hours=4.0)
    results = audit_courses(["HEAVY"], [], max_weekly_hours=profile.max_weekly_hours,
                            db_path=populated_db)
    assert results[0]["status"] == "filtered_out"


# ---------------------------------------------------------------------------
# CLI flag overrides profile — tested via resolve logic
# ---------------------------------------------------------------------------

def _resolve(cli_val, profile_val):
    """Mirror the override logic used in the CLI blocks."""
    return cli_val if cli_val is not None else profile_val


def test_cli_overrides_profile_max_difficulty():
    assert _resolve(2.0, 3.5) == 2.0


def test_profile_used_when_cli_not_set():
    assert _resolve(None, 3.5) == 3.5


def test_neither_set_returns_none():
    assert _resolve(None, None) is None


def test_cli_overrides_profile_max_weekly_hours():
    assert _resolve(6.0, 10.0) == 6.0


def test_cli_zero_overrides_profile():
    # 0.0 is a valid (if extreme) explicit CLI override
    assert _resolve(0.0, 3.5) == 0.0


# ---------------------------------------------------------------------------
# recommendation_engine supports profile
# ---------------------------------------------------------------------------

def test_recommend_with_profile_completed(populated_db):
    profile = UserProfile(profile_name="t", completed_course_ids=["FREE"])
    results = recommend_courses(
        completed_course_ids=profile.completed_course_ids,
        db_path=populated_db,
    )
    # GATED requires FREE which is now completed → should appear
    course_ids = [r["course_id"] for r in results]
    assert "GATED" in course_ids


def test_recommend_with_profile_max_difficulty(populated_db):
    profile = UserProfile(profile_name="t", max_difficulty=1.0)
    results = recommend_courses(
        completed_course_ids=[],
        max_difficulty=profile.max_difficulty,
        db_path=populated_db,
    )
    for r in results:
        assert r["difficulty_score"] is None or r["difficulty_score"] <= 1.0


def test_recommend_with_profile_max_weekly_hours(populated_db):
    profile = UserProfile(profile_name="t", max_weekly_hours=3.0)
    results = recommend_courses(
        completed_course_ids=[],
        max_weekly_hours=profile.max_weekly_hours,
        db_path=populated_db,
    )
    for r in results:
        assert r["weekly_hours"] is None or r["weekly_hours"] <= 3.0


def test_recommend_excludes_completed_from_profile(populated_db):
    profile = UserProfile(profile_name="t", completed_course_ids=["FREE"])
    results = recommend_courses(
        completed_course_ids=profile.completed_course_ids,
        db_path=populated_db,
    )
    course_ids = [r["course_id"] for r in results]
    assert "FREE" not in course_ids


# ---------------------------------------------------------------------------
# Integration: example profile file
# ---------------------------------------------------------------------------

_EXAMPLE_PROFILE = Path("data/user_profiles/example_mechanical_profile.json")


@pytest.fixture
def example_profile():
    if not _EXAMPLE_PROFILE.exists():
        pytest.skip(f"Missing: {_EXAMPLE_PROFILE}")
    return load_user_profile(_EXAMPLE_PROFILE)


def test_example_profile_loads(example_profile):
    assert example_profile.profile_name == "mechanical_year_3_example"


def test_example_profile_has_completed(example_profile):
    assert len(example_profile.completed_course_ids) >= 1


def test_example_profile_has_max_difficulty(example_profile):
    assert example_profile.max_difficulty is not None


def test_example_profile_has_max_weekly_hours(example_profile):
    assert example_profile.max_weekly_hours is not None
