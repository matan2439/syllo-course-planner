"""
Directed prerequisite graph built from the SQLite database.

Edge convention: A -> B means "A is a prerequisite for B"
(i.e. you must take A before B).
"""

import json
from pathlib import Path
from typing import Any

import networkx as nx

from app.database.db import _DB_PATH, _make_engine, prerequisites, courses
from sqlalchemy import select


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_prerequisite_graph(db_path: Path = _DB_PATH) -> nx.DiGraph:
    """Load all prerequisite relations from the DB and return a DiGraph."""
    engine = _make_engine(db_path)
    G = nx.DiGraph()

    with engine.connect() as conn:
        # Add every known course as a node
        for row in conn.execute(select(courses.c.course_id)).all():
            G.add_node(row[0])

        # Add edges: prereq -> course  (prereq must come first)
        # Normalise prereq_id to XXXX-XXXX so it merges with the courses node.
        for row in conn.execute(select(prerequisites.c.course_id,
                                       prerequisites.c.prerequisite_course_id)).all():
            course_id, prereq_id = row[0], row[1]
            normalised_prereq = _normalize_course_id(prereq_id)
            G.add_node(normalised_prereq)
            G.add_edge(normalised_prereq, course_id)

    return G


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------

def get_direct_prerequisites(course_id: str, db_path: Path = _DB_PATH) -> list[str]:
    """Return courses that are direct prerequisites of course_id."""
    G = build_prerequisite_graph(db_path)
    node = _find_node(G, course_id)
    if node is None:
        return []
    return list(G.predecessors(node))


def get_all_prerequisites(course_id: str, db_path: Path = _DB_PATH) -> list[str]:
    """Return all ancestors of course_id (transitive prerequisites)."""
    G = build_prerequisite_graph(db_path)
    node = _find_node(G, course_id)
    if node is None:
        return []
    return list(nx.ancestors(G, node))


def get_direct_dependent_courses(course_id: str, db_path: Path = _DB_PATH) -> list[str]:
    """Return courses that directly require course_id as a prerequisite."""
    G = build_prerequisite_graph(db_path)
    node = _find_node(G, course_id)
    if node is None:
        return []
    return list(G.successors(node))


def get_all_dependent_courses(course_id: str, db_path: Path = _DB_PATH) -> list[str]:
    """Return all descendants of course_id (transitive dependents)."""
    G = build_prerequisite_graph(db_path)
    node = _find_node(G, course_id)
    if node is None:
        return []
    return list(nx.descendants(G, node))


def detect_cycles(db_path: Path = _DB_PATH) -> list[list[str]]:
    """Return a list of cycles found in the graph (each cycle is a list of node IDs)."""
    G = build_prerequisite_graph(db_path)
    return list(nx.simple_cycles(G))


def export_graph_json(db_path: Path = _DB_PATH) -> dict[str, Any]:
    """Return a JSON-serialisable dict with nodes and edges."""
    G = build_prerequisite_graph(db_path)
    return {
        "nodes": list(G.nodes()),
        "edges": [{"from": u, "to": v} for u, v in G.edges()],
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges(),
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize_course_id(raw: str) -> str:
    import re
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return raw


def _find_node(G: nx.DiGraph, course_id: str) -> str | None:
    """Return the matching node label, trying normalized form if needed."""
    if course_id in G:
        return course_id
    normalized = _normalize_course_id(course_id)
    if normalized in G:
        return normalized
    return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU prerequisite graph CLI")
    cli.add_argument("--course",        metavar="COURSE_ID", help="Target course")
    cli.add_argument("--prerequisites", action="store_true", help="Show prerequisites for --course")
    cli.add_argument("--dependents",    action="store_true", help="Show dependents for --course")
    cli.add_argument("--detect-cycles", action="store_true", help="Detect cycles in the graph")
    cli.add_argument("--export-json",   metavar="PATH",      help="Export graph to JSON file")
    cli.add_argument("--db",            metavar="PATH",      default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    db_path = Path(args.db)

    if args.course and args.prerequisites:
        direct = get_direct_prerequisites(args.course, db_path)
        all_p  = get_all_prerequisites(args.course, db_path)
        print(f"[graph] Course: {_normalize_course_id(args.course)}")
        print(f"  direct prerequisites  ({len(direct)}): {direct}")
        print(f"  all prerequisites     ({len(all_p)}):  {all_p}")

    elif args.course and args.dependents:
        direct = get_direct_dependent_courses(args.course, db_path)
        all_d  = get_all_dependent_courses(args.course, db_path)
        print(f"[graph] Course: {_normalize_course_id(args.course)}")
        print(f"  direct dependents ({len(direct)}): {direct}")
        print(f"  all dependents    ({len(all_d)}):  {all_d}")

    elif args.detect_cycles:
        cycles = detect_cycles(db_path)
        if cycles:
            print(f"[graph] {len(cycles)} cycle(s) detected:")
            for c in cycles:
                print(f"  {' -> '.join(c)}")
        else:
            print("[graph] No cycles detected.")

    elif args.export_json:
        data = export_graph_json(db_path)
        out = Path(args.export_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[graph] Exported {data['node_count']} nodes, {data['edge_count']} edges to {out}")

    else:
        cli.print_help()
