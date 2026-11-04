#!/usr/bin/env python3
"""
One CLI for every registered degree (data/config/programs.json):

    python scripts/degree.py init     --institution tau --title-he "<official title>" --level <toar>
                                      --school <betsefer> --shana <year> --name-en <text>
                                      [--base <slug>] [--track-he <text>]
    python scripts/degree.py evidence --program <id> [--live|--offline]
    python scripts/degree.py build    --program <id> [--live|--offline] [--out-dir DIR]
    python scripts/degree.py check    --program <id>  --live|--offline
    python scripts/degree.py refresh  --program <id> [--live|--offline] [--apply [--syllabi]]
    python scripts/degree.py todo     --program <id> [--apply-suggestions]
    python scripts/degree.py publish  --program <id> [--update]

init      resolves the program in TAU's official program index (fails listing the candidates on
          zero or several matches), appends a status "draft" registry entry <base>_<shana+1>,
          writes an empty spec.json skeleton, then runs `evidence --live`.
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
          A degree with no curation.json and no legacy spec keys builds from spec + facts alone
          (elective pool from the spec categories, Years 1-2 mandatory courses from the spec;
          a spec with legacy keys reads those from the official program page, falling back to
          the spec when the page has no single-year sections or offline was never cached).
check     coverage + freshness + consistency + plannability + course-rule enforcement + known gaps; report in
          data/import_reports/degree_check_<id>.md; exit 0 only if every check passes.
          Requires --live (freshness needs a live fetch) or --offline (freshness SKIPPED, exit 1).
refresh   official facts for every course the spec or boards reference + a mismatch report
          (data/official/tau_course_facts_<year>.json); --apply then runs `build` into data/
          (the only board write path: curation overlay, byte-stable writer, board_data_version)
          after keeping the general-requirement catalog in step.
publish   the gate a new degree passes before it goes live: refuses anything not "draft" (a live
          degree's --update is Plan 3's impact flow: not built yet, exit 1); `build --live` into
          data/; rebuilds every OTHER live degree `--offline` into a scratch dir — any byte change
          to its committed boards (the refreshed facts are course-wide): exit 1, listing degree,
          files and courses; `check --live` — any FAIL or SKIPPED check: exit 1, registry
          unchanged (the built files stay in the working tree); all PASS: RELEASE.md beside
          spec.json (date, evidence counts by kind, check summary, sources with fetch times), then
          registry status "live" and the early-year index rewritten, and prints — never runs —
          the owner's DB board sync command and "commit, open a PR, deploy".

Degree length is data: spec `degree_years` (N, 3..6) sets the boards — the early window board
is Years 1-2, the program board Years 3..N. build/check refuse a mandatory course outside years
1..N (or a study_duration rule that disagrees with N) — build exits 2, check fails
`degree_length`. A draft's boards (window board included) are never served and never enter the
early-year index.
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
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

# The program board covers Years 3..N (N = spec.degree_years; build_semester_board's default
# start_year); the Years 1-2 window board is built next to it by build_early_years_board.
MAIN_BOARD_START_YEAR = 3
EARLY_START_YEAR = 1


def main_board_years(spec: DegreeSpec) -> int:
    """How many degree years the program board covers: Years 3..N (N=3 -> 1, N=4 -> 2, N=5 -> 3)."""
    return spec.degree_years - MAIN_BOARD_START_YEAR + 1


class DegreeCliError(Exception):
    """A refusal main() reports as a clear message with exit code 2 (no traceback)."""


class DegreeLengthError(DegreeCliError):
    """The spec has mandatory courses outside its degree years 1..degree_years."""


def degree_length_guard(entry: ProgramEntry, spec: DegreeSpec) -> None:
    """Refuse (DegreeLengthError) a spec the board windows would silently truncate."""
    from app.degrees.checks import check_degree_length

    result = check_degree_length(spec)
    if not result.passed:
        raise DegreeLengthError(
            f"{entry.id}: refusing to build — " + "; ".join(result.problems)
            + f". Boards cover years 1-2 and 3-{spec.degree_years} (spec degree_years); fix the course's year "
              "or degree_years from the official program page.")
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


def mandatory_courses_file(spec: DegreeSpec, start_year: int, facts: dict, years: int = 2) -> dict:
    """The board builder's mandatory-courses input, generated from the spec (the authority).

    Placement comes from the spec; the display name and weekly hours come from the official
    facts (the builder falls back to them when the local course DB lacks a course). Every
    mandatory course is locked by default, as in the legacy hand-maintained file. ``years``: the
    board's degree years from ``start_year`` (``main_board_years(spec)``).
    """
    window = set(range(start_year, start_year + years))
    rows = []
    for m in spec.mandatory_courses:
        if m.year not in window:
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


def _offered_in_year(fact: dict):
    status = (fact.get("offering") or {}).get("status")
    return True if status == "offered" else False if status == "not_offered" else None


def elective_courses_from_spec(spec: DegreeSpec, facts: dict) -> list[dict]:
    """The builder's ``elective_courses`` pool for a degree whose spec has no legacy copy of it:
    every category course (spec order) that is not mandatory, described by the official facts."""
    mandatory = {m.course_id for m in spec.mandatory_courses}
    rows, seen = [], set()
    for cat in spec.categories:
        for cid in cat.course_ids:
            if cid in mandatory or cid in seen:
                continue
            seen.add(cid)
            fact = facts.get(cid) or {}
            offering = fact.get("offering") or {}
            rows.append({
                "course_id": cid,
                "name_he": (fact.get("ims") or {}).get("name_he"),
                "hours": (fact.get("program") or {}).get("weekly_hours"),
                "offered_semesters": list(offering.get("offered_semesters")
                                          or (fact.get("ims") or {}).get("offered_semesters") or []),
                "category_id": cat.category_id,
                "offered_in_year": _offered_in_year(fact),
            })
    return rows


def early_mandatory_from_spec(spec: DegreeSpec, start_year: int, facts: dict, shana: int) -> list[dict]:
    """The early (Years ``start_year``..+1) board's mandatory rows from the spec + official facts,
    in the shape ``build_early_years_board.mandatory_specs`` produces from the program page."""
    rows = []
    for m in spec.mandatory_courses:
        if m.year not in (start_year, start_year + 1):
            continue
        fact = facts.get(m.course_id) or {}
        program = fact.get("program") or {}
        allowed = _semester_ids(m.year, m.semester)
        rows.append({
            "course_id": m.course_id,
            "name_he": (fact.get("ims") or {}).get("name_he"),
            "weekly_hours": program.get("weekly_hours"),
            "credits": program.get("credits"),
            "allowed_semesters": allowed,
            "source_note": f"spec.json mandatory_courses + tau_course_facts_{shana}",
            "recommended_semester": allowed[0],
        })
    return rows


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
    spec_file = spec_path(entry)
    spec = load_spec(spec_file)
    degree_length_guard(entry, spec)  # never drop mandatory courses outside the board windows
    facts_file = build_facts_path(entry, out_dir)
    if live and refresh:  # build from freshly fetched official facts (writes the facts snapshot, not the boards)
        rcd.refresh(entry, None, offline=False, live=True, facts_file=facts_file)
    if not facts_file.exists():
        facts_file = rcd.facts_path(entry.source_year)
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
    # A degree without the migrated ME's legacy program copy: its display name comes from the
    # registry and its elective pool from the spec categories + official facts.
    program.setdefault("program_name_he", entry.name_he)
    if "elective_courses" not in program:
        program["elective_courses"] = elective_courses_from_spec(spec, facts)
    with tempfile.TemporaryDirectory(prefix=f"degree_build_{entry.id}_") as tmp:
        mandatory_file = Path(tmp) / "mandatory_courses.json"
        mandatory_file.write_text(json.dumps(mandatory_courses_file(spec, MAIN_BOARD_START_YEAR, facts,
                                                                    main_board_years(spec)),
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
                     offline=offline, offerings=offerings, years=main_board_years(spec))
            board = json.loads(path.read_text(encoding="utf-8"))
            changed = rcd.apply(board, facts, shana)
            summaries = rcd.refresh_syllabi(board, offline)
            bidit = copy_bidit_schedule(board, shana) if "general_requirements" in variant["requirements"] else 0
            n = apply_curation(board, curation, key)
            write_board(path, board, previous[key], keep_timestamps=not live)
            print(f"[build] {key}: facts patched {changed} records, {summaries} summaries, "
                  f"{bidit} BIDIT records, {n} curation entries")

    # The early window's mandatory courses: a spec-native degree (no legacy keys) takes them
    # from its spec. The migrated ME keeps reading the official program page, falling back to
    # the spec when the page has no single-year sections or (offline) was never cached.
    spec_rows = early_mandatory_from_spec(spec, EARLY_START_YEAR, facts, shana)
    native = not spec.legacy
    if native:
        print(f"[build] early_years: {len(spec_rows)} mandatory courses from the spec")
    early_out = early.build(entry.id, EARLY_START_YEAR, tcid, shana,
                            boards_dir=paths["board"].parent, out_dir=paths["early_years"].parent,
                            offline=offline, offerings=offerings,
                            mandatory=spec_rows if native else None,
                            fallback_mandatory=None if native else spec_rows)
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


@dataclasses.dataclass
class CheckRun:
    """One check run: each check's result, the checks that were SKIPPED (not run), the evidence
    the run collected, the rendered report, and whether it passed (no FAIL and no SKIPPED)."""
    results: list
    skipped: list[str]
    items: list
    report: str
    passed: bool


def run_check(entry: ProgramEntry, live: bool, offline: bool) -> tuple[bool, str]:
    """All Task 5/6 checks. Offline: freshness is SKIPPED and the run never passes."""
    run = run_checks(entry, live=live, offline=offline)
    return run.passed, run.report


def run_checks(entry: ProgramEntry, live: bool, offline: bool) -> CheckRun:
    """run_check with the per-check results exposed (publish refuses on any FAIL or SKIPPED)."""
    from app.degrees.checks import (
        check_board_carries_requirements, check_courses_known, check_coverage, check_degree_length,
        check_double_counting, check_freshness, check_known_gaps, check_mandatory_offered, check_plannable,
        check_rules_enforced, check_totals,
    )

    started = datetime.now(timezone.utc)
    spec = load_spec(spec_path(entry))
    facts = load_program_facts(entry.source_year, entry.source_ids["tcid"])
    board_file = board_paths(entry)["board"]
    if not board_file.exists():
        raise DegreeCliError(f"{entry.id}: no built board at {_show(board_file)} — build first: "
                             f"python scripts/degree.py build --program {entry.id} --offline")
    board = json.loads(board_file.read_text(encoding="utf-8"))
    items = collect(entry, live=live, offline=offline)

    results = [check_coverage(items, spec)]
    if not offline:
        results.append(check_freshness(items, started))
    results += [
        check_courses_known(spec, facts),
        check_double_counting(spec),
        check_mandatory_offered(spec, facts),
        check_degree_length(spec),
        check_totals(spec, facts),
        check_board_carries_requirements(spec),
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
    skipped = ["freshness"] if offline else []
    if offline:
        lines += ["## freshness: SKIPPED", "- offline run: evidence is cached, so freshness is not verified", ""]
    passed = all(r.passed for r in results) and not skipped
    lines.append(f"Result: {'PASS' if passed else 'FAIL'}")
    report = "\n".join(lines) + "\n"
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"degree_check_{entry.id}.md").write_text(report, encoding="utf-8")
    return CheckRun(results=results, skipped=skipped, items=list(items), report=report, passed=passed)


# ---------------------------------------------------------------- publish

RELEASE_NAME = "RELEASE.md"


def release_note(entry: ProgramEntry, run: CheckRun, today: str) -> str:
    """RELEASE.md: date, evidence item counts by kind, check summary, sources with fetch times."""
    lines = [f"# Release — {entry.id}", "", f"Date: {today}", f"Program: {entry.name_he} ({entry.name_en})",
             "Status: live", "", f"## Evidence ({len(run.items)} items)"]
    lines += [f"- {kind}: {n}" for kind, n in sorted(Counter(i.kind for i in run.items).items())]
    lines += ["", "## Checks (live)"]
    lines += [f"- {r.name}: {'PASS' if r.passed else 'FAIL'}" for r in run.results]
    lines += ["", "## Sources"]
    latest: dict[str, datetime] = {}
    for i in run.items:
        if i.source_url not in latest or i.fetched_at > latest[i.source_url]:
            latest[i.source_url] = i.fetched_at
    lines += [f"- {url} (fetched_at {t.isoformat()})" for url, t in sorted(latest.items())]
    return "\n".join(lines) + "\n"


def _board_courses(board) -> dict[str, str]:
    """course_id -> its records (semesters + repository), serialized, for a cheap per-course diff."""
    out: dict[str, list] = {}
    if not isinstance(board, dict):
        return {}
    for sem in board.get("semesters") or []:
        for c in sem.get("courses") or []:
            if isinstance(c, dict) and "course_id" in c:
                out.setdefault(c["course_id"], []).append(c)
    for c in (board.get("metadata") or {}).get("program_repository_courses") or []:
        if isinstance(c, dict) and "course_id" in c:
            out.setdefault(c["course_id"], []).append(c)
    return {cid: json.dumps(v, sort_keys=True, ensure_ascii=False) for cid, v in out.items()}


def other_degree_drift(entry: ProgramEntry) -> dict[str, list[str]]:
    """Rebuild every OTHER live registry degree offline into a scratch dir and compare it
    byte-for-byte with its committed boards. Publishing degree #2 refreshes course-wide official
    facts (IMS offerings, names, hours) that other degrees' boards are built from too: any change
    to another degree's committed boards must go through its own update, never ride along.

    The scratch dir is seeded with the committed boards, so the byte-stable writer applies exactly
    as it does in data/ (an unchanged board rebuilds byte-identical). Returns
    {other_id: ["<file>: changed (courses: …)", …]} for every degree that drifted."""
    from app.degrees.registry import load_registry

    drift: dict[str, list[str]] = {}
    for other in load_registry():
        if other.id == entry.id or other.status != "live":
            continue
        if not spec_path(other).exists():  # a legacy registry entry degree.py does not build (no spec.json)
            print(f"[publish] {entry.id}: {other.id} has no spec.json (not built by degree.py) — not rebuilt")
            continue
        committed = board_paths(other)
        with tempfile.TemporaryDirectory(prefix=f"degree_drift_{other.id}_") as tmp:
            scratch = board_paths(other, Path(tmp))
            for key, src in committed.items():
                if src.exists():
                    scratch[key].parent.mkdir(parents=True, exist_ok=True)
                    scratch[key].write_bytes(src.read_bytes())
            print(f"[publish] {entry.id}: rebuilding live {other.id} offline to verify it is unchanged")
            build(other, Path(tmp), offline=True)
            changed = []
            for key, src in committed.items():
                new = scratch[key].read_bytes() if scratch[key].exists() else None
                old = src.read_bytes() if src.exists() else None
                if new == old:
                    continue
                try:
                    a = _board_courses(json.loads(old)) if old else {}
                    b = _board_courses(json.loads(new)) if new else {}
                    ids = sorted(c for c in a.keys() | b.keys() if a.get(c) != b.get(c))
                except ValueError:
                    ids = []
                shown = ", ".join(ids[:20]) + (f", … {len(ids) - 20} more" if len(ids) > 20 else "")
                changed.append(f"{src.relative_to(ROOT).as_posix() if src.is_relative_to(ROOT) else src}: changed"
                               + (f" (courses: {shown})" if ids else ""))
            if changed:
                drift[other.id] = changed
    return drift


def refresh_early_index() -> Path:
    """Rewrite data/config/early_year_courses.json from data/boards/ (drafts excluded)."""
    import build_early_years_board as early

    return early.write_early_year_index(boards_dir=DATA / "boards", path=early_index_path())


def run_publish(entry: ProgramEntry, update: bool) -> int:
    """build --live into data/ -> a full live check -> (all PASS, none SKIPPED) status "live" +
    RELEASE.md + the owner's commands, printed, never run."""
    from app.degrees import registry

    if entry.status == "live":
        if update:
            print(f"[publish] {entry.id}: impact analysis not built yet (Plan 3) — an update to a live degree "
                  f"is not supported", file=sys.stderr)
        else:
            print(f"[publish] {entry.id} is already live — refusing; republishing a live degree needs --update",
                  file=sys.stderr)
        return 1
    if entry.status != "draft":
        print(f"[publish] {entry.id} is {entry.status} — refusing; only a draft degree can be published",
              file=sys.stderr)
        return 1
    print(f"[publish] {entry.id}: build --live into data/")
    build(entry, DATA, offline=False, live=True)
    drift = other_degree_drift(entry)
    if drift:
        print(f"[publish] {entry.id}: refused — the refreshed official facts change other live degrees' "
              f"committed boards (each needs its own update first):", file=sys.stderr)
        for other_id, files in sorted(drift.items()):
            print(f"  {other_id}:", file=sys.stderr)
            for line in files:
                print(f"    - {line}", file=sys.stderr)
        print(f"[publish] registry unchanged ({entry.id} stays {entry.status}); the built files remain in the "
              f"working tree (data/) — review or discard them.", file=sys.stderr)
        return 1
    # The build's live run refreshes the official facts, not the evidence: the check fetches evidence itself.
    print(f"[publish] {entry.id}: check --live")
    run = run_checks(entry, live=True, offline=False)
    failing = [r for r in run.results if not r.passed]
    if failing or run.skipped or not run.passed:
        print(f"[publish] {entry.id}: refused — every check must PASS live:", file=sys.stderr)
        for r in failing:
            print(f"  {r.name}: FAIL ({len(r.problems)} problems)", file=sys.stderr)
            for p in r.problems[:5]:
                print(f"    - {p}", file=sys.stderr)
        for name in run.skipped:
            print(f"  {name}: SKIPPED", file=sys.stderr)
        print(f"[publish] registry unchanged ({entry.id} stays {entry.status}); the built files remain in the "
              f"working tree (data/) — review or discard them. Full report: "
              f"{_show(REPORT_DIR / f'degree_check_{entry.id}.md')}", file=sys.stderr)
        return 1
    release = spec_path(entry).with_name(RELEASE_NAME)
    release.parent.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).date().isoformat()
    release.write_bytes(release_note(entry, run, today).encode("utf-8"))  # before the status flip
    registry.set_status(entry.id, "live")
    index = refresh_early_index()  # a draft's window board was kept out of the index; now it is live
    board = board_paths(entry)["board"].relative_to(ROOT).as_posix()
    print(f"[publish] {entry.id}: every check passed; release note -> {_show(release)}; registry status -> live; "
          f"early-year index -> {_show(index)}")
    print("[publish] owner steps (not run):")
    print(f"  1. ENV_FILE=.env.local node scripts/update-board-json.mjs {entry.base} {entry.year} {board}")
    print("     (the sync reporting 0 rows = not seeded yet; the board is served from the committed file after deploy)")
    print("  2. commit, open a PR, deploy")
    return 0


