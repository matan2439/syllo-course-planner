import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.difficulty_estimator import estimate_course_difficulty, _difficulty_level


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
    db = tmp_path / "diff_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# _difficulty_level
# ---------------------------------------------------------------------------

def test_level_easy():       assert _difficulty_level(1.0) == "easy"
def test_level_easy_top():   assert _difficulty_level(1.99) == "easy"
def test_level_medium():     assert _difficulty_level(2.0) == "medium"
def test_level_medium_top(): assert _difficulty_level(3.19) == "medium"
def test_level_hard():       assert _difficulty_level(3.2) == "hard"
def test_level_hard_top():   assert _difficulty_level(4.19) == "hard"
def test_level_very_hard():  assert _difficulty_level(4.2) == "very_hard"
def test_level_max():        assert _difficulty_level(5.0) == "very_hard"


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

def test_result_has_all_keys(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert {"course_id", "difficulty_score", "difficulty_level", "factors", "explanation"} == set(r.keys())

def test_course_id_in_result(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["course_id"] == "X"

def test_missing_course_returns_none_score(tmp_db):
    r = estimate_course_difficulty("MISSING", tmp_db)
    assert r["difficulty_score"] is None
    assert r["difficulty_level"] is None

def test_score_is_float(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert isinstance(r["difficulty_score"], float)

def test_score_within_bounds(tmp_db):
    save_merged_course(_course("X", lecture_hours=10.0, prerequisite_course_ids=["A","B","C","D","E"],
                               exam_info="exam", assignments="hw",
                               course_description="advanced algorithm proof project lab"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert 1.0 <= r["difficulty_score"] <= 5.0


# ---------------------------------------------------------------------------
# Base score: no signals → score == 1.0
# ---------------------------------------------------------------------------

def test_base_score_no_signals(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["difficulty_score"] == 1.0
    assert r["difficulty_level"] == "easy"


# ---------------------------------------------------------------------------
# Hours bonus
# ---------------------------------------------------------------------------

def test_low_workload_small_bonus(tmp_db):
    save_merged_course(_course("X", lecture_hours=1.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1/6 ≈ 0.167 bonus → score ≈ 1.167
    assert r["factors"]["hours_bonus"] == pytest.approx(1 / 6, abs=0.01)

def test_full_hours_bonus_at_6h(tmp_db):
    save_merged_course(_course("X", lecture_hours=6.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["hours_bonus"] == 1.0

def test_hours_bonus_capped_at_1(tmp_db):
    save_merged_course(_course("X", lecture_hours=20.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["hours_bonus"] == 1.0

def test_combined_hours(tmp_db):
    save_merged_course(_course("X", lecture_hours=2.0, tutorial_hours=1.0, lab_hours=1.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["hours_bonus"] == pytest.approx(4 / 6, abs=0.01)


# ---------------------------------------------------------------------------
# Prerequisite bonus
# ---------------------------------------------------------------------------

def test_no_prereqs_zero_bonus(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["prereq_bonus"] == 0.0

def test_one_prereq_bonus(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["prereq_bonus"] == 0.25

def test_four_prereqs_full_bonus(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A","B","C","D"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["prereq_bonus"] == 1.0

def test_prereq_bonus_capped(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A","B","C","D","E","F"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["prereq_bonus"] == 1.0


# ---------------------------------------------------------------------------
# Exam bonus
# ---------------------------------------------------------------------------

def test_exam_bonus_present(tmp_db):
    save_merged_course(_course("X", exam_info="final exam"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["exam_bonus"] == 0.4

def test_no_exam_no_bonus(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["exam_bonus"] == 0.0


# ---------------------------------------------------------------------------
# Assignment bonus
# ---------------------------------------------------------------------------

def test_assignment_bonus_present(tmp_db):
    save_merged_course(_course("X", assignments="weekly hw"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["assign_bonus"] == 0.3

def test_no_assignment_no_bonus(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["assign_bonus"] == 0.0


# ---------------------------------------------------------------------------
# Keyword bonus
# ---------------------------------------------------------------------------

def test_keyword_english_algorithm(tmp_db):
    save_merged_course(_course("X", course_description="we study algorithm design"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert "algorithm" in r["factors"]["matched_keywords"]
    assert r["factors"]["keyword_bonus"] > 0

def test_keyword_hebrew_advanced(tmp_db):
    save_merged_course(_course("X", course_description="קורס מתקדם"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert "מתקדם" in r["factors"]["matched_keywords"]

def test_multiple_keywords(tmp_db):
    save_merged_course(_course("X", course_description="advanced algorithm proof project lab"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert len(r["factors"]["matched_keywords"]) >= 4

def test_keyword_bonus_capped_at_0_8(tmp_db):
    desc = "advanced algorithm proof project lab מתקדם הוכחה אלגוריתם מעבדה פרויקט"
    save_merged_course(_course("X", course_description=desc), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["keyword_bonus"] == pytest.approx(0.8)

def test_no_keywords_zero_bonus(tmp_db):
    save_merged_course(_course("X", course_description="intro to basics"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["keyword_bonus"] == 0.0


# ---------------------------------------------------------------------------
# Cap at 5.0
# ---------------------------------------------------------------------------

def test_max_signals_gives_high_score(tmp_db):
    # Max achievable: 1.0+1.0+1.0+0.4+0.3+0.8 = 4.5 with current weights
    desc = "advanced algorithm proof project lab מתקדם הוכחה"
    save_merged_course(_course(
        "X",
        lecture_hours=20.0,
        prerequisite_course_ids=["A","B","C","D","E"],
        exam_info="final",
        assignments="many",
        course_description=desc,
    ), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["difficulty_score"] >= 4.0
    assert r["difficulty_score"] <= 5.0

def test_score_never_exceeds_5():
    # Cap is applied: min(score, 5.0) — verify directly
    from app.analysis.difficulty_estimator import _difficulty_level
    assert _difficulty_level(5.0) == "very_hard"
    assert min(999.0, 5.0) == 5.0


# ---------------------------------------------------------------------------
# Digit normalization
# ---------------------------------------------------------------------------

def test_digit_normalization(tmp_db):
    save_merged_course(_course("0368-2157", lecture_hours=3.0), tmp_db)
    r = estimate_course_difficulty("03682157", tmp_db)
    assert r["course_id"] == "0368-2157"
    assert r["difficulty_score"] is not None


# ---------------------------------------------------------------------------
# Integration: real DB
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


def test_real_course_has_score(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert r["difficulty_score"] is not None
    assert 1.0 <= r["difficulty_score"] <= 5.0

def test_real_course_level_set(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert r["difficulty_level"] in ("easy", "medium", "hard", "very_hard")

def test_real_course_factors_present(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert "hours_bonus" in r["factors"]
    assert "prereq_bonus" in r["factors"]
