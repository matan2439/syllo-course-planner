import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.recommendation_engine import recommend_courses


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _course(course_id: str, **kwargs) -> dict:
    base = {
        "course_id":               course_id,
        "name_he":                 course_id,
        "name_en":                 None,
        "faculty":                 None,
        "department":              None,
        "year":                    2025,
        "semester":                None,
        "credits":                 None,
        "lecture_hours":           None,
        "tutorial_hours":          None,
        "lab_hours":               None,
        "prerequisites_raw_text":  None,
        "prerequisite_course_ids": [],
        "course_description":      None,
        "topics":                  [],
        "assignments":             None,
        "exam_info":               None,
        "syllabus_links":          [],
        "groups":                  [],
        "source_files":            {},
    }
    base.update(kwargs)
    return base


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "rec_test.sqlite"
    init_db(db)
    return db


@pytest.fixture
def basic_db(tmp_db):
    """
    A : no prereqs,  lecture_hours=2
    B : requires A,  lecture_hours=3
    C : requires A,  lecture_hours=5, exam, assignments
    D : requires B,  lecture_hours=1
    """
    save_merged_course(_course("A", lecture_hours=2.0), tmp_db)
    save_merged_course(_course("B", prerequisite_course_ids=["A"], lecture_hours=3.0), tmp_db)
    save_merged_course(_course("C", prerequisite_course_ids=["A"], lecture_hours=5.0,
                               exam_info="final", assignments="hw"), tmp_db)
    save_merged_course(_course("D", prerequisite_course_ids=["B"], lecture_hours=1.0), tmp_db)
    return tmp_db


# ---------------------------------------------------------------------------
# Eligible courses are recommended
# ---------------------------------------------------------------------------

