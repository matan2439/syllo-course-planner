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


# ── The dedicated prerequisites page and the catalog listing ────────────────────────────────
from app.parsing.tau_prerequisites import (  # noqa: E402
    normalize_expression, parse_catalog_listing, parse_prerequisites_page,
)


def page(name: str) -> dict:
    return parse_prerequisites_page((FIXTURES / f"prereq_page_{name}.html").read_text(encoding="utf-8"))


def test_prerequisites_page_groups_are_explicit():
    result = page("0368-3065")
    assert result["status"] == "verified"
    assert result["expression"] == {"all": [
        {"any": [c("0368-2162"), c("0512-4402")]},
        {"any": [c("0368-2159"), c("0512-4400")]},
    ]}
    assert result["needs_review"] is False


def test_prerequisites_page_agrees_with_the_syllabus_page_copy():
    assert normalize_expression(page("0368-3065")["expression"]) == normalize_expression(parse("0368-3065")["expression"])


def test_prerequisites_page_separates_corequisites():
    result = page("0512-1204")
    assert result["expression"] == {"all": [c("0509-1829"), c("0512-1205")]}
    assert result["corequisites"] == c("0512-1205")


def test_a_page_with_only_corequisites_has_no_prerequisite_expression():
    result = page("0509-1118")
    assert result["expression"] is None
    assert result["corequisites"] == c("0509-1117")


def test_normalize_ignores_order_and_nesting():
    a = {"all": [c("A"), {"all": [c("B"), c("C")]}]}
    b = {"all": [c("C"), c("B"), c("A")]}
    assert normalize_expression(a) == normalize_expression(b)
    assert normalize_expression({"any": [c("A"), c("B")]}) != normalize_expression(b)


def test_catalog_listing_gives_name_and_semesters():
    listing = parse_catalog_listing((FIXTURES / "listing_0368-3065.html").read_text(encoding="utf-8"))
    assert listing["found"] is True
    assert listing["name_he"] == "מבוא לאבטחת מידע"
    assert listing["semesters"] == ["B"]


def test_a_course_number_missing_from_the_catalog_is_reported_not_found():
    listing = parse_catalog_listing((FIXTURES / "listing_not_found.html").read_text(encoding="utf-8"))
    assert listing["found"] is False