# ---------------------------------------------------------------- todo

TODO_NAME = "todo.md"


def run_todo(entry: ProgramEntry, apply_suggestions: bool) -> int:
    """Print (and write to todo.md beside evidence.json) the coverage worklist; 0 iff nothing is left."""
    from app.degrees.checks.coverage import coverage_gaps, unresolved_targets
    from app.degrees.coverage_suggest import suggest_coverage
    from app.degrees.spec import MappedTo
    from app.degrees.evidence import EvidenceItem, strip_html
    from app.degrees.spec import write_spec

    ev_path = evidence_path(entry)
    if not ev_path.exists():
        print(f"{_show(ev_path)} not found — run `degree.py evidence --program {entry.id}` first", file=sys.stderr)
        return 2
    items = [EvidenceItem.model_validate(r) for r in json.loads(ev_path.read_text(encoding="utf-8"))]
    spec_file = spec_path(entry)
    spec = load_spec(spec_file)
    lines: list[str] = []
    if apply_suggestions:
        fresh = {k: v for k, v in suggest_coverage(items, spec).items() if k not in spec.coverage}
        if fresh:
            spec = spec.model_copy(update={"coverage": {**spec.coverage, **fresh}})
            write_spec(spec, spec_file)
        lines.append(f"applied {len(fresh)} suggested coverage entries to {_show(spec_file)}")
    gaps, stale = coverage_gaps(items, spec)
    open_items = [i for i, _ in gaps]
    reasons = {i.id: r for i, r in gaps}
    lines.append(f"# Coverage worklist — {entry.id}: {len(open_items)} unaccounted of {len(items)} evidence items, "
                 f"{len(stale)} stale keys")
    if not items:
        lines.append("no evidence collected")
    groups: dict[tuple[str, str], list] = {}
    for item in open_items:
        groups.setdefault((item.kind, " > ".join(item.path)), []).append(item)
    last_kind = None
    for (kind, path), group in sorted(groups.items()):
        if kind != last_kind:
            lines += ["", f"## {kind}"]
            last_kind = kind
        lines += ["", f"### {path or '(no path)'}"]
        for item in group:
            mapped = spec.coverage.get(item.id)
            where = ""
            if isinstance(mapped, MappedTo):
                where = " -> " + (", ".join(mapped.targets) or "(no targets)")
                bad = unresolved_targets(mapped, spec)
                if bad and len(mapped.targets) > 1:
                    where += f" [unresolved: {', '.join(bad)}]"
            lines += [f"- id: {item.id}" + ("" if reasons[item.id] == "unaccounted" else f" ({reasons[item.id]})") + where,
                      f"  source_url: {item.source_url}", f"  text: {strip_html(item.raw_text)}"]
    if stale:
        lines += ["", "## stale coverage keys (not in evidence; remove from the spec)"]
        lines += [f"- {k}" for k in stale]
    text = "\n".join(lines) + "\n"
    ev_path.with_name(TODO_NAME).write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("utf-8"))
    sys.stdout.flush()
    return 0 if items and not open_items and not stale else 1


