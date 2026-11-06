"""Project structured elective offering windows onto generated board columns."""
import re


def offering_window_ordinals(rule: dict) -> set[int] | None:
    params = rule.get("params", {})
    semesters = params.get("semesters")
    cap = params.get("max_courses", 1)
    if (rule.get("kind") == "offering_window" and len(rule["course_ids"]) == 1
            and set(params) <= {"semesters", "max_courses"} and type(cap) is int and cap == 1
            and isinstance(semesters, list) and semesters
            and all(type(n) is int and n > 0 for n in semesters)):
        return set(semesters)
    return None


def window_semesters(board: dict, ordinals: set[int], offered: list[str]) -> list[str]:
    allowed = []
    for semester in board["semesters"]:
        sid = semester["semester_id"]
        match = re.fullmatch(r"year_([1-9]\d*)_semester_([ab])", sid)
        if match:
            year, half = match.groups()
            ordinal = 2 * int(year) - (half == "a")
            if ordinal in ordinals and half.upper() in offered:
                allowed.append(sid)
    return allowed


def apply_offering_windows(board: dict) -> None:
    metadata = board["metadata"]
    for rule in metadata.get("degree_rules", []):
        ordinals = offering_window_ordinals(rule)
        if ordinals is None:
            continue
        for course in metadata.get("program_repository_courses", []):
            if course["course_id"] == rule["course_ids"][0]:
                offered = course.get("offered_semesters") or []
                if course.get("offering_source_confidence") != "high" or course.get("offered_in_year") is not True:
                    offered = []
                allowed = window_semesters(board, ordinals, offered)
                # An explicit empty list means the catalog course has no placement in this board.
                course["offering_window_semesters"] = allowed
                course["effective_allowed_semesters"] = allowed
