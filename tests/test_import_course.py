"""
Tests for the single-course import pipeline.

Fetch functions are monkeypatched to return cached HTML so no network calls
are made. JSON files are written to tmp_path. DB goes to a tmp SQLite file.
"""

import json
import pytest
from pathlib import Path

from app.database.db import init_db, get_course_by_id
from app.pipeline.import_course import import_course_pipeline, _pick_syllabus_group

# ---------------------------------------------------------------------------
# Cached HTML fixtures (skip if not present)
# ---------------------------------------------------------------------------

_COURSE_HTML_PATH   = Path("data/raw_html/course_03682157_2025.html")
_SYLLABUS_HTML_PATH = Path("data/raw_html/syllabus_03682157_2025_01.html")


@pytest.fixture
def course_html():
    if not _COURSE_HTML_PATH.exists():
        pytest.skip(f"Missing: {_COURSE_HTML_PATH}")
    return _COURSE_HTML_PATH.read_text(encoding="utf-8")


@pytest.fixture
def syllabus_html():
    if not _SYLLABUS_HTML_PATH.exists():
        pytest.skip(f"Missing: {_SYLLABUS_HTML_PATH}")
    return _SYLLABUS_HTML_PATH.read_text(encoding="utf-8")


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "pipeline_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# _pick_syllabus_group
# ---------------------------------------------------------------------------

def _g(num, url):
    return {"group_num": num, "syllabus_url": url}


def test_pick_prefers_explicit_group():
    groups = [_g("01", "url-01"), _g("02", "url-02")]
    url, num = _pick_syllabus_group(groups, preferred_group="02")
    assert url == "url-02" and num == "02"


def test_pick_prefers_group_01_by_default():
    groups = [_g("03", "url-03"), _g("01", "url-01"), _g("02", "url-02")]
    url, num = _pick_syllabus_group(groups, preferred_group=None)
    assert num == "01"


def test_pick_falls_back_to_first_with_url():
    groups = [_g("05", "url-05"), _g("06", "url-06")]
    url, num = _pick_syllabus_group(groups, preferred_group=None)
    assert num == "05"


def test_pick_no_url_returns_none():
    groups = [{"group_num": "01", "syllabus_url": None}]
    assert _pick_syllabus_group(groups, None) == (None, None)


def test_pick_empty_groups_returns_none():
    assert _pick_syllabus_group([], None) == (None, None)


def test_pick_explicit_group_missing_falls_back_to_01():
    groups = [_g("01", "url-01"), _g("02", "url-02")]
    url, num = _pick_syllabus_group(groups, preferred_group="99")
    assert num == "01"


def test_pick_skips_groups_with_no_url():
    groups = [
        {"group_num": "01", "syllabus_url": None},
        _g("02", "url-02"),
    ]
    url, num = _pick_syllabus_group(groups, preferred_group=None)
    assert num == "02"


# ---------------------------------------------------------------------------
# Full pipeline — monkeypatched fetchers
# ---------------------------------------------------------------------------

def test_pipeline_returns_correct_course_id(
    monkeypatch, tmp_path, tmp_db, course_html, syllabus_html
):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert result["course_id"] == "0368-2157"


def test_pipeline_groups_count(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert result["groups_count"] == 19


def test_pipeline_syllabus_url_set(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert result["syllabus_url"] is not None
    assert "Syllabus" in result["syllabus_url"]


def test_pipeline_course_json_written(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert (tmp_path / "course_03682157_2025.json").exists()


def test_pipeline_syllabus_json_written(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    syl_files = list(tmp_path.glob("syllabus_*.json"))
    assert len(syl_files) == 1


def test_pipeline_merged_json_written(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert Path(result["merged_path"]).exists()


def test_pipeline_merged_json_valid(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    data = json.loads(Path(result["merged_path"]).read_text(encoding="utf-8"))
    assert data["course_id"] == "0368-2157"
    assert "groups" in data
    assert "prerequisite_course_ids" in data


def test_pipeline_db_imported(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert result["db_imported"] is True
    record = get_course_by_id("0368-2157", tmp_db)
    assert record is not None
    assert record["course_id"] == "0368-2157"


def test_pipeline_db_has_prereqs(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    record = get_course_by_id("0368-2157", tmp_db)
    assert "03681105" in record["prerequisite_course_ids"]


# ---------------------------------------------------------------------------
# skip_db flag
# ---------------------------------------------------------------------------

def test_skip_db_does_not_import(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page",
                        lambda *a, **k: syllabus_html)

    result = import_course_pipeline("0368-2157", 2025, skip_db=True, db_path=tmp_db, json_dir=tmp_path)
    assert result["db_imported"] is False
    assert get_course_by_id("0368-2157", tmp_db) is None


# ---------------------------------------------------------------------------
# No syllabus URL available
# ---------------------------------------------------------------------------

def test_pipeline_no_syllabus_url(monkeypatch, tmp_path, tmp_db, course_html):
    """Pipeline should complete and import even when all syllabus URLs are stripped."""
    import json as _json
    from app.parsing.course_search_parser import parse_course_search_result

    real_result = parse_course_search_result(course_html, 2025)
    stripped = real_result.model_dump()
    for g in stripped["groups"]:
        g["syllabus_url"] = None

    from app.models.course import CourseSearchResult
    mock_result = CourseSearchResult(**{k: v for k, v in stripped.items()
                                        if k != "source_file"})

    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)
    monkeypatch.setattr("app.pipeline.import_course.parse_course_search_result",
                        lambda *a, **k: mock_result)

    result = import_course_pipeline("0368-2157", 2025, db_path=tmp_db, json_dir=tmp_path)
    assert result["syllabus_url"] is None
    assert result["db_imported"] is True
    record = get_course_by_id("0368-2157", tmp_db)
    assert record is not None


# ---------------------------------------------------------------------------
# --group flag
# ---------------------------------------------------------------------------

def test_pipeline_explicit_group_used(monkeypatch, tmp_path, tmp_db, course_html, syllabus_html):
    monkeypatch.setattr("app.pipeline.import_course.fetch_course_search_page",
                        lambda *a, **k: course_html)

    captured = {}
    def mock_fetch_syllabus(url, course_id, year, group_number=None, force_refresh=False):
        captured["group_number"] = group_number
        return syllabus_html

    monkeypatch.setattr("app.pipeline.import_course.fetch_syllabus_page", mock_fetch_syllabus)

    import_course_pipeline("0368-2157", 2025, group="02", db_path=tmp_db, json_dir=tmp_path)
    assert captured["group_number"] == "02"
