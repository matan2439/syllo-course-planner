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
    "0599-5001": ("סמינר מתקדם סינתטי", "B", 2, 2.0),
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
    preview = json.loads(degree.early_index_path(out).with_name("preview_early_year_courses.json").read_text(encoding="utf-8"))
    assert [r["courseId"] for r in preview[PROGRAM_ID]] == ["0599-1001", "0599-2001"]
    # ... and does once the degree is live.
    import build_early_years_board as early
    registry.set_status(PROGRAM_ID, "live", path=registry_file)
    early.write_early_year_index(boards_dir=paths["early_years"].parent, path=degree.early_index_path(out))
    index = json.loads(degree.early_index_path(out).read_text(encoding="utf-8"))
    assert [r["courseId"] for r in index[PROGRAM_ID]] == ["0599-1001", "0599-2001"]


def _setup(tmp_path, monkeypatch, mandatory, degree_years=4, general=None):
    """Registry + spec (+ facts snapshot for a build into tmp_path/out); returns (entry, out)."""
    registry_file = tmp_path / "programs.json"
    registry_file.write_text(json.dumps({"programs": [_entry()]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(registry, "DEFAULT_PATH", registry_file)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    entry = registry.get_program(PROGRAM_ID)
    used = {cid for cid, _ in mandatory}
    spec = DegreeSpec(
        program_id=PROGRAM_ID, institution="tau", source_year=SHANA, total_required_credits=11.5,
        catalog_year_policy="start_year", degree_years=degree_years,
        mandatory_courses=[MandatoryCourse(course_id=cid, year=y, semester=COURSES[cid][1],
                                           placement_rule="fixed_semester") for cid, y in mandatory],
        categories=[Category(category_id="electives", name_he="בחירה", min_courses=1,
                             course_ids=[c for c in ("0599-4101", "0599-4102") if c not in used])],
        group_minimums={}, general_requirement=general, ui={}, legacy={},
    )
    write_spec(spec, spec_mod.spec_path(entry))
    out = tmp_path / "out"
    facts_file = out / "official" / f"tau_course_facts_{SHANA}.json"
    facts_file.parent.mkdir(parents=True)
    facts_file.write_text(json.dumps(_facts(), ensure_ascii=False), encoding="utf-8")
    return entry, out


def _semester_ids(year_from, year_to):
    return [f"year_{y}_semester_{h}" for y in range(year_from, year_to + 1) for h in "ab"]


@pytest.mark.parametrize("degree_years, mandatory, main_years", [
    # A 3-year degree: the main board is Year 3 only (2 semesters).
    (3, [("0599-1001", 1), ("0599-2001", 2), ("0599-3002", 3)], (3, 3)),
    # A 5-year degree: the main board is Years 3-5 (6 semesters).
    (5, [("0599-1001", 1), ("0599-2001", 2), ("0599-3002", 3), ("0599-4001", 4), ("0599-5001", 5)], (3, 5)),
    # An electives-only final year is not a refusal: Year 4 has no mandatory course.
    (4, [("0599-1001", 1), ("0599-2001", 2), ("0599-3002", 3)], (3, 4)),
])
def test_build_follows_degree_years(tmp_path, monkeypatch, capsys, degree_years, mandatory, main_years):
    entry, out = _setup(tmp_path, monkeypatch, mandatory, degree_years, general=GENERAL)
    assert degree.main(["build", "--program", PROGRAM_ID, "--offline", "--out-dir", str(out)]) == 0

    paths = degree.board_paths(entry, out)
    boards = {key: json.loads(paths[key].read_text(encoding="utf-8"))
              for key in ("semester_board", "board", "early_years")}
    for key, board in boards.items():
        errors = [i for i in audit_board(board) if i.level == "error"]
        assert errors == [], (key, errors)

    expected = _semester_ids(*main_years)
    for key in ("semester_board", "board"):
        assert [s["semester_id"] for s in boards[key]["semesters"]] == expected, key
        assert boards[key]["metadata"]["start_year"] == 3
    assert [s["semester_id"] for s in boards["early_years"]["semesters"]] == _semester_ids(1, 2)

    main = boards["board"]
    placed = {c["course_id"]: s["semester_id"] for s in main["semesters"] for c in s.get("courses", [])}
    late = {cid: f"year_{y}_semester_{COURSES[cid][1].lower()}" for cid, y in mandatory if y >= 3}
    assert {cid: placed.get(cid) for cid in late} == late
    # Every repository course (the general requirement's included) is allowed only in the
    # board's own semesters.
    for c in main["metadata"]["program_repository_courses"]:
        assert set(c.get("effective_allowed_semesters") or []) <= set(expected), c["course_id"]
    general = [c for c in main["metadata"]["program_repository_courses"]
               if c.get("category_id") == GENERAL["category_id"]]
    offered = [c for c in general if set(c.get("offered_semesters") or []) & {"A", "B"}]
    assert offered  # (courses not offered this year have no allowed semesters at all)
    for c in offered:
        assert c["effective_allowed_semesters"], c["course_id"]
        assert set(c["effective_allowed_semesters"]) <= set(expected), c["course_id"]
    early = boards["early_years"]
    placed_early = {c["course_id"] for s in early["semesters"] for c in s.get("courses", [])}
    assert placed_early == {cid for cid, y in mandatory if y <= 2}


@pytest.mark.parametrize("degree_years, years, message", [
    (4, (1, 2, 3, 4, 5), "is in year 5, outside the degree's years 1-4"),  # a 5th year in a 4-year degree
    (3, (1, 2, 3, 4), "is in year 4, outside the degree's years 1-3"),  # a 4th year in a 3-year degree
])
def test_build_refuses_mandatory_years_outside_the_degree(tmp_path, monkeypatch, capsys, degree_years, years,
                                                          message):
    ids = ["0599-1001", "0599-2001", "0599-3002", "0599-4001", "0599-5001"]
    entry, out = _setup(tmp_path, monkeypatch, [(ids[i], y) for i, y in enumerate(years)], degree_years)
    built = degree.board_paths(entry, out)
    assert degree.main(["build", "--program", PROGRAM_ID, "--offline", "--out-dir", str(out)]) == 2
    err = capsys.readouterr().err
    assert "refusing to build" in err and message in err
    assert not any(p.exists() for p in built.values())  # refused before any board was written
