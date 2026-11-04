#!/usr/bin/env python3
"""
One CLI for every registered degree (data/config/programs.json):

    python scripts/degree.py evidence --program <id> [--live|--offline]
    python scripts/degree.py build    --program <id> [--live|--offline] [--out-dir DIR]
    python scripts/degree.py check    --program <id>  --live|--offline
    python scripts/degree.py refresh  --program <id> [--live|--offline] [--apply [--syllabi]]

evidence  writes data/degrees/<inst>/<base>/<year>/evidence.json and prints counts by kind.
build     spec.json -> spec_to_program -> the legacy generate path (board + course-detail links
          + GraphQL names/hours) -> official facts (refresh apply + syllabus summaries) ->
          the reviewed curation overlay (curation.json) -> the Years 1-2 window board. Writes
          <out>/parsed_json/<boardJsonFile>, <out>/boards/<id>.json,
          <out>/boards/<base>_years_1_2_<year>.json and <out>/config/early_year_courses.json.
          --offline never touches the network; only --live stamps new fetch timestamps
          (otherwise the previous files' syllabus_last_fetched_at values are kept);
          --live first re-fetches every official source and REWRITES the facts snapshot
          (data/official/tau_course_facts_<year>.json; with --out-dir: <out>/official/, seeded
          from the committed snapshot) before building. The build reads its facts from
          <out>/official/ when that file exists, else from data/official/.
check     coverage + freshness + consistency + plannability + course-rule enforcement + known gaps; report in
          data/import_reports/degree_check_<id>.md; exit 0 only if every check passes.
          Requires --live (freshness needs a live fetch) or --offline (freshness SKIPPED, exit 1).
refresh   official facts for every course the spec or boards reference + a mismatch report
          (data/official/tau_course_facts_<year>.json); --apply then runs `build` into data/
          (the only board write path: curation overlay, byte-stable writer, board_data_version)
          after keeping the general-requirement catalog in step.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from app.analysis.board_audit import compute_board_hash  # noqa: E402
from app.degrees.curation import apply_curation, curation_path, load_curation  # noqa: E402
from app.degrees.facts import load_program_facts  # noqa: E402
from app.degrees.registry import ProgramEntry, get_program  # noqa: E402
from app.degrees.spec import DegreeSpec, load_spec, spec_path, spec_to_program  # noqa: E402

DATA = ROOT / "data"
REPORT_DIR = DATA / "import_reports"
DB_PATH = DATA / "database.sqlite"
SHAAR_RUACH_SOURCE = DATA / "general_courses_shaar_ruach.json"

# The program board is the Years 3-4 window (build_semester_board's default start_year); the
# Years 1-2 window board is built next to it by build_early_years_board.
MAIN_BOARD_START_YEAR = 3
EARLY_START_YEAR = 1
# BIDIT current-year schedule evidence copied from the general-requirement catalog onto its
# board records (the offline half of scripts/enrich_shaar_ruach_bidit.ts).
BIDIT_FIELDS = ("weekly_hours", "weekly_hours_source", "weekly_hours_verified_from_bidit")


def bidit_fields(source_year: int) -> tuple[str, ...]:
    """The BIDIT fields for TAU year ``source_year``: the schedule field is named for the
    academic year it ends (shana 2026 == 2026-2027 -> ``bidit_schedule_2027``)."""
    return (*BIDIT_FIELDS, f"bidit_schedule_{source_year + 1}")
TIMESTAMP_FIELDS = frozenset({"syllabus_last_fetched_at"})


# ---------------------------------------------------------------- paths / normalization


def board_paths(program: ProgramEntry, data_dir: Path | None = None) -> dict[str, Path]:
    """Every board file a program build writes, keyed the way curation.json names them."""
    data = Path(data_dir) if data_dir is not None else DATA
    return {
        "semester_board": data / "parsed_json" / program.board_json_file,
        "board": data / "boards" / f"{program.id}.json",
        "early_years": data / "boards" / f"{program.base}_years_{EARLY_START_YEAR}_{EARLY_START_YEAR + 1}_{program.year}.json",
    }


def early_index_path(data_dir: Path | None = None) -> Path:
    return (Path(data_dir) if data_dir is not None else DATA) / "config" / "early_year_courses.json"


def normalize_board(board: dict) -> dict:
    """A copy without metadata.board_data_version and generated timestamp fields (only)."""

    def strip(node):
        if isinstance(node, dict):
            return {k: strip(v) for k, v in node.items() if k not in TIMESTAMP_FIELDS}
        if isinstance(node, list):
            return [strip(v) for v in node]
        return node

    out = strip(copy.deepcopy(board))
    if isinstance(out.get("metadata"), dict):
        out["metadata"].pop("board_data_version", None)
    return out


# ---------------------------------------------------------------- build


def _refresh_module():
    import refresh_course_data

    return refresh_course_data


def _semester_ids(year: int, semester: str) -> list[str]:
    halves = ["a", "b"] if semester == "either" else [semester.lower()]
    return [f"year_{year}_semester_{h}" for h in halves]


def mandatory_courses_file(spec: DegreeSpec, start_year: int, facts: dict) -> dict:
    """The board builder's mandatory-courses input, generated from the spec (the authority).

    Placement comes from the spec; the display name and weekly hours come from the official
    facts (the builder falls back to them when the local course DB lacks a course). Every
    mandatory course is locked by default, as in the legacy hand-maintained file.
    """
    years = {start_year, start_year + 1}
    rows = []
    for m in spec.mandatory_courses:
        if m.year not in years:
            continue
        fact = facts.get(m.course_id) or {}
        rows.append({
            "course_id": m.course_id,
            "name_he": (fact.get("ims") or {}).get("name_he"),
            "weekly_hours": (fact.get("program") or {}).get("weekly_hours"),
            "year": m.year,
            "locked_by_default": True,
            "allowed_semesters": _semester_ids(m.year, m.semester),
            "placement_rule": m.placement_rule,
        })
    return {"program_id": spec.program_id, "generated_from": "spec.json mandatory_courses", "courses": rows}


def copy_bidit_schedule(board: dict, source_year: int, source: Path = SHAAR_RUACH_SOURCE) -> int:
    if not source.exists():
        return 0
    by_id = {c["course_id"]: c for c in json.loads(source.read_text(encoding="utf-8")).get("courses", [])}
    n = 0
    for course in board.get("metadata", {}).get("program_repository_courses", []):
        src = by_id.get(course.get("course_id"))
        if not src:
            continue
        for field in bidit_fields(source_year):
            if field in src:
                course[field] = src[field]
        n += 1
    return n


def _item_key(item) -> str | None:
    if isinstance(item, dict):
        for k in ("course_id", "semester_id", "category_id"):
            if k in item:
                return f"{k}={item[k]}"
    return None


def conform(new, old, keep_timestamps: bool):
    """``new`` laid out like the previous file ``old``, without changing any value.

    Keys keep the previous file's order (new keys follow), a number keeps its previous
    int/float spelling when the value is equal, and list items are matched by their id. With
    ``keep_timestamps`` (an offline build: nothing was fetched) the generated timestamp fields
    are the previous file's values, and are absent where the previous record had none.
    """
    if isinstance(new, dict) and isinstance(old, dict):
        out = {}
        for k in [k for k in old if k in new] + [k for k in new if k not in old]:
            if keep_timestamps and k in TIMESTAMP_FIELDS:
                continue
            out[k] = conform(new[k], old[k], keep_timestamps) if k in old else new[k]
        if keep_timestamps:
            order = list(old) + [k for k in out if k not in old]
            for k in TIMESTAMP_FIELDS:
                if k in old:
                    out[k] = old[k]
            out = {k: out[k] for k in order if k in out}
        return out
    if isinstance(new, list) and isinstance(old, list):
        old_by_key = {_item_key(i): i for i in old if _item_key(i) is not None}
        if old_by_key and all(_item_key(i) is not None for i in new):
            return [conform(i, old_by_key[_item_key(i)], keep_timestamps) if _item_key(i) in old_by_key
                    else _strip_timestamps(i, keep_timestamps) for i in new]
        if len(new) == len(old):
            return [conform(a, b, keep_timestamps) for a, b in zip(new, old)]
        return [_strip_timestamps(i, keep_timestamps) for i in new]
    if (isinstance(new, (int, float)) and isinstance(old, (int, float)) and not isinstance(new, bool)
            and not isinstance(old, bool) and type(new) is not type(old) and new == old):
        return old
    return _strip_timestamps(new, keep_timestamps)


def _strip_timestamps(node, keep_timestamps: bool):
    """A record with no previous counterpart: offline, it has no real fetch time to carry."""
    if not keep_timestamps:
        return node
    if isinstance(node, dict):
        return {k: _strip_timestamps(v, True) for k, v in node.items() if k not in TIMESTAMP_FIELDS}
    if isinstance(node, list):
        return [_strip_timestamps(v, True) for v in node]
    return node


def write_board(path: Path, board: dict, previous: str | None, keep_timestamps: bool) -> None:
    """Write ``board`` so that unchanged content stays byte-identical to the previous file.

    ``keep_timestamps``: nothing was fetched live, so fetch times come from the previous file.
    ``metadata.board_data_version`` is the hash of exactly the content written.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if previous is not None:
        board = conform(board, json.loads(previous), keep_timestamps=keep_timestamps)
    elif keep_timestamps:
        board = _strip_timestamps(board, True)
    if isinstance(board.get("metadata"), dict):
        board["metadata"]["board_data_version"] = compute_board_hash(board)
    text = json.dumps(board, ensure_ascii=False, indent=2)
    if previous is not None and previous.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


