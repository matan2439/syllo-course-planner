"""IMS Drishot grouping regressions, using the official table layout."""
from pathlib import Path

import pytest

from app.degrees.prerequisites import parse_ims_prerequisites, validate_expression


BASE = "https://ims.tau.ac.il/tal/kr/Drishot_L.aspx"
PRE = "קורסי קדם נדרשים"
CO = "קורסים מקבילים נדרשים"


def leaf(course_id):
    return {"course_id": course_id}


def course(course_id):
    return f"<tr><td>{course_id}</td><td>שם הקורס</td></tr>"


def operator(text):
    return f"<tr><td colspan='2'><b>{text}</b></td></tr>"


def group(rows):
    return f"<tr><td><table class='listtds'>{rows}</table></td></tr>"


def section(title, rows):
    return f"<tr><th class='listth'>{title}</th></tr>{rows}"


def page(rows, course_id="0512-3513"):
    return (f'<html><body><span class="listtdbbld">שנה"ל תשפ"ז (2026/2027)</span>'
            f'<span class="listtd">קורס: <b>שם ({course_id})</b></span>'
            f'<table class="tableblds" dir="rtl">{rows}</table></body></html>')


def parse(html, course_id="0512-3513", **kwargs):
    return parse_ims_prerequisites(
        html, course_id=course_id, semester="20261",
        source_url=f"{BASE}?kurs={course_id.replace('-', '')}&kv=01&sem=20261", **kwargs,
    )


def test_captured_4100_alternatives_preserve_or_and_provenance():
    capture = Path(__file__).resolve().parents[1] / ".tmp/ee-prereq/05124100.html"
    if not capture.exists():
        pytest.skip("Local official IMS capture is unavailable")
    result = parse(capture.read_text(encoding="utf-8"), "0512-4100")
    assert result["prerequisites"] == {"any_of": [leaf("0512-3632"), leaf("0512-2532")]}
    assert result["corequisites"] is None
    assert result["status"] == "unknown"
    assert result["identity_verified"] is True
    assert result["course_id"] == "0512-4100"
    assert result["semester"] == "20261"
    assert result["source_url"] == f"{BASE}?kurs=05124100&kv=01&sem=20261"


def test_4100_or_layout_without_local_capture():
    rows = course("0512-3632") + operator("או") + course("0512-2532")
    result = parse(page(section(PRE, group(rows)), "0512-4100"), "0512-4100")
    assert result["prerequisites"] == {"any_of": [leaf("0512-3632"), leaf("0512-2532")]}


def test_official_3513_layout_is_and_of_two_or_groups():
    # Read from IMS Drishot_L.aspx?kurs=05123513&kv=01&sem=20261.
    rows = (group(course("0512-2508") + operator("או") + course("0512-2509"))
            + operator("וגם")
            + group(course("0512-2531") + operator("או") + course("0512-2832")))
    result = parse(page(section(PRE, rows)))
    assert result["prerequisites"] == {"all_of": [
        {"any_of": [leaf("0512-2508"), leaf("0512-2509")]},
        {"any_of": [leaf("0512-2531"), leaf("0512-2832")]},
    ]}


def test_official_3581_layout_separates_corequisites():
    # Read from IMS Drishot_L.aspx?kurs=05123581&kv=01&sem=20261.
    rows = section(PRE, group(course("0512-2508") + operator("וגם") + course("0512-3513")))
    rows += operator("&nbsp;") + section(CO, group(course("0512-3526")))
    result = parse(page(rows, "0512-3581"), "0512-3581")
    assert result["status"] == "verified"
    assert result["prerequisites"] == {"all_of": [leaf("0512-2508"), leaf("0512-3513")]}
    assert result["corequisites"] == leaf("0512-3526")


def test_or_of_and_groups_preserves_parentheses():
    rows = group(course("0512-2508") + operator("וגם") + course("0512-2509"))
    rows += operator("או") + group(course("0512-2531") + operator("וגם") + course("0512-2832"))
    assert parse(page(section(PRE, rows)))["prerequisites"] == {"any_of": [
        {"all_of": [leaf("0512-2508"), leaf("0512-2509")]},
        {"all_of": [leaf("0512-2531"), leaf("0512-2832")]},
    ]}


def test_explicit_none_is_distinct_from_missing_or_empty():
    rows = section(PRE, "<tr><td>אין דרישות קדם</td></tr>")
    rows += section(CO, "<tr><td>אין דרישות מקבילות</td></tr>")
    result = parse(page(rows))
    assert result["status"] == "verified"
    assert result["prerequisites"] == result["corequisites"] == {"all_of": []}
    assert parse(page(section(PRE, "")))["prerequisites"] is None
    assert parse(page(""))["prerequisites"] is None
    assert parse(page("<div>אין נתונים</div>"))["status"] == "unknown"


