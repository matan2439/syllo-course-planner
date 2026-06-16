import json

from app.analysis.board_audit import audit_board, compute_board_hash, _intersect_effective


def _base_course(**overrides):
    course = {
        "course_id": "0542-0000",
        "name_he": "קורס לדוגמה",
        "weekly_hours": 3.0,
        "is_mandatory": True,
        "placement_policy": "flexible",
        "program_allowed_semesters": ["year_4_semester_a", "year_4_semester_b"],
        "offered_semesters": None,
        "effective_allowed_semesters": ["year_4_semester_a", "year_4_semester_b"],
        "offering_source_confidence": "low",
    }
    course.update(overrides)
    return course


def _board(*courses_by_semester):
    semesters = []
    for sem_id, courses in courses_by_semester:
        semesters.append({
            "semester_id": sem_id,
            "courses": list(courses),
            "total_weekly_hours": sum(c.get("weekly_hours") or 0 for c in courses),
        })
    return {"semesters": semesters, "metadata": {}}


def test_intersect_effective_basic():
    assert _intersect_effective(
        ["year_4_semester_a", "year_4_semester_b"], ["B"],
    ) == ["year_4_semester_b"]


def test_intersect_effective_unknown_keeps_program_allowed():
    assert _intersect_effective(["year_3_semester_a", "year_3_semester_b"], []) == [
        "year_3_semester_a", "year_3_semester_b",
    ]


def test_audit_passes_for_valid_board():
    board = _board(("year_4_semester_a", [_base_course()]))
    issues = audit_board(board)
    assert not [i for i in issues if i.level == "error"]


def test_audit_catches_invalid_placement():
    course = _base_course(
        offered_semesters=["B"],
        offering_source_confidence="high",
        effective_allowed_semesters=["year_4_semester_b"],
    )
    board = _board(("year_4_semester_a", [course]))
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "invalid_placement" for i in errors)


def test_audit_catches_bad_hours_total():
    board = _board(("year_4_semester_a", [_base_course(weekly_hours=3.0)]))
    board["semesters"][0]["total_weekly_hours"] = 99.0
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "hours_mismatch" for i in errors)


def test_audit_catches_duplicate_placement():
    course = _base_course()
    board = _board(
        ("year_4_semester_a", [course]),
        ("year_4_semester_b", [dict(course)]),
    )
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "duplicate_placement" for i in errors)


def test_audit_catches_unjustified_restriction():
    course = _base_course(
        effective_allowed_semesters=["year_4_semester_a"],
        offered_semesters=None,
        offering_source_confidence="low",
    )
    board = _board(("year_4_semester_a", [course]))
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "unjustified_restriction" for i in errors)


def test_audit_catches_personal_status_in_board():
    board = _board(("year_4_semester_a", [_base_course()]))
    board["metadata"]["personal_status"] = {"completed": ["0542-0000"]}
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "personal_status_in_board" for i in errors)


def test_compute_board_hash_stable_and_excludes_version_field():
    board = _board(("year_4_semester_a", [_base_course()]))
    h1 = compute_board_hash(board)
    board["metadata"]["board_data_version"] = "irrelevant"
    h2 = compute_board_hash(board)
    assert h1 == h2

    board2 = json.loads(json.dumps(board))
    board2["semesters"][0]["courses"][0]["weekly_hours"] = 5.0
    assert compute_board_hash(board2) != h1


# === Extended data-integrity checks (offering / annual / legality) ===

import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD_PATH = os.path.join(
    REPO_ROOT, "data", "parsed_json", "mechanical_semester_board_2027.json"
)


def _annual_course(**overrides):
    c = _base_course(
        course_id="0542-3792",
        is_annual=True,
        spans_semesters=["year_3_semester_a", "year_3_semester_b"],
        count_hours_once=True,
        effective_allowed_semesters=["year_3_semester_a", "year_3_semester_b"],
        program_allowed_semesters=["year_3_semester_a", "year_3_semester_b"],
        weekly_hours=4.0,
    )
    c.update(overrides)
    return c


def test_audit_errors_when_annual_text_without_annual_flag():
    course = _base_course(
        course_id="0542-9999",
        syllabus_summary_he='החל משנת תשפ"ו זהו קורס שנתי המתקיים בשני הסמסטרים',
        is_annual=False,
    )
    issues = audit_board(_board(("year_3_semester_a", [course])))
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "annual_not_represented" for i in errors)


def test_audit_errors_on_offering_mismatch_b_only_but_effective_a():
    course = _base_course(
        course_id="0542-3780",
        offered_semesters=["B"],
        offering_source_confidence="high",
        effective_allowed_semesters=["year_3_semester_a"],
        program_allowed_semesters=["year_3_semester_a", "year_3_semester_b"],
    )
    # Placed legally for its (wrong) effective set so we isolate the offering check.
    issues = audit_board(_board(("year_3_semester_a", [course])))
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "offering_mismatch" for i in errors)


def test_audit_errors_when_annual_placed_in_only_one_semester():
    course = _annual_course()
    issues = audit_board(_board(("year_3_semester_a", [course])))
    errors = [i for i in issues if i.level == "error"]
    assert any(i.check == "annual_placement_incomplete" for i in errors)


