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
