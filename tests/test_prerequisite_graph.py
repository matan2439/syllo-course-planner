import json
import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.prerequisite_graph import (
    build_prerequisite_graph,
    get_direct_prerequisites,
    get_all_prerequisites,
    get_direct_dependent_courses,
    get_all_dependent_courses,
    detect_cycles,
    export_graph_json,
)

# ---------------------------------------------------------------------------
# Helpers to build test DB state
# ---------------------------------------------------------------------------

def _course(course_id: str, prereqs: list[str]) -> dict:
    return {
        "course_id": course_id,
        "name_he": course_id,
        "name_en": None,
        "faculty": None,
        "department": None,
        "year": 2025,
        "semester": None,
        "credits": None,
        "lecture_hours": None,
        "tutorial_hours": None,
        "lab_hours": None,
        "prerequisites_raw_text": None,
        "prerequisite_course_ids": prereqs,
        "course_description": None,
        "topics": [],
        "assignments": None,
        "exam_info": None,
        "syllabus_links": [],
        "groups": [],
        "source_files": {},
    }


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "graph_test.sqlite"
    init_db(db)
    return db


@pytest.fixture
def linear_db(tmp_db):
    """A -> B -> C  (A is prereq of B, B is prereq of C)."""
    save_merged_course(_course("A", []),    tmp_db)
    save_merged_course(_course("B", ["A"]), tmp_db)
    save_merged_course(_course("C", ["B"]), tmp_db)
    return tmp_db


@pytest.fixture
def diamond_db(tmp_db):
    """A -> B, A -> C, B -> D, C -> D."""
    save_merged_course(_course("A", []),         tmp_db)
    save_merged_course(_course("B", ["A"]),      tmp_db)
    save_merged_course(_course("C", ["A"]),      tmp_db)
    save_merged_course(_course("D", ["B", "C"]), tmp_db)
    return tmp_db


@pytest.fixture
def cycle_db(tmp_db):
    """X -> Y -> Z -> X (cycle)."""
    save_merged_course(_course("X", ["Z"]), tmp_db)
    save_merged_course(_course("Y", ["X"]), tmp_db)
    save_merged_course(_course("Z", ["Y"]), tmp_db)
    return tmp_db


# ---------------------------------------------------------------------------
# build_prerequisite_graph
# ---------------------------------------------------------------------------

def test_graph_has_correct_nodes(linear_db):
    G = build_prerequisite_graph(linear_db)
    assert set(G.nodes()) >= {"A", "B", "C"}


def test_graph_has_correct_edges(linear_db):
    G = build_prerequisite_graph(linear_db)
    assert G.has_edge("A", "B")
    assert G.has_edge("B", "C")
    assert not G.has_edge("A", "C")


def test_empty_db_returns_empty_graph(tmp_db):
    G = build_prerequisite_graph(tmp_db)
    assert G.number_of_nodes() == 0
    assert G.number_of_edges() == 0


# ---------------------------------------------------------------------------
# get_direct_prerequisites
# ---------------------------------------------------------------------------

def test_direct_prereqs_single(linear_db):
    assert get_direct_prerequisites("B", linear_db) == ["A"]


def test_direct_prereqs_multiple(diamond_db):
    prereqs = get_direct_prerequisites("D", diamond_db)
    assert set(prereqs) == {"B", "C"}


def test_direct_prereqs_none(linear_db):
    assert get_direct_prerequisites("A", linear_db) == []


def test_direct_prereqs_unknown_course(linear_db):
    assert get_direct_prerequisites("UNKNOWN", linear_db) == []


def test_direct_prereqs_digit_normalization(tmp_db):
    save_merged_course(_course("0368-2157", ["0368-1105"]), tmp_db)
    result = get_direct_prerequisites("03682157", tmp_db)
    assert "0368-1105" in result


# ---------------------------------------------------------------------------
# get_all_prerequisites
# ---------------------------------------------------------------------------