def test_no_prereq_course_always_recommended(basic_db):
    results = recommend_courses([], db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert "A" in ids


def test_eligible_course_included(basic_db):
    results = recommend_courses(["A"], db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert "B" in ids
    assert "C" in ids


def test_blocked_course_excluded(basic_db):
    # B requires A; without A completed, B should not appear
    results = recommend_courses([], db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert "B" not in ids
    assert "C" not in ids


def test_completed_course_excluded(basic_db):
    results = recommend_courses(["A"], db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert "A" not in ids


def test_empty_completed_returns_only_no_prereq(basic_db):
    results = recommend_courses([], db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert ids == ["A"]


def test_all_completed_returns_empty(basic_db):
    results = recommend_courses(["A", "B", "C", "D"], db_path=basic_db)
    assert results == []


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

def test_result_has_required_keys(basic_db):
    results = recommend_courses([], db_path=basic_db)
    assert results
    r = results[0]
    assert {
        "course_id", "name_he", "difficulty_score", "difficulty_level",
        "weekly_hours", "direct_prerequisites", "unlocked_courses_count", "reasons",
    } == set(r.keys())


def test_weekly_hours_computed(basic_db):
    results = recommend_courses([], db_path=basic_db)
    a = next(r for r in results if r["course_id"] == "A")
    assert a["weekly_hours"] == 2.0


def test_weekly_hours_sums_all_types(tmp_db):
    save_merged_course(_course("X", lecture_hours=2.0, tutorial_hours=1.0, lab_hours=1.0), tmp_db)
    results = recommend_courses([], db_path=tmp_db)
    assert results[0]["weekly_hours"] == 4.0


def test_reasons_is_list(basic_db):
    results = recommend_courses([], db_path=basic_db)
    assert isinstance(results[0]["reasons"], list)
    assert len(results[0]["reasons"]) >= 1


def test_unlocked_count_populated(basic_db):
    # A unlocks B and C
    results = recommend_courses([], db_path=basic_db)
    a = next(r for r in results if r["course_id"] == "A")
    assert a["unlocked_courses_count"] == 2


# ---------------------------------------------------------------------------
# max_difficulty filter
# ---------------------------------------------------------------------------

def test_max_difficulty_excludes_hard_courses(tmp_db):
    save_merged_course(_course("EASY", lecture_hours=1.0), tmp_db)
    save_merged_course(_course("HARD", lecture_hours=6.0, exam_info="e",
                               assignments="a", prerequisite_course_ids=["X","Y","Z","W"]), tmp_db)
    results = recommend_courses([], max_difficulty=2.0, db_path=tmp_db)
    ids = [r["course_id"] for r in results]
    assert "EASY" in ids
    assert "HARD" not in ids


def test_max_difficulty_includes_equal_score(tmp_db):
    save_merged_course(_course("X"), tmp_db)           # score = 1.0
    results = recommend_courses([], max_difficulty=1.0, db_path=tmp_db)
    assert any(r["course_id"] == "X" for r in results)


def test_max_difficulty_none_applies_no_filter(basic_db):
    results_all      = recommend_courses(["A"], max_difficulty=None, db_path=basic_db)
    results_filtered = recommend_courses(["A"], max_difficulty=1.0,  db_path=basic_db)
    assert len(results_all) >= len(results_filtered)


# ---------------------------------------------------------------------------
# max_weekly_hours filter
# ---------------------------------------------------------------------------

def test_max_weekly_hours_excludes_heavy_courses(basic_db):
    # C has 5 lecture hours
    results = recommend_courses(["A"], max_weekly_hours=4.0, db_path=basic_db)
    ids = [r["course_id"] for r in results]
    assert "C" not in ids
    assert "B" in ids


def test_max_weekly_hours_includes_equal(tmp_db):
    save_merged_course(_course("X", lecture_hours=3.0), tmp_db)
    results = recommend_courses([], max_weekly_hours=3.0, db_path=tmp_db)
    assert any(r["course_id"] == "X" for r in results)


def test_max_weekly_hours_none_applies_no_filter(basic_db):
    results_all      = recommend_courses(["A"], max_weekly_hours=None, db_path=basic_db)
    results_filtered = recommend_courses(["A"], max_weekly_hours=1.0,  db_path=basic_db)
    assert len(results_all) >= len(results_filtered)


# ---------------------------------------------------------------------------
# Ranking: courses that unlock more dependents ranked higher
# ---------------------------------------------------------------------------

def test_ranking_prefers_more_unlocks(tmp_db):
    """
    A unlocks B, C, D  (3 dependents)
    E unlocks nothing   (0 dependents)
    Both have no prerequisites.
    A should rank above E.
    """
    save_merged_course(_course("A"), tmp_db)
    save_merged_course(_course("B", prerequisite_course_ids=["A"]), tmp_db)
    save_merged_course(_course("C", prerequisite_course_ids=["A"]), tmp_db)
    save_merged_course(_course("D", prerequisite_course_ids=["A"]), tmp_db)
    save_merged_course(_course("E"), tmp_db)

    results = recommend_courses([], db_path=tmp_db)
    ids = [r["course_id"] for r in results]
    assert ids.index("A") < ids.index("E")


def test_ranking_prefers_lower_difficulty(tmp_db):
    """
    EASY has no prereqs and 1h  → low difficulty
    HARD has no prereqs and 6h + exam + assignments → higher difficulty
    Neither unlocks anything.
    EASY should rank above HARD.
    """
    save_merged_course(_course("EASY", lecture_hours=1.0), tmp_db)
    save_merged_course(_course("HARD", lecture_hours=6.0, exam_info="e", assignments="a"), tmp_db)

    results = recommend_courses([], db_path=tmp_db)
    ids = [r["course_id"] for r in results]
    assert ids.index("EASY") < ids.index("HARD")


# ---------------------------------------------------------------------------
# limit
# ---------------------------------------------------------------------------

def test_limit_respected(basic_db):
    results = recommend_courses(["A"], limit=1, db_path=basic_db)
    assert len(results) <= 1


def test_limit_default_10(tmp_db):
    for i in range(15):
        save_merged_course(_course(f"C{i:02d}"), tmp_db)
    results = recommend_courses([], db_path=tmp_db)
    assert len(results) == 10


# ---------------------------------------------------------------------------
# Integration: real DB
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


def test_real_recommend_with_prereq_completed(real_db):
    results = recommend_courses(["03681105"], db_path=real_db)
    ids = [r["course_id"] for r in results]
    assert "0368-2157" in ids


def test_real_recommend_empty_completed(real_db):
    # 0368-2157 has a prereq — should not appear
    results = recommend_courses([], db_path=real_db)
    ids = [r["course_id"] for r in results]
    assert "0368-2157" not in ids


def test_real_recommend_result_structure(real_db):
    results = recommend_courses(["03681105"], db_path=real_db)
    assert results
    r = results[0]
    assert r["difficulty_score"] is not None
    assert isinstance(r["reasons"], list)