def build_facts_path(entry: ProgramEntry, out_dir: Path = DATA) -> Path:
    """Where a build into ``out_dir`` keeps its facts snapshot: data/official/ for data/,
    else <out_dir>/official/ (a build elsewhere never rewrites the committed snapshot)."""
    rcd = _refresh_module()
    committed = rcd.facts_path(entry.source_year)
    if Path(out_dir).resolve() == DATA.resolve():
        return committed
    return Path(out_dir) / "official" / committed.name


def build(entry: ProgramEntry, out_dir: Path = DATA, offline: bool = False, live: bool = False,
          refresh: bool = True) -> dict[str, Path]:
    """``refresh=False``: with ``live``, the caller has just refreshed the facts already."""
    from app.analysis.semester_board import official_offerings
    from app.pipeline.generate_board import generate
    import build_early_years_board as early

    rcd = _refresh_module()
    facts_file = build_facts_path(entry, out_dir)
    if live and refresh:  # build from freshly fetched official facts (writes the facts snapshot, not the boards)
        rcd.refresh(entry, None, offline=False, live=True, facts_file=facts_file)
    if not facts_file.exists():
        facts_file = rcd.facts_path(entry.source_year)
    spec_file = spec_path(entry)
    spec = load_spec(spec_file)
    curation = load_curation(curation_path(spec_file))
    tcid, shana = entry.source_ids["tcid"], entry.source_year
    facts = load_program_facts(shana, tcid, facts_file)
    offerings = official_offerings(facts)
    paths = board_paths(entry, out_dir)
    # The files being replaced: unchanged content is written back byte-identical (key order,
    # number spelling and, unless this is a live build, the previous fetch timestamps: only a
    # real live fetch stamps syllabus_last_fetched_at), so a rebuild diffs cleanly.
    previous = {key: p.read_text(encoding="utf-8") if p.exists() else None for key, p in paths.items()}

    program = spec_to_program(spec)
    with tempfile.TemporaryDirectory(prefix=f"degree_build_{entry.id}_") as tmp:
        mandatory_file = Path(tmp) / "mandatory_courses.json"
        mandatory_file.write_text(json.dumps(mandatory_courses_file(spec, MAIN_BOARD_START_YEAR, facts),
                                             ensure_ascii=False, indent=2), encoding="utf-8")
        reqs = program["requirements"]
        reqs["mandatory_courses"] = {**reqs.get("mandatory_courses", {}), "courses_file": str(mandatory_file)}

        # The legacy semester_board file is the engineering-only board: it predates the
        # general requirement (שער רוח), which only the program board carries.
        engineering_only = copy.deepcopy(program)
        engineering_only["requirements"].pop("general_requirements", None)

        for key, variant in (("semester_board", engineering_only), ("board", program)):
            path = paths[key]
            path.parent.mkdir(parents=True, exist_ok=True)
            print(f"[build] {key}: generate -> {path}")
            generate(program=variant, board_path=path, db_path=DB_PATH, tcid=tcid, shana=str(shana),
                     offline=offline, offerings=offerings)
            board = json.loads(path.read_text(encoding="utf-8"))
            changed = rcd.apply(board, facts, shana)
            summaries = rcd.refresh_syllabi(board, offline)
            bidit = copy_bidit_schedule(board, shana) if "general_requirements" in variant["requirements"] else 0
            n = apply_curation(board, curation, key)
            write_board(path, board, previous[key], keep_timestamps=not live)
            print(f"[build] {key}: facts patched {changed} records, {summaries} summaries, "
                  f"{bidit} BIDIT records, {n} curation entries")

    early_out = early.build(entry.id, EARLY_START_YEAR, tcid, shana,
                            boards_dir=paths["board"].parent, out_dir=paths["early_years"].parent,
                            offline=offline, offerings=offerings)
    if early_out != paths["early_years"]:
        raise RuntimeError(f"early board written to {early_out}, expected {paths['early_years']}")
    early_board = json.loads(early_out.read_text(encoding="utf-8"))
    apply_curation(early_board, curation, "early_years")
    write_board(early_out, early_board, previous["early_years"], keep_timestamps=not live)
    index = early.write_early_year_index(boards_dir=paths["early_years"].parent, path=early_index_path(out_dir))
    print(f"[build] early_years -> {early_out}; index -> {index}")
    return {**paths, "early_year_index": index}