def test_all_prereqs_transitive(linear_db):
    result = get_all_prerequisites("C", linear_db)
    assert set(result) == {"A", "B"}


def test_all_prereqs_diamond(diamond_db):
    result = get_all_prerequisites("D", diamond_db)
    assert set(result) == {"A", "B", "C"}


def test_all_prereqs_root(linear_db):
    assert get_all_prerequisites("A", linear_db) == []


def test_all_prereqs_unknown(linear_db):
    assert get_all_prerequisites("UNKNOWN", linear_db) == []


# ---------------------------------------------------------------------------
# get_direct_dependent_courses
# ---------------------------------------------------------------------------

def test_direct_dependents_single(linear_db):
    assert get_direct_dependent_courses("B", linear_db) == ["C"]


def test_direct_dependents_multiple(diamond_db):
    result = get_direct_dependent_courses("A", diamond_db)
    assert set(result) == {"B", "C"}


def test_direct_dependents_leaf(linear_db):
    assert get_direct_dependent_courses("C", linear_db) == []


def test_direct_dependents_unknown(linear_db):
    assert get_direct_dependent_courses("UNKNOWN", linear_db) == []


# ---------------------------------------------------------------------------
# get_all_dependent_courses
# ---------------------------------------------------------------------------

def test_all_dependents_transitive(linear_db):
    result = get_all_dependent_courses("A", linear_db)
    assert set(result) == {"B", "C"}


def test_all_dependents_diamond(diamond_db):
    result = get_all_dependent_courses("A", diamond_db)
    assert set(result) == {"B", "C", "D"}


def test_all_dependents_leaf(linear_db):
    assert get_all_dependent_courses("C", linear_db) == []


# ---------------------------------------------------------------------------
# detect_cycles
# ---------------------------------------------------------------------------

def test_no_cycles_in_dag(linear_db):
    assert detect_cycles(linear_db) == []


def test_cycle_detected(cycle_db):
    cycles = detect_cycles(cycle_db)
    assert len(cycles) >= 1
    flat = {node for cycle in cycles for node in cycle}
    assert flat >= {"X", "Y", "Z"}


def test_no_cycles_empty_graph(tmp_db):
    assert detect_cycles(tmp_db) == []


# ---------------------------------------------------------------------------
# export_graph_json
# ---------------------------------------------------------------------------

def test_export_has_required_keys(linear_db):
    data = export_graph_json(linear_db)
    assert {"nodes", "edges", "node_count", "edge_count"} <= set(data.keys())


def test_export_node_count(linear_db):
    data = export_graph_json(linear_db)
    assert data["node_count"] == 3


def test_export_edge_count(linear_db):
    data = export_graph_json(linear_db)
    assert data["edge_count"] == 2


def test_export_edges_have_from_to(linear_db):
    data = export_graph_json(linear_db)
    for edge in data["edges"]:
        assert "from" in edge and "to" in edge


def test_export_is_json_serialisable(linear_db):
    data = export_graph_json(linear_db)
    dumped = json.dumps(data)
    assert isinstance(dumped, str)


def test_export_empty_graph(tmp_db):
    data = export_graph_json(tmp_db)
    assert data["node_count"] == 0
    assert data["edge_count"] == 0
    assert data["nodes"] == []
    assert data["edges"] == []


# ---------------------------------------------------------------------------
# Integration: real DB
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


def test_real_direct_prereqs(real_db):
    result = get_direct_prerequisites("0368-2157", real_db)
    assert "0368-1105" in result


def test_real_all_prereqs_includes_direct(real_db):
    result = get_all_prerequisites("0368-2157", real_db)
    assert "0368-1105" in result


def test_real_no_cycles(real_db):
    assert detect_cycles(real_db) == []


def test_real_export_has_edges(real_db):
    data = export_graph_json(real_db)
    assert data["edge_count"] >= 1