@pytest.mark.parametrize("rows", [
    course("0512-2508") + course("0512-2509"),
    course("0512-2508") + operator("וגם") + course("0512-2509") + operator("או") + course("0512-2832"),
    operator("או") + course("0512-2508"),
    course("0512-2508") + operator("או"),
    course("0512-2508") + operator("וגם") + operator("או") + course("0512-2509"),
    course("0512-2508") + operator("בתנאי אישור מרצה") + course("0512-2509"),
    "<tr><td>ציון 80 לפחות</td></tr>",
    "<tr><td>0512-2508 או 0512-2509</td><td>קורס</td></tr>",
    "<tr><td><table><tr><td>0512-2508</td><td>קורס</td></tr></table>באישור</td></tr>",
    "<tr><td><table><tr><td>0512-2508</td><td>קורס</td></tr></table><table></table></td></tr>",
    "<tr><td>0512-2508</td><td>קורס</td><td>אישור</td></tr>",
])
def test_ambiguous_or_unsupported_rows_are_unknown(rows):
    result = parse(page(section(PRE, group(rows))))
    assert result["prerequisites"] is None
    assert result["status"] == "unknown"
    assert result["issues"]


@pytest.mark.parametrize("html", [
    page(section(PRE, group(course("0512-2508"))), "0512-4100"),
    page(section(PRE, group(course("0512-2508")))).replace("2026/2027", "2025/2026"),
    page(section(PRE, group(course("0512-2508")))).replace('קורס:', 'פרטים:'),
])
def test_identity_mismatch_discards_expressions(html):
    result = parse(html)
    assert result["identity_verified"] is False
    assert result["prerequisites"] is result["corequisites"] is None


@pytest.mark.parametrize("url", [
    f"{BASE}?kurs=05124100&kv=01&sem=20261",
    f"{BASE}?kurs=05123513&kv=01&sem=20251",
    f"{BASE}?kurs=05123513&kv=01&sem=20261&sem=20251",
    f"{BASE}?kurs=05123513&kv=01&sem=20261&sem=",
    "https://example.com/tal/kr/Drishot_L.aspx?kurs=05123513&kv=01&sem=20261",
])
def test_source_identity_is_checked(url):
    result = parse_ims_prerequisites(page(section(PRE, group(course("0512-2508")))),
        course_id="0512-3513", semester="20261", source_url=url)
    assert result["identity_verified"] is False
    assert result["status"] == "unknown"


def test_duplicate_sections_and_tables_are_unknown():
    rows = section(PRE, group(course("0512-2508")))
    assert parse(page(rows + rows))["prerequisites"] is None
    assert parse(page(rows) + page(rows))["prerequisites"] is None


def test_expression_and_html_budgets_fail_closed():
    rows = course("0512-2508") + operator("או") + course("0512-2509")
    assert parse(page(section(PRE, group(rows))), max_nodes=2)["prerequisites"] is None
    for _ in range(6):
        rows = group(rows)
    assert parse(page(section(PRE, rows)), max_depth=3)["prerequisites"] is None
    assert parse(" " * 1_000_001)["status"] == "unknown"


@pytest.mark.parametrize("kwargs", [
    {"max_nodes": 0}, {"max_nodes": True}, {"max_nodes": 4097},
    {"max_depth": 0}, {"max_depth": 33}, {"max_depth": "16"},
])
def test_invalid_limits_are_unknown(kwargs):
    assert parse(page(section(PRE, group(course("0512-2508")))), **kwargs)["status"] == "unknown"


def test_dom_limits_and_empty_groups_are_unknown():
    rows = section(PRE, group(course("0512-2508")))
    assert parse(page(rows).replace("</body>", "<div></div>" * 20_001 + "</body>"))["prerequisites"] is None
    assert parse(page(rows).replace("</body>", "<div>" * 65 + "</div>" * 65 + "</body>"))["prerequisites"] is None
    assert parse(page(section(PRE, group("") + group(course("0512-2508")))))["prerequisites"] is None


def test_unknown_section_does_not_discard_verified_other_section():
    rows = section(PRE, group(course("0512-2508") + operator("או")))
    rows += section(CO, group(course("0512-3526")))
    result = parse(page(rows))
    assert result["prerequisites"] is None
    assert result["corequisites"] == leaf("0512-3526")
    assert result["status"] == "unknown"


def test_explicit_tbody_is_supported():
    html = page(section(PRE, group(course("0512-2508"))))
    html = html.replace('<table class="tableblds" dir="rtl">', '<table class="tableblds" dir="rtl"><tbody>')
    html = html.replace('</table></body>', '</tbody></table></body>')
    assert parse(html)["prerequisites"] == leaf("0512-2508")


@pytest.mark.parametrize("expression", [
    None, [], {}, {"course_id": "05122508"}, {"course_id": "0512-2508", "all_of": []},
    {"any_of": []}, {"all_of": [None]}, {"all_of": "0512-2508"},
    {"any_of": [{"course_id": "0512-2508", "extra": True}]},
])
def test_expression_validator_rejects_invalid_shapes(expression):
    assert validate_expression(expression) is False


def test_expression_validator_bounds_and_cycles():
    assert validate_expression({"all_of": []})
    assert validate_expression({"any_of": [leaf("0512-3632"), leaf("0512-2532")]})
    assert not validate_expression({"all_of": [leaf("0512-2508")]}, max_nodes=1)
    assert not validate_expression({"all_of": [leaf("0512-2508")]}, max_depth=1)
    cyclic = {"all_of": []}
    cyclic["all_of"].append(cyclic)
    assert not validate_expression(cyclic)
