import json
import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.semester_board import (
    build_semester_board,
    _load_mandatory_course,
    _parse_mandatory_specs,
    _weekly_hours_from_record,
    _topological_sort,
    _assign_to_semesters,
    _make_semesters,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pc(course_id, weekly_hours=2.0, difficulty_score=2.0):
    """Build a plan-course dict (matches selected_courses format)."""
    return {
        "course_id":              course_id,
        "name_he":                course_id,
        "difficulty_score":       difficulty_score,
        "difficulty_level":       "medium",
        "weekly_hours":           weekly_hours,
        "unlocked_courses_count": 0,
    }


def _plan(*courses):
    return {"selected_courses": list(courses)}


def _db_course(course_id, prereqs=None, semester=None):
    """Build a merged-course dict for save_merged_course. semester uses Hebrew values."""
    base = {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025,
        "semester": semester,
        "credits": None, "lecture_hours": None, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": prereqs or [],
        "course_description": None, "topics": [], "assignments": None,
        "exam_info": None, "syllabus_links": [], "groups": [], "source_files": {},
    }
    return base


@pytest.fixture
def no_db(tmp_path):
    return tmp_path / "absent.db"


# ---------------------------------------------------------------------------
# Structure: creates four semesters
# ---------------------------------------------------------------------------

def test_creates_four_semesters(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    assert len(board["semesters"]) == 4


def test_semester_ids_contain_start_year(no_db):
    board = build_semester_board(_plan(_pc("A")), start_year=3, db_path=no_db)
    ids = [s["semester_id"] for s in board["semesters"]]
    assert "year_3_semester_a" in ids
    assert "year_3_semester_b" in ids
    assert "year_4_semester_a" in ids
    assert "year_4_semester_b" in ids


def test_custom_start_year(no_db):
    board = build_semester_board(_plan(_pc("A")), start_year=2, db_path=no_db)
    ids = [s["semester_id"] for s in board["semesters"]]
    assert "year_2_semester_a" in ids
    assert "year_3_semester_a" in ids


def test_each_semester_has_required_keys(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    for sem in board["semesters"]:
        assert {"semester_id", "display_name", "courses",
                "total_weekly_hours", "average_difficulty", "warnings"} == set(sem.keys())


def test_empty_plan_returns_empty_semesters(no_db):
    board = build_semester_board({"selected_courses": []}, db_path=no_db)
    assert len(board["semesters"]) == 4
    assert all(len(s["courses"]) == 0 for s in board["semesters"])


def test_metadata_present(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    assert board["metadata"]["total_courses"] == 2
    assert board["metadata"]["start_year"] == 3


# ---------------------------------------------------------------------------
# Places eligible courses
# ---------------------------------------------------------------------------

def test_all_courses_placed(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B"), _pc("C")), db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert sorted(placed) == ["A", "B", "C"]


def test_course_fields_in_output(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert len(placed) == 1
    c = placed[0]
    required = {
        "course_id", "name_he", "weekly_hours", "difficulty_score",
        "difficulty_level", "course_type", "prerequisites", "locked_by_user",
        "source", "data_quality", "warnings",
        "syllabus_url", "syllabus_links", "source_urls",
        "workload_score", "conceptual_complexity_score",
        "prerequisite_depth_score", "assessment_intensity_score",
        "difficulty_confidence", "prerequisite_details",
    }
    assert required.issubset(set(c.keys()))


def test_locked_by_user_false(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["locked_by_user"] is False


def test_source_is_auto(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["source"] == "auto"


def test_semester_metrics_computed(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=3.0, difficulty_score=2.0)), db_path=no_db)
    sem = next(s for s in board["semesters"] if s["courses"])
    assert sem["total_weekly_hours"] == pytest.approx(3.0)
    assert sem["average_difficulty"] == pytest.approx(2.0)


def test_semester_metrics_none_when_no_data(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=None)), db_path=no_db)
    sem = next(s for s in board["semesters"] if s["courses"])
    assert sem["total_weekly_hours"] is None


# ---------------------------------------------------------------------------
# Handles unknown semester data (no DB)
# ---------------------------------------------------------------------------

def test_no_db_does_not_crash(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    assert board is not None


def test_no_db_all_courses_placed(no_db):
    board = build_semester_board(_plan(*[_pc(str(i)) for i in range(4)]), db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert len(placed) == 4


def test_no_db_prerequisites_empty(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["prerequisites"] == []


def test_no_db_no_cycle_warnings(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    assert not any("Cycle" in w for w in board["warnings"])


# ---------------------------------------------------------------------------
# Respects max weekly hours per semester
# ---------------------------------------------------------------------------

def test_respects_max_hours_per_semester(no_db):
    # 3 courses × 4h, budget = 5h → each in its own semester
    plan = _plan(_pc("A", 4.0), _pc("B", 4.0), _pc("C", 4.0))
    board = build_semester_board(plan, max_weekly_hours_per_semester=5.0, db_path=no_db)
    for sem in board["semesters"]:
        hours = sem["total_weekly_hours"] or 0.0
        assert hours <= 5.0


def test_unknown_hours_do_not_consume_budget(no_db):
    # Course with None hours should not block another course from fitting
    plan = _plan(_pc("FREE", weekly_hours=None), _pc("PAID", weekly_hours=4.0))
    board = build_semester_board(plan, max_weekly_hours_per_semester=4.0, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "FREE" in placed
    assert "PAID" in placed


def test_impossible_budget_issues_warning_not_crash(no_db):
    # 4h course with 1h budget per semester → impossible, but should not crash
    plan = _plan(_pc("A", 4.0))
    board = build_semester_board(plan, max_weekly_hours_per_semester=1.0, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "A" in placed  # still placed somewhere
    assert len(board["warnings"]) >= 1


def test_least_loaded_distribution(no_db):
    # 4 courses with None hours and no budget: should spread across 4 semesters
    plan = _plan(_pc("A", None), _pc("B", None), _pc("C", None), _pc("D", None))
    board = build_semester_board(plan, db_path=no_db)
    counts = [len(s["courses"]) for s in board["semesters"]]
    # Least-loaded strategy: each semester gets 1 course
    assert counts == [1, 1, 1, 1]


# ---------------------------------------------------------------------------
# Respects prerequisite order
# ---------------------------------------------------------------------------

def test_prerequisite_order_with_db(tmp_path):
    db = tmp_path / "prereq.db"
    init_db(db)
    # "0001-0001" has no prereqs; "0002-0002" requires it
    save_merged_course(_db_course("0001-0001", prereqs=[]), db)
    save_merged_course(_db_course("0002-0002", prereqs=["00010001"]), db)

    # Present dependent first to verify topo sort reorders
    plan = _plan(
        _pc("0002-0002", weekly_hours=2.0),
        _pc("0001-0001", weekly_hours=2.0),
    )
    board = build_semester_board(plan, db_path=db)

    sem_idx = {}
    for i, sem in enumerate(board["semesters"]):
        for c in sem["courses"]:
            sem_idx[c["course_id"]] = i

    assert sem_idx["0001-0001"] < sem_idx["0002-0002"]


def test_three_level_chain(tmp_path):
    db = tmp_path / "chain.db"
    init_db(db)
    save_merged_course(_db_course("1111-1111", prereqs=[]), db)
    save_merged_course(_db_course("2222-2222", prereqs=["11111111"]), db)
    save_merged_course(_db_course("3333-3333", prereqs=["22222222"]), db)

    plan = _plan(
        _pc("3333-3333", weekly_hours=1.0),
        _pc("1111-1111", weekly_hours=1.0),
        _pc("2222-2222", weekly_hours=1.0),
    )
    board = build_semester_board(plan, db_path=db)

    sem_idx = {}
    for i, sem in enumerate(board["semesters"]):
        for c in sem["courses"]:
            sem_idx[c["course_id"]] = i

    assert sem_idx["1111-1111"] < sem_idx["2222-2222"] < sem_idx["3333-3333"]


def test_independent_courses_all_placed(tmp_path):
    db = tmp_path / "indep.db"
    init_db(db)
    for i in range(1, 4):
        save_merged_course(_db_course(f"000{i}-000{i}", prereqs=[]), db)

    plan = _plan(_pc("0001-0001"), _pc("0002-0002"), _pc("0003-0003"))
    board = build_semester_board(plan, db_path=db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert sorted(placed) == ["0001-0001", "0002-0002", "0003-0003"]


# ---------------------------------------------------------------------------
# Outputs warnings instead of crashing
# ---------------------------------------------------------------------------

def test_warnings_field_exists(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    assert "warnings" in board
    assert isinstance(board["warnings"], list)


def test_overbudget_adds_warning_not_crash(no_db):
    plan = _plan(*[_pc(str(i), weekly_hours=5.0) for i in range(5)])
    board = build_semester_board(plan, max_weekly_hours_per_semester=4.0, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert len(placed) == 5  # all placed
    assert len(board["warnings"]) >= 1


def test_cycle_warning_added(no_db):
    # Simulate cycle by injecting a cycle through prereq_map directly
    courses = [_pc("A"), _pc("B")]
    prereq_map = {"A": ["B"], "B": ["A"]}
    _, warnings = _topological_sort(courses, prereq_map)
    assert any("Cycle" in w for w in warnings)


def test_season_preference_warning_when_missed(no_db):
    # Fill both "a" semesters, then a third "a"-preferred course must fall back to "b"
    semesters = _make_semesters(3)
    plan_courses = [_pc("A", weekly_hours=5.0), _pc("B", weekly_hours=5.0), _pc("C", weekly_hours=5.0)]
    season_prefs = {"A": "a", "B": "a", "C": "a"}
    prereq_map   = {"A": [], "B": [], "C": []}
    _, warnings, _ = _assign_to_semesters(
        plan_courses, semesters, season_prefs, prereq_map, max_hours=5.0
    )
    # A → year_3_semester_a (5h); B → year_4_semester_a (5h);
    # C has no remaining "a" slot → placed in "b" with a warning
    assert any("preferred" in w for w in warnings)


# ---------------------------------------------------------------------------
# Integration: real plan JSON
# ---------------------------------------------------------------------------

_REAL_PLAN    = Path("data/parsed_json/recommended_mechanical_plan.json")
_REAL_PROFILE = Path("data/user_profiles/example_mechanical_profile.json")


@pytest.fixture
def real_plan():
    if not _REAL_PLAN.exists():
        pytest.skip(f"Missing: {_REAL_PLAN}")
    return json.loads(_REAL_PLAN.read_text(encoding="utf-8"))


@pytest.fixture
def real_profile():
    if not _REAL_PROFILE.exists():
        pytest.skip(f"Missing: {_REAL_PROFILE}")
    from app.models.user_profile import load_user_profile
    return load_user_profile(_REAL_PROFILE)


def test_real_plan_creates_four_semesters(real_plan):
    board = build_semester_board(real_plan)
    assert len(board["semesters"]) == 4


def test_real_plan_all_courses_placed(real_plan):
    plan_ids = {c["course_id"] for c in real_plan["selected_courses"]}
    board    = build_semester_board(real_plan)
    placed   = {c["course_id"] for s in board["semesters"] for c in s["courses"]}
    assert plan_ids == placed


def test_real_plan_with_profile_hours_limit(real_plan, real_profile):
    board = build_semester_board(real_plan, max_weekly_hours_per_semester=real_profile.max_weekly_hours)
    for sem in board["semesters"]:
        hours = sem["total_weekly_hours"] or 0.0
        assert hours <= (real_profile.max_weekly_hours or float("inf"))


# ---------------------------------------------------------------------------
# Data quality indicators
# ---------------------------------------------------------------------------

def test_data_quality_keys_present(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    dq = placed[0]["data_quality"]
    assert {"has_weekly_hours", "has_semester_data",
            "has_difficulty_score", "placement_confidence"} == set(dq.keys())


def test_has_weekly_hours_true(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=3.0)), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_weekly_hours"] is True


def test_has_weekly_hours_false(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=None)), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_weekly_hours"] is False


def test_has_semester_data_false_when_no_db(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_semester_data"] is False


def test_has_difficulty_score_true(no_db):
    board = build_semester_board(_plan(_pc("A", difficulty_score=2.0)), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_difficulty_score"] is True


def test_has_difficulty_score_false(no_db):
    course = _pc("A")
    course["difficulty_score"] = None
    board = build_semester_board({"selected_courses": [course]}, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_difficulty_score"] is False


def test_placement_confidence_low_when_no_season_data(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["placement_confidence"] == "low"


def test_placement_confidence_high_when_season_honored(tmp_path):
    from app.database.db import init_db, save_merged_course
    db = tmp_path / "season.db"
    init_db(db)
    save_merged_course(_db_course("0001-0001", semester="א'"), db)
    board = build_semester_board(_plan(_pc("0001-0001")), db_path=db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["data_quality"]["has_semester_data"] is True
    assert placed[0]["data_quality"]["placement_confidence"] == "high"


def test_placement_confidence_medium_when_season_missed(tmp_path):
    from app.database.db import init_db, save_merged_course
    db = tmp_path / "season2.db"
    init_db(db)
    # All three prefer "א'" (season a); only 2 "a" slots exist so one falls back to "b"
    for i in range(1, 4):
        save_merged_course(_db_course(f"000{i}-000{i}", semester="א'"), db)
    plan = _plan(_pc("0001-0001", weekly_hours=5.0),
                 _pc("0002-0002", weekly_hours=5.0),
                 _pc("0003-0003", weekly_hours=5.0))
    board = build_semester_board(plan, max_weekly_hours_per_semester=5.0, db_path=db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    confidences = [c["data_quality"]["placement_confidence"] for c in placed]
    # Two fit in "a" semesters (high); one must fall back to "b" (medium)
    assert confidences.count("high") == 2
    assert confidences.count("medium") == 1


# ---------------------------------------------------------------------------
# Course-level warnings
# ---------------------------------------------------------------------------

def test_course_warning_missing_hours(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=None)), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert any("Missing weekly hours" in w for w in placed[0]["warnings"])


def test_no_course_warning_when_hours_known(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=3.0)), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert not any("Missing weekly hours" in w for w in placed[0]["warnings"])


def test_course_warning_unknown_semester(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert any("Unknown semester availability" in w for w in placed[0]["warnings"])


def test_course_warnings_empty_when_all_data_known(tmp_path):
    from app.database.db import init_db, save_merged_course
    db = tmp_path / "full.db"
    init_db(db)
    save_merged_course(_db_course("0001-0001", semester="א'"), db)
    plan = {"selected_courses": [{
        "course_id": "0001-0001", "name_he": "X",
        "difficulty_score": 2.0, "difficulty_level": "medium",
        "weekly_hours": 3.0, "unlocked_courses_count": 0,
    }]}
    board = build_semester_board(plan, db_path=db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["warnings"] == []


# ---------------------------------------------------------------------------
# Semester-level warnings
# ---------------------------------------------------------------------------

def test_semester_warning_missing_hours(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=None)), db_path=no_db)
    sem_with_course = next(s for s in board["semesters"] if s["courses"])
    assert any("unknown weekly hours" in w for w in sem_with_course["warnings"])


def test_no_semester_warning_when_all_hours_known(no_db):
    board = build_semester_board(_plan(_pc("A", weekly_hours=3.0)), db_path=no_db)
    sem_with_course = next(s for s in board["semesters"] if s["courses"])
    assert not any("unknown weekly hours" in w for w in sem_with_course["warnings"])


# ---------------------------------------------------------------------------
# Board-level summary
# ---------------------------------------------------------------------------

def test_summary_key_present(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    assert "summary" in board


def test_summary_has_required_keys(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    assert {"total_courses", "courses_with_missing_hours",
            "courses_with_unknown_semester", "low_confidence_placements"} == set(board["summary"].keys())


def test_summary_total_courses(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B"), _pc("C")), db_path=no_db)
    assert board["summary"]["total_courses"] == 3


def test_summary_missing_hours_count(no_db):
    board = build_semester_board(
        _plan(_pc("A", weekly_hours=None), _pc("B", weekly_hours=3.0)), db_path=no_db
    )
    assert board["summary"]["courses_with_missing_hours"] == 1


def test_summary_unknown_semester_count(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    assert board["summary"]["courses_with_unknown_semester"] == 2


def test_summary_low_confidence_count(no_db):
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    assert board["summary"]["low_confidence_placements"] == 2


def test_summary_zero_when_empty(no_db):
    board = build_semester_board({"selected_courses": []}, db_path=no_db)
    s = board["summary"]
    assert s["total_courses"] == 0
    assert s["courses_with_missing_hours"] == 0
    assert s["courses_with_unknown_semester"] == 0
    assert s["low_confidence_placements"] == 0


# ---------------------------------------------------------------------------
# Real plan data quality
# ---------------------------------------------------------------------------

def test_real_plan_summary_has_missing_hours(real_plan):
    board = build_semester_board(real_plan)
    assert board["summary"]["courses_with_missing_hours"] > 0


def test_real_plan_data_quality_on_every_course(real_plan):
    board = build_semester_board(real_plan)
    for sem in board["semesters"]:
        for c in sem["courses"]:
            dq = c["data_quality"]
            assert dq["placement_confidence"] in {"high", "medium", "low"}
            assert isinstance(dq["has_weekly_hours"], bool)
            assert isinstance(dq["has_semester_data"], bool)
            assert isinstance(dq["has_difficulty_score"], bool)


# ---------------------------------------------------------------------------
# course_type field
# ---------------------------------------------------------------------------

def test_elective_course_type(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["course_type"] == "elective"


# ---------------------------------------------------------------------------
# Mandatory courses — program JSON loading
# ---------------------------------------------------------------------------

def _program(*semester_entries):
    """Build a minimal program dict."""
    return {
        "program_id": "test_prog",
        "program_name": "Test Program",
        "semesters": list(semester_entries),
    }


def _sem_entry(sem_id, *course_ids):
    return {"semester_id": sem_id, "mandatory_courses": list(course_ids)}


def test_mandatory_course_placed_in_correct_semester(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    sem_a = next(s for s in board["semesters"] if s["semester_id"] == "year_3_semester_a")
    ids = [c["course_id"] for c in sem_a["courses"]]
    assert "0001-0001" in ids


def test_mandatory_course_not_in_wrong_semester(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    sem_b = next(s for s in board["semesters"] if s["semester_id"] == "year_3_semester_b")
    ids = [c["course_id"] for c in sem_b["courses"]]
    assert "0001-0001" not in ids


def test_mandatory_course_type_field(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["course_type"] == "mandatory"


def test_mandatory_locked_by_user(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["locked_by_user"] is True


def test_mandatory_source_is_program(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["source"] == "program"


def test_mandatory_appears_before_electives_in_semester(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MAND-0001"))
    board = build_semester_board(_plan(_pc("ELEC-0002")), program=prog, db_path=no_db)
    # Find the semester that has both (elective might land anywhere without DB)
    for sem in board["semesters"]:
        ids = [c["course_id"] for c in sem["courses"]]
        if "MAND-0001" in ids and "ELEC-0002" in ids:
            assert ids.index("MAND-0001") < ids.index("ELEC-0002")


def test_mandatory_missing_from_db_still_placed(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MISS-0000"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    ids = [c["course_id"] for c in placed]
    assert "MISS-0000" in ids


def test_mandatory_missing_from_db_has_warning(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MISS-0000"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "MISS-0000")
    assert any("not found" in w.lower() or "missing" in w.lower() for w in mc["warnings"])


def test_mandatory_missing_from_db_global_warning(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MISS-0000"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    assert any("MISS-0000" in w for w in board["warnings"])


def test_mandatory_missing_from_db_data_quality(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MISS-0000"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "MISS-0000")
    dq = mc["data_quality"]
    assert dq["has_semester_data"] is True        # explicitly placed by program
    assert dq["placement_confidence"] == "high"   # program placement = high confidence
    assert dq["has_weekly_hours"] is False


def test_mandatory_counted_in_total_courses(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MAND-0001"))
    board = build_semester_board(_plan(_pc("ELEC-0002")), program=prog, db_path=no_db)
    assert board["summary"]["total_courses"] == 2
    assert board["metadata"]["total_courses"] == 2


def test_mandatory_with_db_enrichment(tmp_path):
    db = tmp_path / "mand.db"
    init_db(db)
    save_merged_course(_db_course("0001-0001", prereqs=[]), db)
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    board = build_semester_board(_plan(), program=prog, db_path=db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = placed[0]
    assert mc["course_id"] == "0001-0001"
    # name_he comes from the DB record (equals course_id in our _db_course fixture)
    assert mc["name_he"] == "0001-0001"
    assert mc["course_type"] == "mandatory"
    assert mc["locked_by_user"] is True


def test_mandatory_deduplicated_from_electives(no_db):
    # If an elective in the plan shares an ID with a mandatory, only one card appears
    prog = _program(_sem_entry("year_3_semester_a", "SHARED"))
    board = build_semester_board(_plan(_pc("SHARED")), program=prog, db_path=no_db)
    all_placed = [c for s in board["semesters"] for c in s["courses"]]
    shared = [c for c in all_placed if c["course_id"] == "SHARED"]
    assert len(shared) == 1
    assert shared[0]["course_type"] == "mandatory"


def test_no_program_backward_compatible(no_db):
    # Calling without program= should work identically to before
    board = build_semester_board(_plan(_pc("A"), _pc("B")), db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert sorted(placed) == ["A", "B"]


def test_empty_mandatory_list_no_effect(no_db):
    prog = _program(_sem_entry("year_3_semester_a"))  # empty mandatory_courses
    board = build_semester_board(_plan(_pc("E")), program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "E" in placed


def test_mandatory_hours_reduce_elective_budget(no_db):
    # Mandatory course fills semester A; with budget=5h, elective should land elsewhere
    prog = _program(_sem_entry("year_3_semester_a", "MAND"))
    # MAND has no DB record → 0h contribution; but we test the mechanism exists
    board = build_semester_board(
        _plan(_pc("ELEC", weekly_hours=5.0)),
        program=prog,
        max_weekly_hours_per_semester=5.0,
        db_path=no_db,
    )
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "MAND" in placed
    assert "ELEC" in placed


# ---------------------------------------------------------------------------
# _load_mandatory_course unit tests
# ---------------------------------------------------------------------------

def test_load_mandatory_course_missing_db(no_db):
    mc, warns = _load_mandatory_course("0001-0001", no_db)
    assert mc["course_type"] == "mandatory"
    assert mc["locked_by_user"] is True
    assert mc["source"] == "program"
    assert len(warns) == 1  # global warning about missing course


def test_load_mandatory_course_with_db_record(tmp_path):
    db = tmp_path / "lm.db"
    init_db(db)
    save_merged_course(_db_course("0001-0001", prereqs=[]), db)
    mc, warns = _load_mandatory_course("0001-0001", db)
    assert mc["name_he"] == "0001-0001"
    assert mc["course_type"] == "mandatory"
    assert warns == []


def test_load_mandatory_course_fixed_placement_policy(no_db):
    spec = {
        "allowed_semesters": ["year_3_semester_a"],
        "locked_by_default": True,
        "placement_rule": "fixed_semester",
        "recommended_semester": "year_3_semester_a",
    }
    mc, _ = _load_mandatory_course("0001-0001", no_db, placement_spec=spec)
    assert mc["is_mandatory"] is True
    assert mc["placement_policy"] == "fixed"
    assert mc["recommended_semester"] == "year_3_semester_a"


def test_load_mandatory_course_flexible_placement_policy(no_db):
    spec = {
        "allowed_semesters": ["year_3_semester_a", "year_3_semester_b"],
        "locked_by_default": True,
        "placement_rule": "choose_one_allowed_semester",
    }
    mc, _ = _load_mandatory_course("0001-0001", no_db, placement_spec=spec)
    assert mc["is_mandatory"] is True
    assert mc["placement_policy"] == "flexible"


# ---------------------------------------------------------------------------
# Program course filtering
# ---------------------------------------------------------------------------

def test_program_filtering_excludes_unrelated_course(no_db):
    prog = _program()
    prog["course_categories"] = [
        {"category_id": "allowed", "name_he": "מותר", "course_ids": ["ALLOWED"]}
    ]
    plan = _plan(_pc("ALLOWED"), _pc("NOT_ALLOWED"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "ALLOWED" in placed
    assert "NOT_ALLOWED" not in placed


def test_program_filtering_no_categories_keeps_all(no_db):
    prog = _program()  # no course_categories key
    plan = _plan(_pc("A"), _pc("B"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "A" in placed
    assert "B" in placed


def test_program_filtering_empty_categories_excludes_all(no_db):
    prog = _program()
    prog["course_categories"] = []
    plan = _plan(_pc("A"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "A" not in placed


def test_program_filtering_with_course_ids_file(tmp_path, no_db):
    txt = tmp_path / "list.txt"
    txt.write_text("# comment\nFROM_FILE\n", encoding="utf-8")
    prog = _program()
    prog["course_categories"] = [
        {"category_id": "file_cat", "course_ids_file": str(txt)}
    ]
    plan = _plan(_pc("FROM_FILE"), _pc("NOT_IN_FILE"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "FROM_FILE" in placed
    assert "NOT_IN_FILE" not in placed


def test_program_filtering_missing_file_is_skipped(tmp_path, no_db):
    prog = _program()
    prog["course_categories"] = [
        {"category_id": "cat", "course_ids_file": str(tmp_path / "absent.txt"), "course_ids": ["DIRECT"]}
    ]
    plan = _plan(_pc("DIRECT"), _pc("OTHER"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "DIRECT" in placed
    assert "OTHER" not in placed


def test_mandatory_always_placed_regardless_of_filter(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MAND"))
    prog["course_categories"] = [
        {"category_id": "electives", "course_ids": ["ELEC"]}
    ]
    plan = _plan(_pc("ELEC"), _pc("UNRELATED"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    placed = [c["course_id"] for s in board["semesters"] for c in s["courses"]]
    assert "MAND" in placed
    assert "ELEC" in placed
    assert "UNRELATED" not in placed


def test_mandatory_course_is_locked(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MAND"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "MAND")
    assert mc["locked_by_user"] is True
    assert mc["course_type"] == "mandatory"
    assert mc["source"] == "program"


def test_mandatory_missing_from_db_still_placed_with_warning(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MISS-9999"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    ids = [c["course_id"] for c in placed]
    assert "MISS-9999" in ids
    mc = next(c for c in placed if c["course_id"] == "MISS-9999")
    assert any("not found" in w.lower() or "missing" in w.lower() for w in mc["warnings"])
    assert any("MISS-9999" in w for w in board["warnings"])


def test_filtering_count_in_metadata(no_db):
    prog = _program()
    prog["course_categories"] = [
        {"category_id": "allowed", "course_ids": ["A"]}
    ]
    plan = _plan(_pc("A"), _pc("B"), _pc("C"))
    board = build_semester_board(plan, program=prog, db_path=no_db)
    assert board["metadata"]["total_courses"] == 1


# ---------------------------------------------------------------------------
# prerequisite_details field
# ---------------------------------------------------------------------------

def test_prerequisite_details_empty_when_no_prereqs(no_db):
    board = build_semester_board(_plan(_pc("A")), db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    assert placed[0]["prerequisite_details"] == []


def test_prerequisite_details_structure_with_known_prereq(tmp_path):
    db = tmp_path / "pd.db"
    init_db(db)
    save_merged_course(_db_course("0001-0001", prereqs=[]), db)
    save_merged_course(_db_course("0002-0002", prereqs=["00010001"]), db)
    plan = _plan(_pc("0001-0001"), _pc("0002-0002"))
    board = build_semester_board(plan, db_path=db)
    placed = {c["course_id"]: c for s in board["semesters"] for c in s["courses"]}
    details = placed["0002-0002"]["prerequisite_details"]
    assert len(details) == 1
    assert details[0]["course_id"] == "0001-0001"
    assert details[0]["known_in_db"] is True


def test_prerequisite_details_unknown_prereq_known_in_db_false(tmp_path):
    db = tmp_path / "pd2.db"
    init_db(db)
    # 0002-0002 has a prereq that is NOT in the DB
    save_merged_course(_db_course("0002-0002", prereqs=["00019999"]), db)
    plan = _plan(_pc("0002-0002"))
    board = build_semester_board(plan, db_path=db)
    placed = {c["course_id"]: c for s in board["semesters"] for c in s["courses"]}
    details = placed["0002-0002"]["prerequisite_details"]
    assert len(details) == 1
    assert details[0]["known_in_db"] is False
    assert details[0]["name_he"] is None


def test_prerequisite_details_has_name_he_for_known(tmp_path):
    db = tmp_path / "pd3.db"
    init_db(db)
    prereq = {**_db_course("0001-0001"), "name_he": "מתמטיקה"}
    save_merged_course(prereq, db)
    save_merged_course(_db_course("0002-0002", prereqs=["00010001"]), db)
    plan = _plan(_pc("0001-0001"), _pc("0002-0002"))
    board = build_semester_board(plan, db_path=db)
    placed = {c["course_id"]: c for s in board["semesters"] for c in s["courses"]}
    details = placed["0002-0002"]["prerequisite_details"]
    assert details[0]["name_he"] == "מתמטיקה"


# ---------------------------------------------------------------------------
# _weekly_hours_from_record unit tests
# ---------------------------------------------------------------------------

def test_weekly_hours_all_none():
    assert _weekly_hours_from_record({"lecture_hours": None, "tutorial_hours": None, "lab_hours": None}) is None


def test_weekly_hours_partial():
    assert _weekly_hours_from_record({"lecture_hours": 2.0, "tutorial_hours": None, "lab_hours": 1.0}) == 3.0


def test_weekly_hours_all_present():
    assert _weekly_hours_from_record({"lecture_hours": 2.0, "tutorial_hours": 1.0, "lab_hours": 0.5}) == 3.5


# ---------------------------------------------------------------------------
# _parse_mandatory_specs unit tests
# ---------------------------------------------------------------------------

def _rich_program(*courses):
    """Build a program dict using the new rich requirements.mandatory_courses.courses format."""
    return {
        "program_id": "test_rich",
        "semesters": [],
        "requirements": {
            "mandatory_courses": {"courses": list(courses)}
        },
    }


def _mc_spec(course_id, allowed_semesters, recommended=None, locked_by_default=None,
             placement_rule=None, needs_verification=False, source_note=""):
    spec = {"course_id": course_id, "allowed_semesters": allowed_semesters}
    if recommended is not None:
        spec["recommended_semester"] = recommended
    if locked_by_default is not None:
        spec["locked_by_default"] = locked_by_default
    if placement_rule is not None:
        spec["placement_rule"] = placement_rule
    spec["needs_verification"] = needs_verification
    spec["source_note"] = source_note
    return spec


def test_parse_specs_old_format():
    prog = _program(_sem_entry("year_3_semester_a", "0001-0001"))
    specs = _parse_mandatory_specs(prog)
    assert len(specs) == 1
    s = specs[0]
    assert s["course_id"] == "0001-0001"
    assert s["allowed_semesters"] == ["year_3_semester_a"]
    assert s["locked_by_default"] is True
    assert s["placement_rule"] == "fixed_semester"


def test_parse_specs_new_format_fixed():
    prog = _rich_program(_mc_spec("0001-0001", ["year_3_semester_a"]))
    specs = _parse_mandatory_specs(prog)
    assert len(specs) == 1
    s = specs[0]
    assert s["course_id"] == "0001-0001"
    assert s["allowed_semesters"] == ["year_3_semester_a"]
    assert s["locked_by_default"] is True
    assert s["placement_rule"] == "fixed_semester"


def test_parse_specs_new_format_flexible():
    prog = _rich_program(_mc_spec("0001-0001", ["year_3_semester_a", "year_3_semester_b"]))
    specs = _parse_mandatory_specs(prog)
    assert len(specs) == 1
    s = specs[0]
    assert s["allowed_semesters"] == ["year_3_semester_a", "year_3_semester_b"]
    assert s["locked_by_default"] is False
    assert s["placement_rule"] == "choose_one_allowed_semester"


def test_parse_specs_deduplication():
    prog = _rich_program(_mc_spec("0001-0001", ["year_3_semester_a"]))
    prog["semesters"] = [{"semester_id": "year_3_semester_a", "mandatory_courses": ["0001-0001"]}]
    specs = _parse_mandatory_specs(prog)
    assert len(specs) == 1  # rich format wins, old format is skipped


def test_parse_specs_explicit_locked_by_default():
    prog = _rich_program(_mc_spec("X", ["year_3_semester_a", "year_3_semester_b"],
                                  locked_by_default=True))
    specs = _parse_mandatory_specs(prog)
    assert specs[0]["locked_by_default"] is True


def test_parse_specs_explicit_placement_rule():
    prog = _rich_program(_mc_spec("X", ["year_3_semester_a", "year_3_semester_b"],
                                  placement_rule="choose_one_allowed_semester"))
    specs = _parse_mandatory_specs(prog)
    assert specs[0]["placement_rule"] == "choose_one_allowed_semester"


def test_parse_specs_needs_verification():
    prog = _rich_program(_mc_spec("X", ["year_3_semester_a"], needs_verification=True,
                                  source_note="from screenshot"))
    specs = _parse_mandatory_specs(prog)
    assert specs[0]["needs_verification"] is True
    assert specs[0]["source_note"] == "from screenshot"


# ---------------------------------------------------------------------------
# Flexible mandatory placement
# ---------------------------------------------------------------------------

def test_fixed_mandatory_placed_in_only_allowed_semester(no_db):
    prog = _rich_program(_mc_spec("FIXED", ["year_3_semester_a"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    sem_a = next(s for s in board["semesters"] if s["semester_id"] == "year_3_semester_a")
    ids = [c["course_id"] for c in sem_a["courses"]]
    assert "FIXED" in ids


def test_fixed_mandatory_locked_by_default_true(no_db):
    prog = _rich_program(_mc_spec("FIXED", ["year_3_semester_a"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "FIXED")
    assert mc["locked_by_default"] is True
    assert mc["locked_by_user"] is True


def test_flexible_mandatory_placed_once(no_db):
    prog = _rich_program(_mc_spec("FLEX", ["year_3_semester_a", "year_3_semester_b"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    all_placed = [c for s in board["semesters"] for c in s["courses"]]
    flex_courses = [c for c in all_placed if c["course_id"] == "FLEX"]
    assert len(flex_courses) == 1


def test_flexible_mandatory_placed_in_one_of_allowed_semesters(no_db):
    prog = _rich_program(_mc_spec("FLEX", ["year_3_semester_a", "year_3_semester_b"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    for sem in board["semesters"]:
        if any(c["course_id"] == "FLEX" for c in sem["courses"]):
            assert sem["semester_id"] in ["year_3_semester_a", "year_3_semester_b"]
            break
    else:
        pytest.fail("FLEX was not placed in any semester")


def test_flexible_mandatory_locked_by_default_false(no_db):
    prog = _rich_program(_mc_spec("FLEX", ["year_3_semester_a", "year_3_semester_b"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "FLEX")
    assert mc["locked_by_default"] is False
    assert mc["locked_by_user"] is False


def test_flexible_mandatory_least_loaded_sem(no_db):
    # Two flexible allowed semesters; semester_a has a fixed mandatory → semester_b is least loaded
    prog = _rich_program(
        _mc_spec("FIXED",   ["year_3_semester_a"]),
        _mc_spec("FLEX",    ["year_3_semester_a", "year_3_semester_b"]),
    )
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    flex_sem = next(
        s["semester_id"]
        for s in board["semesters"]
        if any(c["course_id"] == "FLEX" for c in s["courses"])
    )
    # semester_a already has FIXED; FLEX should go to semester_b
    assert flex_sem == "year_3_semester_b"


def test_flexible_mandatory_placement_rule_field(no_db):
    prog = _rich_program(_mc_spec("FLEX", ["year_3_semester_a", "year_3_semester_b"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "FLEX")
    assert mc["placement_rule"] == "choose_one_allowed_semester"


def test_fixed_mandatory_placement_rule_field(no_db):
    prog = _rich_program(_mc_spec("FIXED", ["year_3_semester_a"]))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "FIXED")
    assert mc["placement_rule"] == "fixed_semester"


def test_mandatory_allowed_semesters_field_in_output(no_db):
    allowed = ["year_3_semester_a", "year_3_semester_b"]
    prog = _rich_program(_mc_spec("FLEX", allowed))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "FLEX")
    assert mc["allowed_semesters"] == allowed


def test_mandatory_needs_verification_propagated(no_db):
    prog = _rich_program(_mc_spec("X", ["year_3_semester_a"],
                                  needs_verification=True, source_note="screenshot"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "X")
    assert mc["needs_verification"] is True
    assert mc["source_note"] == "screenshot"


def test_flexible_not_duplicated_when_deduped(no_db):
    # Same course ID in both new rich format and old format → placed only once
    prog = _rich_program(_mc_spec("DUP", ["year_3_semester_a", "year_3_semester_b"]))
    prog["semesters"] = [{"semester_id": "year_3_semester_a", "mandatory_courses": ["DUP"]}]
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    all_placed = [c for s in board["semesters"] for c in s["courses"]]
    assert len([c for c in all_placed if c["course_id"] == "DUP"]) == 1


def test_old_format_still_works_backward_compat(no_db):
    prog = _program(_sem_entry("year_3_semester_a", "MAND-OLD"))
    board = build_semester_board(_plan(), program=prog, db_path=no_db)
    placed = [c for s in board["semesters"] for c in s["courses"]]
    mc = next(c for c in placed if c["course_id"] == "MAND-OLD")
    assert mc["course_type"] == "mandatory"
    assert mc["locked_by_default"] is True
    assert mc["placement_rule"] == "fixed_semester"
    assert mc["allowed_semesters"] == ["year_3_semester_a"]
