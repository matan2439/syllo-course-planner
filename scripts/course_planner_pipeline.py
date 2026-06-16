"""
Single entry point for the board build/audit/sync/verify workflow.

Usage:
    python3 scripts/course_planner_pipeline.py --program mechanical_engineering --year 2027 --audit
    python3 scripts/course_planner_pipeline.py --program mechanical_engineering --year 2027 --sync
    python3 scripts/course_planner_pipeline.py --program mechanical_engineering --year 2027 --verify-live

Flags can be combined, e.g. `--audit --sync --verify-live` runs the full
pipeline in order: audit (must pass) -> sync to Supabase -> verify live API.

--sync requires DATABASE_URL (or ENV_FILE pointing at a file containing it)
and is the ONLY step that writes to Supabase. Nothing here ever prints the
connection string or any other secret.

See docs/board-pipeline.md for the full workflow description.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(REPO_ROOT))
from app.analysis.board_audit import audit_board, compute_board_hash, format_report  # noqa: E402

DEFAULT_BOARD_DIR = REPO_ROOT / "data" / "parsed_json"
DEFAULT_LIVE_BASE = "https://tau-course-planner.vercel.app"


def board_path_for(program: str, year: int) -> Path:
    base = program.replace("engineering", "").strip("_") or program
    # data/parsed_json/{base}_semester_board_{year}.json, e.g. mechanical_semester_board_2027.json
    name = f"{base}_semester_board_{year}.json"
    candidate = DEFAULT_BOARD_DIR / name
    if candidate.exists():
        return candidate
    # Fallback: scan for any file matching *_semester_board_{year}.json
    matches = sorted(DEFAULT_BOARD_DIR.glob(f"*_semester_board_{year}.json"))
    if matches:
        return matches[0]
    return candidate


def run_audit(board_path: Path) -> bool:
    print(f"[audit] {board_path}")
    if not board_path.exists():
        print(f"[audit] FAIL — board JSON not found: {board_path}")
        return False
    board = json.loads(board_path.read_text(encoding="utf-8"))
    issues = audit_board(board)
    print(format_report(board, issues))
    return not any(i.level == "error" for i in issues)


def refresh_board_hash(board_path: Path) -> str:
    """Recompute and write metadata.board_data_version. Returns the new hash."""
    board = json.loads(board_path.read_text(encoding="utf-8"))
    new_hash = compute_board_hash(board)
    if board.get("metadata", {}).get("board_data_version") != new_hash:
        board.setdefault("metadata", {})["board_data_version"] = new_hash
        board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[build] updated metadata.board_data_version -> {new_hash}")
    else:
        print(f"[build] board_data_version already up to date ({new_hash})")
    return new_hash


def run_sync(program: str, year: int, board_path: Path) -> bool:
    print(f"[sync] program_versions.board_json <- {board_path} "
          f"(program_id={program!r}, academic_year={year})")
    result = subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "update-board-json.mjs"), program, str(year), str(board_path)],
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        print("[sync] FAIL — update-board-json.mjs exited non-zero")
        return False
    print("[sync] done")
    return True


def run_verify_live(program: str, year: int, board_path: Path,
                     live_base: str = DEFAULT_LIVE_BASE) -> bool:
    url = f"{live_base}/api/board/{program}_{year}"
    print(f"[verify-live] GET {url}")
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            status = resp.status
            live = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[verify-live] FAIL — request error: {exc}")
        return False

    if status != 200:
        print(f"[verify-live] FAIL — HTTP {status}")
        return False

    local = json.loads(board_path.read_text(encoding="utf-8"))
    local_hash = local.get("metadata", {}).get("board_data_version")
    live_hash  = live.get("metadata", {}).get("board_data_version")

    ok = True
    if local_hash and live_hash and local_hash != live_hash:
        print(f"[verify-live] FAIL — board_data_version mismatch: "
              f"local={local_hash} live={live_hash} (Supabase not synced or still stale)")
        ok = False
    else:
        print(f"[verify-live] board_data_version OK ({live_hash})")

    # Spot-check placements (annual/multi-placement aware).
    placements_ok, messages = verify_board_placements(local, live)
    for msg in messages:
        print(f"[verify-live] {msg}")
    ok = ok and placements_ok

    print("[verify-live] " + ("PASS" if ok else "FAIL"))
    return ok


def verify_board_placements(local: dict, live: dict) -> tuple[bool, list[str]]:
    """Compare local vs live course placements, annual/multi-placement aware.

    Returns (ok, messages). A course may legitimately be placed in more than one
    semester when it is annual (is_annual=true, spanning spans_semesters). Normal
    courses must match their single local placement and must not appear in any
    unexpected extra live semester. Every live placement must also lie within the
    course's effective_allowed_semesters when that field is present.
    """
    def by_id(board: dict) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for sem in board.get("semesters", []):
            for c in sem.get("courses", []):
                out.setdefault(c["course_id"], []).append({**c, "_semester_id": sem["semester_id"]})
        return out

    live_by_id = by_id(live)
    local_by_id = by_id(local)
    ok = True
    messages: list[str] = []

    for cid, loc_recs in local_by_id.items():
        live_recs = live_by_id.get(cid)
        if not live_recs:
            messages.append(f"FAIL — {cid} missing from live board")
            ok = False
            continue
        live_sems = {r["_semester_id"] for r in live_recs}
        loc0 = loc_recs[0]

        if loc0.get("is_annual"):
            spans = loc0.get("spans_semesters") or sorted({r["_semester_id"] for r in loc_recs})
            missing = [s for s in spans if s not in live_sems]
            if missing:
                messages.append(f"FAIL — annual {cid} missing live placement(s) {missing} (spans={spans})")
                ok = False
            if loc0.get("count_hours_once") is True and not any(r.get("count_hours_once") is True for r in live_recs):
                messages.append(f"FAIL — annual {cid} missing count_hours_once on live record")
                ok = False
        else:
            local_sems = {r["_semester_id"] for r in loc_recs}
            for s in local_sems:
                if s not in live_sems:
                    messages.append(f"FAIL — {cid} placed in {s} locally but not live (live={sorted(live_sems)})")
                    ok = False
            extra = [s for s in sorted(live_sems) if s not in local_sems]
            if extra:
                messages.append(f"FAIL — {cid} appears in unexpected live semester(s) {extra} (local={sorted(local_sems)})")
                ok = False

        for r in live_recs:
            effective = r.get("effective_allowed_semesters")
            if effective and r["_semester_id"] not in effective:
                messages.append(f"FAIL — {cid} placed in {r['_semester_id']} outside effective_allowed_semesters={effective}")
                ok = False

    return ok, messages


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--program", required=True, help="e.g. mechanical_engineering")
    p.add_argument("--year", required=True, type=int, help="e.g. 2027")
    p.add_argument("--board-json", default=None, metavar="PATH",
                   help="Override board JSON path (default: auto-detect under data/parsed_json/)")
    p.add_argument("--build", action="store_true", help="Refresh metadata.board_data_version")
    p.add_argument("--audit", action="store_true", help="Run consistency checks (read-only)")
    p.add_argument("--sync", action="store_true",
                   help="Push board_json to Supabase program_versions (requires DATABASE_URL)")
    p.add_argument("--verify-live", action="store_true", help="Compare live API against local board JSON")
    p.add_argument("--live-base", default=DEFAULT_LIVE_BASE, help="Base URL of deployed app")
    args = p.parse_args()

    if not (args.build or args.audit or args.sync or args.verify_live):
        p.error("specify at least one of --build / --audit / --sync / --verify-live")

    board_path = Path(args.board_json) if args.board_json else board_path_for(args.program, args.year)

    if args.build:
        refresh_board_hash(board_path)

    if args.audit:
        if not run_audit(board_path):
            print("\n[pipeline] audit FAILED — stopping (no sync).")
            return 1

    if args.sync:
        if not run_sync(args.program, args.year, board_path):
            return 1

    if args.verify_live:
        if not run_verify_live(args.program, args.year, board_path, args.live_base):
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