# ---------------------------------------------------------------- init

# Institutions ``init`` can resolve and fetch evidence for (a program index + evidence adapters).
INIT_INSTITUTIONS = ("tau",)


def _show(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _print_evidence_counts(items, path: Path) -> None:
    for kind, n in sorted(Counter(i.kind for i in items).items()):
        print(f"  {kind:15s} {n}")
    print(f"[evidence] {len(items)} items -> {_show(path)}")


# The index's ``toar`` is a Hebrew degree label; --level also takes these shorthands.
LEVEL_ALIASES = {"1": "ראשון", "2": "שני"}
INDEX_PAGE_SIZE = 100


def _index_candidates(results):
    """The index rows ``init`` chooses from: one per tcid. A program whose ``betsefer`` is empty
    (e.g. materials science, 7843) is matched on its ``chug`` instead."""
    by_tcid = {}
    for r in results:
        if not r.school_code and r.chug_code:
            r = dataclasses.replace(r, school_code=r.chug_code)
        by_tcid.setdefault(r.tcid, r)
    return list(by_tcid.values())


def run_init(args) -> int:
    from app.degrees import registry, scaffold
    from app.degrees.spec import write_spec
    from app.scraping.tau_program_scraper import ProgramSelectionError, find_unique_program, search_program_index

    if args.institution not in INIT_INSTITUTIONS:
        print(f"{args.institution}: init supports {', '.join(INIT_INSTITUTIONS)} only — a new university "
              f"needs adapters (a program index, evidence adapters and an institutions.json entry)",
              file=sys.stderr)
        return 2
    missing = [f"--{k.replace('_', '-')}" for k in ("title_he", "level", "school", "shana", "name_en")
               if getattr(args, k) is None]
    if missing:
        print(f"init needs {' '.join(missing)}", file=sys.stderr)
        return 2
    level = LEVEL_ALIASES.get(args.level, args.level)
    title = " ".join(args.title_he.split())

    # The public site's search (verified live): free text, relevance-ranked, current year only.
    results = search_program_index({"safa": "1", "freeSearch": title}, size=INDEX_PAGE_SIZE)
    candidates = _index_candidates(results)
    try:
        found = find_unique_program(candidates, title_he=title, degree_level=level, school_code=args.school)
    except ProgramSelectionError as exc:
        exact = [c for c in candidates if " ".join(c.title_he.split()) == title]
        shown = exact or candidates
        print(f"[init] {exc}", file=sys.stderr)
        print(f"[init] {'title-matching' if exact else 'all'} candidates from the official index "
              f"(wanted school {args.school}, level {level}):", file=sys.stderr)
        for c in shown:
            print(f"  tcid={c.tcid}  title={c.title_he}  level={c.degree_level}  school={c.school_code}  "
                  f"year={c.academic_year}", file=sys.stderr)
        if not shown:
            print("  (the index returned nothing: check the title, or the network)", file=sys.stderr)
        return 2
    if found.academic_year != str(args.shana):
        print(f"[init] the official index lists tcid {found.tcid} for shana {found.academic_year or '?'}, "
              f"not {args.shana} (it serves the current catalog year only) — refusing", file=sys.stderr)
        return 2

    base = args.base or f"tau_program_{found.tcid}"
    try:
        entry = scaffold.registry_entry(found, args.shana, base, args.track_he, name_en=args.name_en)
    except ValueError as exc:
        print(f"[init] invalid entry: {exc}", file=sys.stderr)
        return 2
    current = registry.load_registry()
    if entry.id in {e.id for e in current}:
        print(f"[init] {entry.id} is already registered — pick another --base or edit the existing degree",
              file=sys.stderr)
        return 2
    try:
        registry.validate_registry([*current, entry])
    except ValueError as exc:
        print(f"[init] the registry would be invalid: {exc}", file=sys.stderr)
        return 2
    spec_file = spec_path(entry)
    if spec_file.exists():
        print(f"[init] {_show(spec_file)} already exists — refusing to overwrite it", file=sys.stderr)
        return 2
    # Spec first: a registry entry is never left pointing at a degree with no spec.
    write_spec(scaffold.new_spec(entry), spec_file)
    print(f"[init] spec skeleton -> {_show(spec_file)}")
    try:
        registry.add_program(entry)
    except Exception:
        spec_file.unlink(missing_ok=True)
        raise
    print(f"[init] registered {entry.id} (draft, tcid {found.tcid}: {found.title_he})")

    from app.degrees.evidence import EvidenceFetchError

    try:
        items = collect(entry, live=True, offline=False)
    except EvidenceFetchError as exc:
        print(f"[init] evidence fetch failed: {exc}; rerun `degree.py evidence --program {entry.id} --live`",
              file=sys.stderr)
        return 1
    _print_evidence_counts(items, write_evidence(entry, items))
    return 0


# ---------------------------------------------------------------- cli


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["init", "evidence", "build", "check", "refresh", "todo", "publish"])
    ap.add_argument("--program", help="registry program id, e.g. mechanical_engineering_2027 (all but init)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--live", action="store_true",
                      help="re-fetch every official source (build: also rewrites the facts snapshot first)")
    mode.add_argument("--offline", action="store_true", help="cached sources only; never touch the network")
    ap.add_argument("--out-dir", type=Path, default=DATA, help="build: data directory to write boards into")
    ap.add_argument("--apply", action="store_true",
                    help="refresh: then rebuild the committed boards with `build` into data/")
    ap.add_argument("--syllabi", action="store_true",
                    help="accepted for compatibility: build always rebuilds stale syllabus summaries")
    ap.add_argument("--apply-suggestions", action="store_true",
                    help="todo: first write the unambiguous suggested coverage entries (never overwriting) to the spec")
    ap.add_argument("--update", action="store_true",
                    help="publish: republish an already-live degree (needs Plan 3's impact analysis; not built yet)")
    init = ap.add_argument_group("init (scaffold a draft degree from the official program index)")
    init.add_argument("--institution", default="tau")
    init.add_argument("--title-he", help="the program's official Hebrew title, exactly as the index lists it")
    init.add_argument("--level", help="the index's degree label (toar): ראשון (bachelor; alias 1) or שני (alias 2)")
    init.add_argument("--school", help="school code (betsefer; chug when the index has no betsefer), e.g. 0540")
    init.add_argument("--shana", type=int, help="TAU year code (catalog year - 1), e.g. 2026")
    init.add_argument("--base", help="the degree's slug, [a-z][a-z0-9_]* (default tau_program_<tcid>)")
    init.add_argument("--name-en", help="the program's English name (the index has none)")
    init.add_argument("--track-he", help="the track's Hebrew name, when the program is a track")
    args = ap.parse_args(argv)
    if args.command == "init":
        return run_init(args)
    if not args.program:
        ap.error(f"{args.command} needs --program")
    if ":" in args.program:  # board/spec/report paths are named after the id: no id->path mapping yet
        print(f"{args.program}: prefixed ids need a filesystem slug — not supported yet", file=sys.stderr)
        return 2
    args.out_dir = args.out_dir.resolve()
    os.chdir(ROOT)  # the legacy builders resolve data/... relative to the repo root
    entry = get_program(args.program)
    try:
        return _run_command(args, entry)
    except DegreeCliError as err:
        print(str(err), file=sys.stderr)
        return 2


def _run_command(args, entry: ProgramEntry) -> int:

    if args.command == "evidence":
        items = collect(entry, live=args.live, offline=args.offline)
        _print_evidence_counts(items, write_evidence(entry, items))
        return 0
    if args.command == "todo":
        return run_todo(entry, args.apply_suggestions)
    if args.command == "publish":
        if args.offline:
            print("publish always builds and checks live (freshness must be verified) — drop --offline",
                  file=sys.stderr)
            return 2
        return run_publish(entry, args.update)
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
