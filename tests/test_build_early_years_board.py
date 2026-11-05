"""The Years 1–2 board is derived from the official program structure, never hand-listed."""
import json
from pathlib import Path

from scripts.build_early_years_board import (
    mandatory_specs, official_years_by_course, title_half, title_years, window_categories,
)

ROOT = Path(__file__).resolve().parent.parent
EARLY_BOARD = ROOT / "data" / "boards" / "mechanical_engineering_years_1_2_2027.json"


def test_preview_index_is_generated_from_built_boards_without_changing_standard(tmp_path):
    from scripts.build_early_years_board import write_early_year_index

    standard_path = ROOT / "data" / "config" / "early_year_courses.json"
    before = standard_path.read_bytes()
    standard = write_early_year_index(path=tmp_path / "standard.json")
    assert standard.read_bytes() == before
    preview = write_early_year_index(path=tmp_path / "preview.json", include_drafts=True)
    index = json.loads(preview.read_text(encoding="utf-8"))
    ee = "electrical_engineering_2027"
    assert ee not in json.loads(standard.read_text(encoding="utf-8"))
    board = json.loads((ROOT / "data" / "boards" / "electrical_engineering_years_1_2_2027.json").read_text(encoding="utf-8"))
    expected = [
        {"courseId": c["course_id"], "nameHe": c["name_he"],
         "semesterId": s["semester_id"], "creditHours": c.get("credits") or 0}
        for s in board["semesters"] for c in s["courses"] if c.get("is_mandatory")
    ]
    assert len(expected) == 21
    assert index[ee] == expected
    assert preview.read_bytes() == (ROOT / "data" / "config" / "preview_early_year_courses.json").read_bytes()
    assert standard_path.read_bytes() == before


def section(title, subs):
    return {"teurrama": title, "rama": [{"teurrama": t, "kurs": [{"kursshow": c, "teurkurs": c, "shaotuni": "4", "mishkal": "3"} for c in ids]} for t, ids in subs]}


SECTIONS = [
    section("שנה א", [("סמסטר א", ["A1"]), ("סמסטר ב", ["B1"])]),
    section("שנה ב", [("סמסטר א", ["A2", "BOTH"]), ("סמסטר ב", ["BOTH"]), ("קורסי  שאר רוח", [])]),
    section("שנה ג", [("סמסטר א", ["C3"])]),
    section("שנים ג'+ד' קורסי ליבה", [("זורמים", ["CORE"])]),
]


def test_titles_parse_hebrew_years_and_halves():
    assert title_years("שנה א") == [1]
    assert title_years("שנים ג'+ד' קורסי ליבה/בחירה") == [3, 4]
    assert title_years("שנים ג+ד - קורסי  בחירה/התמחות") == [3, 4]
    assert title_years("קורסי שאר רוח") == []
    assert (title_half("סמסטר ב"), title_half("זורמים")) == ("b", None)


def test_mandatory_courses_come_from_the_window_years_only():
    specs = {s["course_id"]: s["allowed_semesters"] for s in mandatory_specs(SECTIONS, [1, 2])}
    assert specs == {
        "A1": ["year_1_semester_a"], "B1": ["year_1_semester_b"],
        "A2": ["year_2_semester_a"], "BOTH": ["year_2_semester_a", "year_2_semester_b"],
    }


def test_categories_confined_to_other_years_are_left_out():
    block = {"categories": [
        {"category_id": "core", "course_ids": ["CORE"]},
        {"category_id": "general", "course_ids": ["UNLISTED"]},
    ]}
    kept = window_categories(block, official_years_by_course(SECTIONS), [1, 2])
    assert [(c["category_id"], c["min_courses"]) for c in kept] == [("general", 0)]


def test_published_early_board_is_years_1_2_with_its_requirements():
    board = json.loads(EARLY_BOARD.read_text(encoding="utf-8"))
    assert [s["semester_id"] for s in board["semesters"]] == [
        "year_1_semester_a", "year_1_semester_b", "year_2_semester_a", "year_2_semester_b"]
    assert all(s["courses"] for s in board["semesters"])
    assert all(c["is_mandatory"] for s in board["semesters"] for c in s["courses"])
    window = {s["semester_id"] for s in board["semesters"]}
    for course in board["metadata"]["program_repository_courses"]:
        assert set(course["effective_allowed_semesters"]) <= window


def test_offline_read_never_touches_the_network(monkeypatch, tmp_path):
    import pytest
    import scripts.build_early_years_board as early

    monkeypatch.setattr(early, "ROOT", tmp_path)
    monkeypatch.setattr(early, "fetch_program_data",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    with pytest.raises(FileNotFoundError, match="offline"):
        early.read_official("8715", 2026, offline=True)
