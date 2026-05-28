"""
Tests for app/parsing/tau_program_parser.py.
All tests use fixture files — no network calls.
"""

import json
from pathlib import Path

import pytest

from app.parsing.tau_program_parser import (
    normalize_course_id,
    parse_program_body,
    parse_prereq_body,
    enrich_pdf_program,
    _extract_year_from_teurrama,
    _extract_semester_code,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_FIXTURES = Path("tests/fixtures")


@pytest.fixture(scope="module")
def program_fixture_body() -> list[dict]:
    path = _FIXTURES / "tau_program_fixture.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["data"]["results"]["body"]


@pytest.fixture(scope="module")
def program_data(program_fixture_body) -> dict:
    return parse_program_body(program_fixture_body)


@pytest.fixture(scope="module")
def prereq_fixture_body() -> list[dict]:
    path = _FIXTURES / "tau_prereq_fixture.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["data"]["results"]["body"]


@pytest.fixture(scope="module")
def prereq_data(prereq_fixture_body) -> dict:
    return parse_prereq_body(prereq_fixture_body)


# ---------------------------------------------------------------------------
# 0. Helpers
# ---------------------------------------------------------------------------

class TestNormalizeCourseId:
    def test_8_digits_no_hyphen(self):
        assert normalize_course_id("05421204") == "0542-1204"

    def test_already_hyphenated(self):
        assert normalize_course_id("0542-1204") == "0542-1204"

    def test_with_spaces(self):
        assert normalize_course_id("0542 1204") == "0542-1204"


class TestExtractYear:
    def test_year_1(self):
        assert _extract_year_from_teurrama("שנה א") == 1

    def test_year_3(self):
        assert _extract_year_from_teurrama("שנה ג") == 3

    def test_unrecognised(self):
        assert _extract_year_from_teurrama("קורסי חובה") is None


class TestExtractSemester:
    def test_semester_a(self):
        assert _extract_semester_code("סמסטר א") == "a"

    def test_semester_b(self):
        assert _extract_semester_code("סמסטר ב") == "b"

    def test_no_semester(self):
        assert _extract_semester_code("קורסי חובה") is None


# ---------------------------------------------------------------------------
# 1. Parser extracts course IDs and names
# ---------------------------------------------------------------------------

class TestCourseIdsAndNames:
    def test_mandatory_course_ids_are_hyphenated(self, program_data):
        for c in program_data["mandatory_courses"]:
            cid = c["course_id"]
            assert "-" in cid, f"course_id {cid!r} should contain a hyphen"

    def test_mandatory_course_has_name(self, program_data):
        for c in program_data["mandatory_courses"]:
            assert c["name_he"], f"course {c['course_id']} has empty name_he"

    def test_elective_core_ids_are_hyphenated(self, program_data):
        for c in program_data["elective_core_courses"]:
            assert "-" in c["course_id"]

    def test_specific_y1a_course_id_present(self, program_data):
        ids = {c["course_id"] for c in program_data["mandatory_courses"]}
        assert "0509-1510" in ids

    def test_specific_y1a_course_name(self, program_data):
        course = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert "גרפיקה" in course["name_he"]


# ---------------------------------------------------------------------------
# 2. Parser extracts year and semester structure
# ---------------------------------------------------------------------------

class TestYearSemesterStructure:
    def test_year_1_courses_have_year_1(self, program_data):
        y1 = [c for c in program_data["mandatory_courses"] if c["year"] == 1]
        assert len(y1) > 0

    def test_year_3_courses_have_year_3(self, program_data):
        y3 = [c for c in program_data["mandatory_courses"] if c["year"] == 3]
        assert len(y3) > 0

    def test_year_4_courses_have_year_4(self, program_data):
        y4 = [c for c in program_data["mandatory_courses"] if c["year"] == 4]
        assert len(y4) > 0

    def test_y1a_course_allowed_semester_a(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert "year_1_semester_a" in c["allowed_semesters"]

    def test_y4_mandatory_has_both_semesters(self, program_data):
        y4 = [c for c in program_data["mandatory_courses"] if c["year"] == 4]
        for c in y4:
            # Y4 קורסי חובה should have both semesters as options
            assert len(c["allowed_semesters"]) == 2, (
                f"Y4 course {c['course_id']} should have 2 allowed semesters"
            )


# ---------------------------------------------------------------------------
# 3. Parser identifies mandatory courses (not elective or specialization)
# ---------------------------------------------------------------------------

class TestMandatoryCoursesIdentification:
    def test_mandatory_courses_list_nonempty(self, program_data):
        assert len(program_data["mandatory_courses"]) > 0

    def test_y4_project_courses_are_mandatory(self, program_data):
        ids = {c["course_id"] for c in program_data["mandatory_courses"]}
        assert "0542-4010" in ids
        assert "0542-4020" in ids

    def test_elective_core_not_in_mandatory(self, program_data):
        mandatory_ids = {c["course_id"] for c in program_data["mandatory_courses"]}
        elective_ids = {c["course_id"] for c in program_data["elective_core_courses"]}
        overlap = mandatory_ids & elective_ids
        assert not overlap, f"Courses appear in both mandatory and elective: {overlap}"


# ---------------------------------------------------------------------------
# 4. Parser extracts hours
# ---------------------------------------------------------------------------

class TestHoursExtraction:
    def test_weekly_hours_are_floats(self, program_data):
        for c in program_data["mandatory_courses"]:
            if c["weekly_hours"] is not None:
                assert isinstance(c["weekly_hours"], float)

    def test_credit_hours_are_floats(self, program_data):
        for c in program_data["mandatory_courses"]:
            if c["credit_hours"] is not None:
                assert isinstance(c["credit_hours"], float)

    def test_y1a_graphics_hours(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert c["weekly_hours"] == 5.0
        assert c["credit_hours"] == 4.0

    def test_teaching_format_extracted(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert len(c["teaching_format"]) >= 1
        types = [f["type"] for f in c["teaching_format"]]
        assert any(t for t in types)

    def test_elective_core_hours_are_floats(self, program_data):
        for c in program_data["elective_core_courses"]:
            if c["weekly_hours"] is not None:
                assert isinstance(c["weekly_hours"], float)


# ---------------------------------------------------------------------------
# 5. Parser deduplicates multi-semester courses
# ---------------------------------------------------------------------------

class TestDeduplication:
    def test_0542_3620_appears_once(self, program_data):
        """0542-3620 (מעבר חם) is listed in both Y3A and Y3B — should appear once."""
        count = sum(
            1 for c in program_data["mandatory_courses"] if c["course_id"] == "0542-3620"
        )
        assert count == 1, f"Expected 1 occurrence of 0542-3620, got {count}"

    def test_no_duplicate_mandatory_course_ids(self, program_data):
        ids = [c["course_id"] for c in program_data["mandatory_courses"]]
        assert len(ids) == len(set(ids)), "Duplicate course IDs found in mandatory_courses"

    def test_no_duplicate_elective_core_course_ids(self, program_data):
        ids = [c["course_id"] for c in program_data["elective_core_courses"]]
        # Elective core dedup not strictly required but IDs should match fixture
        # (fixture has no duplicates)
        assert len(ids) == len(set(ids))


# ---------------------------------------------------------------------------
# 6. allowed_semesters correct for multi-semester courses
# ---------------------------------------------------------------------------

class TestAllowedSemesters:
    def test_multi_semester_course_has_both(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0542-3620"
        )
        sems = c["allowed_semesters"]
        assert "year_3_semester_a" in sems
        assert "year_3_semester_b" in sems

    def test_multi_semester_course_not_locked(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0542-3620"
        )
        assert c["locked_by_default"] is False

    def test_multi_semester_placement_rule(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0542-3620"
        )
        assert c["placement_rule"] == "choose_one_allowed_semester"

    def test_single_semester_course_is_locked(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert c["locked_by_default"] is True

    def test_single_semester_course_has_one_allowed(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert len(c["allowed_semesters"]) == 1


# ---------------------------------------------------------------------------
# 7. Core category mapping
# ---------------------------------------------------------------------------

class TestCoreCategoryMapping:
    def test_fluids_section_mapped(self, program_data):
        fluids = [c for c in program_data["elective_core_courses"] if c["category_id"] == "fluids"]
        assert len(fluids) > 0

    def test_solids_section_mapped(self, program_data):
        solids = [c for c in program_data["elective_core_courses"] if c["category_id"] == "solids"]
        assert len(solids) > 0

    def test_fluids_course_id_present(self, program_data):
        fluids = [c for c in program_data["elective_core_courses"] if c["category_id"] == "fluids"]
        ids = {c["course_id"] for c in fluids}
        assert "0542-4120" in ids

    def test_solids_course_id_present(self, program_data):
        solids = [c for c in program_data["elective_core_courses"] if c["category_id"] == "solids"]
        ids = {c["course_id"] for c in solids}
        assert "0542-4220" in ids

    def test_elective_core_has_section_he(self, program_data):
        for c in program_data["elective_core_courses"]:
            assert c.get("section_he"), f"Course {c['course_id']} missing section_he"

    def test_specialization_courses_have_track(self, program_data):
        for c in program_data["specialization_courses"]:
            assert c.get("specialization_track_he"), (
                f"Course {c['course_id']} missing specialization_track_he"
            )


# ---------------------------------------------------------------------------
# 8. Missing / bad input produces warnings, not crashes
# ---------------------------------------------------------------------------

class TestRobustness:
    def test_empty_body_returns_warnings(self):
        result = parse_program_body([])
        assert len(result["parse_warnings"]) > 0

    def test_empty_body_returns_empty_lists(self):
        result = parse_program_body([])
        assert result["mandatory_courses"] == []
        assert result["elective_core_courses"] == []
        assert result["specialization_courses"] == []

    def test_missing_kurs_fields_dont_crash(self):
        """A kurs with only minimal fields should still parse."""
        minimal_body = [{
            "teurshana": "תשפ\"ו",
            "tclongkey": "054211010000",
            "teurtochnit": "test",
            "teurtoar": "B.Sc.",
            "teurshaot": "ש\"ס",
            "hesbernosaf": "",
            "rama": [{
                "ramaid": "1",
                "teurrama": "שנה א",
                "rama": [{
                    "ramaid": "7",
                    "teurrama": "סמסטר א",
                    "kurs": [{
                        "kursid": "05421234",
                        "kursshow": "0542-1234",
                        "teurkurs": "קורס לדוגמה",
                    }]
                }]
            }]
        }]
        result = parse_program_body(minimal_body)
        assert len(result["mandatory_courses"]) == 1
        assert result["mandatory_courses"][0]["course_id"] == "0542-1234"

    def test_cancelled_course_excluded(self):
        body = [{
            "teurshana": "תשפ\"ו",
            "tclongkey": "054211010000",
            "teurtochnit": "test",
            "teurtoar": "B.Sc.",
            "teurshaot": "ש\"ס",
            "hesbernosaf": "",
            "rama": [{
                "ramaid": "1",
                "teurrama": "שנה א",
                "rama": [{
                    "ramaid": "7",
                    "teurrama": "סמסטר א",
                    "kurs": [{
                        "kursid": "05421234",
                        "kursshow": "0542-1234",
                        "teurkurs": "קורס מבוטל",
                        "mevutal": "1",
                    }]
                }]
            }]
        }]
        result = parse_program_body(body)
        assert result["mandatory_courses"] == []


# ---------------------------------------------------------------------------
# 9. Prerequisites text preserved
# ---------------------------------------------------------------------------

class TestPrerequisites:
    def test_prereq_name_extracted(self, prereq_data):
        assert prereq_data["name_he"] == "המרת אנרגיה והנע חשמלי"

    def test_prereq_kedem_text_not_empty(self, prereq_data):
        assert prereq_data["prereq_kedem_text"]

    def test_prereq_kedem_contains_course_id(self, prereq_data):
        assert "0509-1829" in prereq_data["prereq_kedem_ids"]

    def test_prereq_kedem_contains_second_course_id(self, prereq_data):
        assert "0512-1205" in prereq_data["prereq_kedem_ids"]

    def test_prereq_makbilot_ids(self, prereq_data):
        assert "0512-1205" in prereq_data["prereq_makbilot_ids"]

    def test_prereq_makbilot_text_not_empty(self, prereq_data):
        assert prereq_data["prereq_makbilot_text"]

    def test_parse_prereq_empty_body(self):
        result = parse_prereq_body([])
        assert result["prereq_kedem_ids"] == []
        assert "Empty" in result["parse_warnings"][0]

    def test_has_prereqs_flag_mandatory(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0542-1204"
        )
        assert c["has_prereqs"] is True

    def test_no_prereqs_flag(self, program_data):
        c = next(
            c for c in program_data["mandatory_courses"] if c["course_id"] == "0509-1510"
        )
        assert c["has_prereqs"] is False


# ---------------------------------------------------------------------------
# 10. No duplicate courses in output
# ---------------------------------------------------------------------------

class TestNoDuplicates:
    def test_mandatory_courses_no_duplicates(self, program_data):
        ids = [c["course_id"] for c in program_data["mandatory_courses"]]
        assert len(ids) == len(set(ids))

    def test_elective_core_no_duplicates(self, program_data):
        ids = [c["course_id"] for c in program_data["elective_core_courses"]]
        assert len(ids) == len(set(ids))

    def test_source_field_set(self, program_data):
        for c in program_data["mandatory_courses"]:
            assert c["source"] == "tau_program_page"


# ---------------------------------------------------------------------------
# 11. PDF categories preserved after enrichment
# ---------------------------------------------------------------------------

class TestEnrichPdfProgram:
    @pytest.fixture
    def pdf_program(self):
        return {
            "program_id": "test_program",
            "program_name_he": "הנדסה מכנית",
            "elective_courses": [
                {
                    "course_id": "0542-4120",
                    "name_he": "תרמודינמיקה (2)",
                    "hours": 4,
                    "category_id": "fluids",
                },
                {
                    "course_id": "0542-4220",
                    "name_he": None,  # will be filled
                    "hours": None,
                    "category_id": "solids",
                },
            ]
        }

    @pytest.fixture
    def page_data(self):
        return {
            "mandatory_courses": [],
            "elective_core_courses": [
                {
                    "course_id": "0542-4120",
                    "name_he": "שם מדף",  # should NOT override existing name
                    "weekly_hours": 4.0,
                    "category_id": "systems",  # should NOT override PDF category
                    "teaching_format": [{"type": "שיעור", "hours": 3.0}],
                },
                {
                    "course_id": "0542-4220",
                    "name_he": "מכניקת הגמישות",
                    "weekly_hours": 4.0,
                    "category_id": "solids",
                    "teaching_format": [{"type": "שיעור", "hours": 3.0}],
                },
            ],
            "specialization_courses": [],
        }

    def test_existing_name_not_overwritten(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4120")
        assert c["name_he"] == "תרמודינמיקה (2)"

    def test_null_name_filled(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4220")
        assert c["name_he"] == "מכניקת הגמישות"

    def test_pdf_category_not_overwritten(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4120")
        # PDF says fluids — page says systems — must remain fluids
        assert c["category_id"] == "fluids"

    def test_null_hours_filled(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4220")
        assert c["hours"] == 4.0

    def test_existing_hours_not_overwritten(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4120")
        assert c["hours"] == 4

    def test_teaching_format_added_when_absent(self, pdf_program, page_data):
        enriched, _ = enrich_pdf_program(pdf_program, page_data)
        c = next(c for c in enriched["elective_courses"] if c["course_id"] == "0542-4220")
        assert c.get("teaching_format")

    def test_original_program_not_mutated(self, pdf_program, page_data):
        """enrich_pdf_program must not mutate the input dict."""
        original_name = pdf_program["elective_courses"][0]["name_he"]
        enrich_pdf_program(pdf_program, page_data)
        assert pdf_program["elective_courses"][0]["name_he"] == original_name

    def test_enriched_returns_warnings_list(self, pdf_program, page_data):
        _, warnings = enrich_pdf_program(pdf_program, page_data)
        assert isinstance(warnings, list)

    def test_other_specialization_null_name_filled(self):
        """other_specialization_electives with null name_he are enriched from page data."""
        pdf_prog = {
            "program_id": "test",
            "elective_courses": [],
            "other_specialization_electives": [
                {"course_id": "0542-4124", "name_he": None, "hours": None},
                {"course_id": "0542-4999", "name_he": None, "hours": None},  # not in page
            ],
        }
        page_d = {
            "mandatory_courses": [],
            "elective_core_courses": [],
            "specialization_courses": [
                {"course_id": "0542-4124", "name_he": "מכניקת מבנים", "weekly_hours": 3.0},
            ],
        }
        enriched, _ = enrich_pdf_program(pdf_prog, page_d)
        others = {c["course_id"]: c for c in enriched["other_specialization_electives"]}
        assert others["0542-4124"]["name_he"] == "מכניקת מבנים"
        assert others["0542-4124"]["hours"] == 3.0
        assert others["0542-4999"]["name_he"] is None  # not in page — stays None

    def test_other_specialization_category_not_changed(self):
        """Enrichment never changes category_id of other_specialization courses."""
        pdf_prog = {
            "program_id": "test",
            "elective_courses": [],
            "other_specialization_electives": [
                {"course_id": "0542-4124", "name_he": None, "hours": None, "category_id": "other_specialization"},
            ],
        }
        page_d = {
            "mandatory_courses": [],
            "elective_core_courses": [],
            "specialization_courses": [
                {"course_id": "0542-4124", "name_he": "מכניקת מבנים", "weekly_hours": 3.0, "category_id": "solids"},
            ],
        }
        enriched, _ = enrich_pdf_program(pdf_prog, page_d)
        c = enriched["other_specialization_electives"][0]
        assert c["category_id"] == "other_specialization"