def test_audit_passes_annual_placed_in_both_semesters():
    course = _annual_course()
    board = _board(
        ("year_3_semester_a", [dict(course)]),
        ("year_3_semester_b", [dict(course)]),
    )
    issues = audit_board(board)
    errors = [i for i in issues if i.level == "error"]
    # Annual placed in both spanned semesters must NOT trip duplicate_placement
    # or annual_placement_incomplete.
    assert not any(
        i.check in ("duplicate_placement", "annual_placement_incomplete")
        for i in errors
    )


def test_audit_flags_recommended_vs_effective_conflict():
    course = _base_course(
        course_id="0542-3780",
        offered_semesters=["B"],
        offering_source_confidence="high",
        effective_allowed_semesters=["year_3_semester_b"],
        recommended_semester="year_3_semester_a",
    )
    issues = audit_board(_board(("year_3_semester_b", [course])))
    # Placement is legal (effective wins) so this is surfaced as a warning, not masked.
    assert any(i.check == "recommended_conflicts_effective" for i in issues)


def test_audit_flags_4223_if_placed_in_semester_b():
    # Issue 3 — 0542-4223 is legal ONLY in year_4_semester_a. If the planner ever
    # places it in Semester B, the audit must FAIL (illegal placement).
    course = _base_course(
        course_id="0542-4223",
        name_he="מבוא לאלמנטים סופיים",
        is_mandatory=False,
        placement_policy="fixed",
        offered_semesters=["A"],
        offering_source_confidence="high",
        program_allowed_semesters=["year_4_semester_a", "year_4_semester_b"],
        effective_allowed_semesters=["year_4_semester_a"],
        recommended_semester="year_4_semester_a",
    )
    board = _board(("year_4_semester_b", [course]))
    errors = [i for i in audit_board(board) if i.level == "error"]
    assert any(
        i.course_id == "0542-4223"
        and i.check in ("invalid_placement", "illegal_board_placement")
        for i in errors
    ), f"expected illegal-placement error for 0542-4223, got {errors}"


def test_audit_passes_4223_in_semester_a():
    course = _base_course(
        course_id="0542-4223",
        name_he="מבוא לאלמנטים סופיים",
        is_mandatory=False,
        placement_policy="fixed",
        offered_semesters=["A"],
        offering_source_confidence="high",
        program_allowed_semesters=["year_4_semester_a", "year_4_semester_b"],
        effective_allowed_semesters=["year_4_semester_a"],
        recommended_semester="year_4_semester_a",
    )
    board = _board(("year_4_semester_a", [course]))
    errors = [
        i for i in audit_board(board)
        if i.level == "error" and i.course_id == "0542-4223"
    ]
    assert errors == [], f"unexpected errors for 0542-4223 in A: {errors}"


def test_real_board_models_4223_semester_a_only():
    # Issue 3 — 0542-4223 is a Semester-A elective allowed in EITHER academic
    # year (year_3_semester_a / year_4_semester_a); the only hard fact is "no
    # Semester B". It stays flexible (no explicit Year-4-only evidence), with
    # the actual year gated by prerequisites at planning time.
    board = json.loads(open(BOARD_PATH, encoding="utf-8").read())
    repo = board["metadata"]["program_repository_courses"]
    entry = next(c for c in repo if c.get("course_id") == "0542-4223")
    assert entry["offered_semesters"] == ["A"]
    eff = entry["effective_allowed_semesters"]
    assert all("semester_b" not in s for s in eff), eff
    assert set(eff) <= {"year_3_semester_a", "year_4_semester_a"}, eff
    assert "year_4_semester_a" in eff and "year_3_semester_a" in eff, eff
    assert entry["placement_policy"] == "flexible"
    assert entry["recommended_semester"] in eff


def test_real_board_passes_extended_integrity_for_three_target_courses():
    board = json.loads(open(BOARD_PATH, encoding="utf-8").read())
    issues = audit_board(board)
    targets = {"0542-3780", "0542-3791", "0542-3792"}
    target_errors = [
        i for i in issues if i.level == "error" and i.course_id in targets
    ]
    assert target_errors == [], f"unexpected errors for target courses: {target_errors}"


def test_real_board_models_three_target_courses_correctly():
    board = json.loads(open(BOARD_PATH, encoding="utf-8").read())

    def find_all(cid):
        recs = []
        for sem in board.get("semesters", []):
            for c in sem.get("courses", []):
                if c.get("course_id") == cid:
                    recs.append((sem.get("semester_id"), c))
        return recs

    # 3780 / 3791 -> Semester B only.
    for cid in ("0542-3780", "0542-3791"):
        recs = find_all(cid)
        assert recs, f"{cid} not placed on board"
        for sem_id, c in recs:
            assert c["effective_allowed_semesters"] == ["year_3_semester_b"], cid
            assert c["offered_semesters"] == ["B"], cid
            assert sem_id == "year_3_semester_b", cid

    # 3792 -> annual spanning A+B, placed in both, hours counted once.
    recs = find_all("0542-3792")
    placed = {sem_id for sem_id, _ in recs}
    assert placed == {"year_3_semester_a", "year_3_semester_b"}
    for _, c in recs:
        assert c.get("is_annual") is True
        assert c.get("count_hours_once") is True
        assert set(c.get("spans_semesters") or []) == {
            "year_3_semester_a", "year_3_semester_b",
        }
