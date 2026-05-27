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
# _difficulty_level — boundaries unchanged
# ---------------------------------------------------------------------------

def test_level_easy():       assert _difficulty_level(1.0)  == "easy"
def test_level_easy_top():   assert _difficulty_level(1.99) == "easy"
def test_level_medium():     assert _difficulty_level(2.0)  == "medium"
def test_level_medium_top(): assert _difficulty_level(3.19) == "medium"
def test_level_hard():       assert _difficulty_level(3.2)  == "hard"
def test_level_hard_top():   assert _difficulty_level(4.19) == "hard"
def test_level_very_hard():  assert _difficulty_level(4.2)  == "very_hard"
def test_level_max():        assert _difficulty_level(5.0)  == "very_hard"


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

_REQUIRED_KEYS = {
    "course_id", "workload_score", "conceptual_complexity_score",
    "prerequisite_depth_score", "assessment_intensity_score",
    "final_difficulty_score", "difficulty_level", "confidence",
    "factors", "explanation", "warnings", "grade_signal",
}


def test_result_has_all_keys(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert _REQUIRED_KEYS == set(r.keys())


def test_course_id_in_result(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["course_id"] == "X"


def test_missing_course_returns_none_scores(tmp_db):
    r = estimate_course_difficulty("MISSING", tmp_db)
    assert r["final_difficulty_score"] is None
    assert r["difficulty_level"] is None
    assert r["workload_score"] is None
    assert r["confidence"] == 0.0


def test_final_score_is_float(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert isinstance(r["final_difficulty_score"], float)


def test_score_within_bounds(tmp_db):
    save_merged_course(_course("X", lecture_hours=10.0,
                               prerequisite_course_ids=["A", "B", "C", "D", "E"],
                               exam_info="exam", assignments="hw",
                               course_description="advanced algorithm proof project"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert 1.0 <= r["final_difficulty_score"] <= 5.0


def test_warnings_is_list(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert isinstance(r["warnings"], list)


# ---------------------------------------------------------------------------
# Base score: no signals → final_difficulty_score == 1.0
# ---------------------------------------------------------------------------

def test_base_score_no_signals(tmp_db):
    # No hours, no description, no prereqs, no exam/assignments
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["final_difficulty_score"] == pytest.approx(1.0)
    assert r["difficulty_level"] == "easy"


def test_base_score_prerequisite_depth_is_1_with_no_prereqs(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["prerequisite_depth_score"] == pytest.approx(1.0)


def test_base_score_assessment_is_1_with_no_exam_or_hw(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["assessment_intensity_score"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Workload subscore
# ---------------------------------------------------------------------------

def test_workload_none_when_no_hours(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["workload_score"] is None


def test_workload_increases_with_hours(tmp_db):
    save_merged_course(_course("X", lecture_hours=4.5), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 4.5 × 4/9 = 1.0 + 2.0 = 3.0
    assert r["workload_score"] == pytest.approx(3.0, abs=0.01)


def test_workload_capped_at_5(tmp_db):
    save_merged_course(_course("X", lecture_hours=20.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["workload_score"] == pytest.approx(5.0)


def test_workload_combines_all_hour_types(tmp_db):
    save_merged_course(_course("X", lecture_hours=2.0, tutorial_hours=1.0, lab_hours=1.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # total = 4.0 → 1.0 + 4.0 × 4/9 ≈ 2.78
    assert r["workload_score"] == pytest.approx(1.0 + 4.0 * 4 / 9, abs=0.01)


def test_workload_zero_hours_gives_minimum(tmp_db):
    save_merged_course(_course("X", lecture_hours=0.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["workload_score"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Conceptual complexity subscore
# ---------------------------------------------------------------------------

def test_conceptual_none_when_no_description(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["conceptual_complexity_score"] is None


def test_conceptual_increases_with_keywords(tmp_db):
    save_merged_course(_course("X", course_description="advanced algorithm proof"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 3 English keywords: advanced, algorithm, proof → 1.0 + 3 × 0.20 = 1.6
    assert r["conceptual_complexity_score"] == pytest.approx(1.6, abs=0.01)


def test_conceptual_hebrew_keywords_counted(tmp_db):
    save_merged_course(_course("X", course_description="קורס מתקדם בהסתברות"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["conceptual_complexity_score"] > 1.0
    assert "מתקדם" in r["factors"]["matched_keywords"]
    assert "הסתברות" in r["factors"]["matched_keywords"]


def test_conceptual_capped_at_5(tmp_db):
    # 21+ keywords → cap at 5.0
    desc = (
        "advanced proof model modeling numerical computational analytical dynamics "
        "thermodynamics fluid elasticity control optimization probability statistics "
        "algorithm simulation project mechanics heat transfer differential equations finite elements"
    )
    save_merged_course(_course("X", course_description=desc), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["conceptual_complexity_score"] == pytest.approx(5.0)


def test_conceptual_empty_description_gives_none(tmp_db):
    save_merged_course(_course("X", course_description=""), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # empty string is falsy → None
    assert r["conceptual_complexity_score"] is None


def test_conceptual_keywords_searched_in_assignments_too(tmp_db):
    # No description, but assignments text contains a keyword — still None because
    # conceptual_score requires has_description. The keywords ARE still matched though
    # (for the factors dict).
    save_merged_course(_course("X", assignments="solve advanced numerical problems"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # has_description is False → conceptual_score is None
    assert r["conceptual_complexity_score"] is None
    # But keywords should still be found in factors
    assert "advanced" in r["factors"]["matched_keywords"]


# ---------------------------------------------------------------------------
# Prerequisite depth subscore
# ---------------------------------------------------------------------------

def test_prereq_depth_1_with_no_prereqs(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["prerequisite_depth_score"] == pytest.approx(1.0)


def test_prereq_depth_increases(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A", "B"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 2 × 0.5 = 2.0
    assert r["prerequisite_depth_score"] == pytest.approx(2.0)


def test_prereq_depth_capped_at_5(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A","B","C","D","E","F","G","H","I"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["prerequisite_depth_score"] == pytest.approx(5.0)


def test_prereq_depth_four_prereqs(tmp_db):
    save_merged_course(_course("X", prerequisite_course_ids=["A","B","C","D"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 4 × 0.5 = 3.0
    assert r["prerequisite_depth_score"] == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# Assessment intensity subscore
# ---------------------------------------------------------------------------

def test_assessment_1_when_no_exam_or_hw(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["assessment_intensity_score"] == pytest.approx(1.0)


def test_assessment_with_exam_only(tmp_db):
    save_merged_course(_course("X", exam_info="final exam"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 2.0 = 3.0
    assert r["assessment_intensity_score"] == pytest.approx(3.0)


def test_assessment_with_assignments_only(tmp_db):
    save_merged_course(_course("X", assignments="weekly homework"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 1.5 = 2.5
    assert r["assessment_intensity_score"] == pytest.approx(2.5)


def test_assessment_with_both(tmp_db):
    save_merged_course(_course("X", exam_info="final", assignments="hw"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # 1.0 + 2.0 + 1.5 = 4.5
    assert r["assessment_intensity_score"] == pytest.approx(4.5)


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

def test_confidence_only_prereqs_known(tmp_db):
    # No hours, no description, no exam/assignments → confidence = weight of prereqs = 0.20
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["confidence"] == pytest.approx(0.20, abs=0.01)


def test_confidence_hours_and_prereqs(tmp_db):
    # hours known (0.30) + prereqs (0.20) = 0.50
    save_merged_course(_course("X", lecture_hours=3.0), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["confidence"] == pytest.approx(0.50, abs=0.01)


def test_confidence_description_and_prereqs(tmp_db):
    # description known (0.35) + prereqs (0.20) = 0.55
    save_merged_course(_course("X", course_description="intro to basics"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["confidence"] == pytest.approx(0.55, abs=0.01)


def test_confidence_full_data(tmp_db):
    # hours(0.30) + description(0.35) + prereqs(0.20) + exam(0.15) = 1.0
    save_merged_course(_course("X", lecture_hours=3.0, course_description="advanced topics",
                               exam_info="final"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["confidence"] == pytest.approx(1.0, abs=0.01)


def test_confidence_syllabus_counts_for_assessment(tmp_db):
    # syllabus present → has_assessment_data = True → +0.15
    save_merged_course(_course("X", syllabus_links=["http://example.com/syllabus.pdf"]), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    # prereqs(0.20) + syllabus assessment(0.15) = 0.35
    assert r["confidence"] == pytest.approx(0.35, abs=0.01)


# ---------------------------------------------------------------------------
# Low-confidence warning
# ---------------------------------------------------------------------------

def test_low_confidence_warning_emitted(tmp_db):
    # confidence = 0.20 < 0.6 → warning
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert any("חלקי" in w for w in r["warnings"])


def test_no_warning_when_confidence_high(tmp_db):
    save_merged_course(_course("X", lecture_hours=3.0, course_description="advanced",
                               exam_info="final"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["confidence"] >= 0.6
    assert not r["warnings"]


# ---------------------------------------------------------------------------
# Weighted final score
# ---------------------------------------------------------------------------

def test_final_score_increases_with_more_signals(tmp_db):
    save_merged_course(_course("BASE"), tmp_db)
    save_merged_course(_course("RICH", lecture_hours=6.0,
                               course_description="advanced dynamics thermodynamics",
                               prerequisite_course_ids=["A", "B"],
                               exam_info="final", assignments="hw"), tmp_db)
    base = estimate_course_difficulty("BASE", tmp_db)
    rich = estimate_course_difficulty("RICH", tmp_db)
    assert rich["final_difficulty_score"] > base["final_difficulty_score"]


def test_max_signals_gives_high_score(tmp_db):
    desc = (
        "advanced proof model modeling numerical computational analytical dynamics "
        "thermodynamics fluid elasticity control optimization probability statistics "
        "algorithm simulation project mechanics heat transfer differential equations"
    )
    save_merged_course(_course(
        "X",
        lecture_hours=20.0,
        prerequisite_course_ids=["A","B","C","D","E","F","G","H"],
        exam_info="final",
        assignments="many",
        course_description=desc,
    ), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["final_difficulty_score"] >= 4.0
    assert r["final_difficulty_score"] <= 5.0


def test_score_never_exceeds_5(tmp_db):
    save_merged_course(_course("X", lecture_hours=100.0,
                               prerequisite_course_ids=["A","B","C","D","E","F","G","H","I","J"],
                               exam_info="hard final", assignments="daily hw"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["final_difficulty_score"] <= 5.0


def test_score_never_below_1(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["final_difficulty_score"] >= 1.0


# ---------------------------------------------------------------------------
# Factors dict
# ---------------------------------------------------------------------------

def test_factors_has_required_keys(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    for key in ("total_hours", "matched_keywords", "prereq_count", "has_exam", "has_assignments"):
        assert key in r["factors"]


def test_factors_matched_keywords_is_sorted_list(tmp_db):
    save_merged_course(_course("X", course_description="advanced proof algorithm"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    kws = r["factors"]["matched_keywords"]
    assert isinstance(kws, list)
    assert kws == sorted(kws)


def test_factors_no_keywords_when_no_description(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    r = estimate_course_difficulty("X", tmp_db)
    assert r["factors"]["matched_keywords"] == []


# ---------------------------------------------------------------------------
# Digit normalization
# ---------------------------------------------------------------------------

def test_digit_normalization(tmp_db):
    save_merged_course(_course("0368-2157", lecture_hours=3.0), tmp_db)
    r = estimate_course_difficulty("03682157", tmp_db)
    assert r["course_id"] == "0368-2157"
    assert r["final_difficulty_score"] is not None


# ---------------------------------------------------------------------------
# Integration: real DB (skipped if absent)
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


def test_real_course_has_score(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert r["final_difficulty_score"] is not None
    assert 1.0 <= r["final_difficulty_score"] <= 5.0


def test_real_course_level_set(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert r["difficulty_level"] in ("easy", "medium", "hard", "very_hard")


def test_real_course_factors_present(real_db):
    r = estimate_course_difficulty("0368-2157", real_db)
    assert "total_hours" in r["factors"]
    assert "prereq_count" in r["factors"]
