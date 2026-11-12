"""Prerequisite parsing against saved copies of real official syllabus pages."""
from pathlib import Path

from app.parsing.tau_prerequisites import parse_syllabus_prerequisites

FIXTURES = Path(__file__).parent / "fixtures" / "tau_syllabus"


def parse(name: str) -> dict:
    return parse_syllabus_prerequisites((FIXTURES / f"{name}.html").read_text(encoding="utf-8"))


def c(course_id: str) -> dict:
    return {"course": course_id}


def test_plus_is_and():
    result = parse("0542-4124")
    assert result["status"] == "verified"
    assert result["expression"] == {"all": [c("0509-1815"), c("0542-3243"), c("0542-3620"), c("0542-2500")]}
    assert result["course_names"]["0542-3620"] == "מעבר חם"
    assert result["needs_review"] is False


def test_or_alternatives():
    assert parse("0542-4223")["expression"] == {"any": [c("0542-2200"), c("0542-4224")]}


def test_explicit_groups_are_and_of_alternatives():
    assert parse("0368-3065")["expression"] == {"all": [
        {"any": [c("0368-2162"), c("0512-4402")]},
        {"any": [c("0368-2159"), c("0512-4400")]},
    ]}


def test_explicit_group_joined_by_or():
    assert parse("0512-4126")["expression"] == {"any": [
        {"all": [c("0512-4125"), c("0512-2830")]},
        c("0321-3818"),
    ]}


def test_corequisites_are_separate_from_prerequisites():
    result = parse("0512-3581")
    assert result["expression"] == {"all": [c("0512-2508"), c("0512-3513")]}
    assert result["corequisites"] == c("0512-3526")


def test_official_page_without_a_prerequisite_block_is_verified_none():
    result = parse("none_listed")
    assert result["status"] == "verified_none"
    assert result["expression"] is None


def test_a_page_that_is_not_a_syllabus_is_unknown_never_none():
    assert parse_syllabus_prerequisites("<html><body>Group semester not found</body></html>")["status"] == "unknown"


def test_mixed_operators_in_one_group_are_flagged_for_review():
    span = lambda name, digits, op="": (
        f"<span><strong><small>{name}</small></strong><small>  ({digits}) "
        + (f"<strong><small>{op}</small></strong>" if op else "") + "</small></span>")
    page = ('<section class="main-course-requirements"><small class="data-table-cell-label">קורסי קדם נדרשים</small>'
            + span("א", "05420001", "+") + span("ב", "05420002", "או") + span("ג", "05420003")
            + '<p class="disclaimer">x</p></section>')
    result = parse_syllabus_prerequisites(page)
    assert result["expression"] == {"all": [c("0542-0001"), {"any": [c("0542-0002"), c("0542-0003")]}]}
    assert result["needs_review"] is True