# ---------------------------------------------------------------- evidence / check


def evidence_path(entry: ProgramEntry) -> Path:
    return spec_path(entry).with_name("evidence.json")


def collect(entry: ProgramEntry, live: bool, offline: bool):
    from app.degrees.evidence import collect_evidence

    return collect_evidence(entry, live=live, offline=offline)


def write_evidence(entry: ProgramEntry, items) -> Path:
    path = evidence_path(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [i.model_dump(mode="json") for i in items]
    path.write_bytes((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return path


def run_check(entry: ProgramEntry, live: bool, offline: bool) -> tuple[bool, str]:
    """All Task 5/6 checks. Offline: freshness is SKIPPED and the run never passes."""
    from app.degrees.checks import (
        check_courses_known, check_coverage, check_double_counting, check_freshness, check_known_gaps,
        check_mandatory_offered, check_plannable, check_rules_enforced, check_totals,
    )

    started = datetime.now(timezone.utc)
    spec = load_spec(spec_path(entry))
    facts = load_program_facts(entry.source_year, entry.source_ids["tcid"])
    board = json.loads(board_paths(entry)["board"].read_text(encoding="utf-8"))
    items = collect(entry, live=live, offline=offline)

    results = [check_coverage(items, spec)]
    if not offline:
        results.append(check_freshness(items, started))
    results += [
        check_courses_known(spec, facts),
        check_double_counting(spec),
        check_mandatory_offered(spec, facts),
        check_totals(spec, facts),
        check_plannable(board),
        check_rules_enforced(spec),
        check_known_gaps(spec),
    ]
    lines = [f"# Degree check — {entry.id}", "",
             f"Mode: {'offline (cached sources)' if offline else 'live'}; evidence items: {len(items)}", ""]
    for r in results:
        lines.append(f"## {r.name}: {'PASS' if r.passed else 'FAIL'}")
        lines += [f"- {p}" for p in r.problems[:200]]
        if len(r.problems) > 200:
            lines.append(f"- … {len(r.problems) - 200} more")
        lines.append("")
    if offline:
        lines += ["## freshness: SKIPPED", "- offline run: evidence is cached, so freshness is not verified", ""]
    passed = all(r.passed for r in results) and not offline
    lines.append(f"Result: {'PASS' if passed else 'FAIL'}")
    report = "\n".join(lines) + "\n"
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"degree_check_{entry.id}.md").write_text(report, encoding="utf-8")
    return passed, report


# ---------------------------------------------------------------- cli


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["evidence", "build", "check", "refresh"])
    ap.add_argument("--program", required=True, help="registry program id, e.g. mechanical_engineering_2027")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--live", action="store_true",
                      help="re-fetch every official source (build: also rewrites the facts snapshot first)")
    mode.add_argument("--offline", action="store_true", help="cached sources only; never touch the network")
    ap.add_argument("--out-dir", type=Path, default=DATA, help="build: data directory to write boards into")
    ap.add_argument("--apply", action="store_true",
                    help="refresh: then rebuild the committed boards with `build` into data/")
    ap.add_argument("--syllabi", action="store_true",
                    help="accepted for compatibility: build always rebuilds stale syllabus summaries")
    args = ap.parse_args(argv)
    args.out_dir = args.out_dir.resolve()
    os.chdir(ROOT)  # the legacy builders resolve data/... relative to the repo root
    entry = get_program(args.program)

    if args.command == "evidence":
        items = collect(entry, live=args.live, offline=args.offline)
        path = write_evidence(entry, items)
        for kind, n in sorted(Counter(i.kind for i in items).items()):
            print(f"  {kind:15s} {n}")
        print(f"[evidence] {len(items)} items -> {path.relative_to(ROOT)}")
        return 0
    if args.command == "build":
        out = build(entry, args.out_dir, offline=args.offline, live=args.live)
        for key, path in out.items():
            print(f"  {key:16s} {path}")
        return 0
    if args.command == "check":
        if not (args.live or args.offline):
            print("check needs --live (verifies freshness) or --offline (freshness skipped, never passes)",
                  file=sys.stderr)
            return 2
        passed, report = run_check(entry, live=args.live, offline=args.offline)
        print(report)
        return 0 if passed else 1
    if args.command == "refresh":
        summary = _refresh_module().refresh(entry, None, args.offline, args.live, update_catalog=args.apply)
        print(json.dumps(summary, ensure_ascii=False))
        if args.apply:  # the boards are written by build only (curation overlay + byte-stable writer)
            out = build(entry, DATA, offline=args.offline, live=args.live, refresh=False)
            for key, path in out.items():
                print(f"  {key:16s} {path}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
