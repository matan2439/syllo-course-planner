"""`degree.py build` works for a non-ME degree from spec + official facts alone.

No curation.json, no ``legacy`` keys, no raw GraphQL / course-detail / syllabus / BIDIT caches
for the program: the builder must still write every board, and the boards must audit clean.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.analysis.board_audit import audit_board  # noqa: E402
from app.degrees import registry, spec as spec_mod  # noqa: E402
from app.degrees.spec import Category, DegreeSpec, MandatoryCourse, write_spec  # noqa: E402

TCID = "99001"
SHANA = 2026
PROGRAM_ID = "synthetic_degree_2027"
COURSES = {
    "0599-1001": ("מבוא סינתטי", "A", 4, 3.5),
    "0599-2001": ("המשך סינתטי", "B", 3, 3.0),
    "0599-4001": ("סמינר סינתטי", "A", 2, 2.0),
    "0599-3002": ("פרויקט סינתטי", "B", 3, 3.0),
    "0599-4101": ("בחירה סינתטית א", "A", 3, 3.0),
    "0599-4102": ("בחירה סינתטית ב", "B", 2, 2.0),
}


def _entry() -> dict:
    return {
        "id": PROGRAM_ID, "institution": "tau", "base": "synthetic_degree", "year": 2027,
        "sourceYear": SHANA, "nameHe": "תואר סינתטי", "nameEn": "Synthetic Degree", "track": None,
        "familyId": "synthetic_degree", "familyDescriptionHe": "תואר סינתטי",
        "descriptionHe": "תואר סינתטי", "yearLabelHe": "2027", "boardJsonFile":
        "synthetic_degree_semester_board_2027.json", "sourceIds": {"tcid": TCID}, "status": "draft",
        "isFamilyDefault": True, "capabilities": [],
    }


def _facts() -> dict:
    url = f"https://www.tau.ac.il/study-program?safa=1&shana={SHANA}&tab=schedule&tcid={TCID}"
    out = {}
    for cid, (name, sem, hours, credits) in COURSES.items():
        out[cid] = {
            "ims": {"name_he": name, "offered_semesters": [sem], "status": "offered",
                    "url": f"https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num={cid.replace('-', '')}&year={SHANA}"},
            "programs": {TCID: {
                "program": {"credits": credits, "weekly_hours": hours},
                "timetable": [sem],
                "offering": {"offered_semesters": [sem], "source": "program_timetable", "status": "offered",
                             "url": url},
            }},
        }
    return out


# A cached official program page with NO single-year ("שנה א") sections.
YEARLESS_PAGE = {"data": {"results": {"body": [{"rama": [{
    "teurrama": "קורסי חובה", "rama": [],
    "kurs": [{"kursshow": "0599-1001", "teurkurs": "מבוא סינתטי", "shaotuni": "4", "mishkal": "3.5",
              "mevutal": "0", "hidekurs": "0"}],
}]}]}}}
GENERAL = {"category_id": "shaar_ruach", "name_he": "קורסי שער רוח", "min_courses": 1, "credits_required": 2,
           "course_ids": ["0609-1005"]}


@pytest.fixture
def page_cache():
    """data/raw_html/tau_program_<synthetic tcid>_<shana>.json (gitignored), removed afterwards."""
    path = ROOT / "data" / "raw_html" / f"tau_program_{TCID}_{SHANA}.json"
    assert not path.exists()
    yield path
    path.unlink(missing_ok=True)


@pytest.mark.parametrize("legacy, cached_page", [
    ({}, False),  # spec-native, nothing cached
    ({}, True),  # spec-native: the page is not consulted
    ({"program": {"program_name_he": "תואר סינתטי"}}, True),  # legacy path, page without year sections
])
def test_build_minimal_synthetic_degree(tmp_path, monkeypatch, capsys, page_cache, legacy, cached_page):
    if cached_page:
        page_cache.parent.mkdir(parents=True, exist_ok=True)
        page_cache.write_text(json.dumps(YEARLESS_PAGE, ensure_ascii=False), encoding="utf-8")
    registry_file = tmp_path / "programs.json"
    registry_file.write_text(json.dumps({"programs": [_entry()]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(registry, "DEFAULT_PATH", registry_file)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    entry = registry.get_program(PROGRAM_ID)

    spec = DegreeSpec(
        program_id=PROGRAM_ID, institution="tau", source_year=SHANA, total_required_credits=11.5,
        catalog_year_policy="start_year",
        mandatory_courses=[
            MandatoryCourse(course_id="0599-1001", year=1, semester="A", placement_rule="fixed_semester"),
            MandatoryCourse(course_id="0599-2001", year=2, semester="B", placement_rule="fixed_semester"),
            MandatoryCourse(course_id="0599-3002", year=3, semester="B", placement_rule="fixed_semester"),
            MandatoryCourse(course_id="0599-4001", year=4, semester="A", placement_rule="fixed_semester"),
        ],
        categories=[Category(category_id="electives", name_he="בחירה", min_courses=1,
                             course_ids=["0599-4101", "0599-4102"])],
        group_minimums={}, general_requirement=GENERAL, ui={}, legacy=legacy,
    )
    write_spec(spec, spec_mod.spec_path(entry))
    assert not (spec_mod.spec_path(entry).with_name("curation.json")).exists()

    out = tmp_path / "out"
    facts_file = out / "official" / f"tau_course_facts_{SHANA}.json"
    facts_file.parent.mkdir(parents=True)
    facts_file.write_text(json.dumps(_facts(), ensure_ascii=False), encoding="utf-8")

    assert degree.main(["build", "--program", PROGRAM_ID, "--offline", "--out-dir", str(out)]) == 0

    paths = degree.board_paths(entry, out)
    for key in ("semester_board", "board", "early_years"):
        assert paths[key].exists(), key
        board = json.loads(paths[key].read_text(encoding="utf-8"))
        errors = [i for i in audit_board(board) if i.level == "error"]
        assert errors == [], (key, errors)

    main = json.loads(paths["board"].read_text(encoding="utf-8"))
    placed = {c["course_id"]: s["semester_id"] for s in main["semesters"] for c in s.get("courses", [])}
    assert placed.get("0599-3002") == "year_3_semester_b"
    assert placed.get("0599-4001") == "year_4_semester_a"
    pool = {c["course_id"] for c in main["metadata"]["program_repository_courses"]}
    assert {"0599-4101", "0599-4102"} <= pool

    # The general requirement survives the classic elective_categories format (main board only).
    main_cats = [c["category_id"] for c in main["metadata"]["program_requirements_categories"]["categories"]]
    assert main_cats == ["electives", "shaar_ruach"]
    sem = json.loads(paths["semester_board"].read_text(encoding="utf-8"))
    assert [c["category_id"] for c in sem["metadata"]["program_requirements_categories"]["categories"]] == ["electives"]

    early = json.loads(paths["early_years"].read_text(encoding="utf-8"))
    placed_early = {c["course_id"]: s["semester_id"] for s in early["semesters"] for c in s.get("courses", [])}
    assert placed_early.get("0599-1001") == "year_1_semester_a"
    assert placed_early.get("0599-2001") == "year_2_semester_b"
    # A draft's window board never enters the early-year index (it ships in the frontend bundle) ...
    index = json.loads(degree.early_index_path(out).read_text(encoding="utf-8"))
    assert PROGRAM_ID not in index
    # ... and does once the degree is live.
    import build_early_years_board as early
    registry.set_status(PROGRAM_ID, "live", path=registry_file)
    early.write_early_year_index(boards_dir=paths["early_years"].parent, path=degree.early_index_path(out))
    index = json.loads(degree.early_index_path(out).read_text(encoding="utf-8"))
    assert [r["courseId"] for r in index[PROGRAM_ID]] == ["0599-1001", "0599-2001"]


@pytest.mark.parametrize("years, message", [
    ((1, 2, 3, 4, 5), "year 5, which no board window covers"),  # a 5-year degree
    ((1, 2, 3), "expected exactly 1-4"),  # a 3-year degree
    ((1, 3, 4), "expected exactly 1-4"),  # a year with no mandatory course
])
def test_build_refuses_a_degree_that_is_not_four_years(tmp_path, monkeypatch, capsys, years, message):
    registry_file = tmp_path / "programs.json"
    registry_file.write_text(json.dumps({"programs": [_entry()]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(registry, "DEFAULT_PATH", registry_file)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    entry = registry.get_program(PROGRAM_ID)
    ids = ["0599-1001", "0599-2001", "0599-3002", "0599-4001", "0599-4101"]
    spec = DegreeSpec(
        program_id=PROGRAM_ID, institution="tau", source_year=SHANA, total_required_credits=11.5,
        catalog_year_policy="start_year",
        mandatory_courses=[MandatoryCourse(course_id=ids[i], year=y, semester="A", placement_rule="fixed_semester")
                           for i, y in enumerate(years)],
        categories=[Category(category_id="electives", name_he="בחירה", min_courses=1, course_ids=["0599-4102"])],
        group_minimums={}, general_requirement=None, ui={}, legacy={},
    )
    write_spec(spec, spec_mod.spec_path(entry))
    out = tmp_path / "out"
    assert degree.main(["build", "--program", PROGRAM_ID, "--offline", "--out-dir", str(out)]) == 2
    err = capsys.readouterr().err
    assert "refusing to build" in err and message in err
    assert not out.exists()  # refused before anything was written
