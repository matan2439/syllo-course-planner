"""
Validates data/prerequisites/discrepancy_register.json against the committed prerequisite data and
renders docs/data-audit/prerequisite-discrepancy-register.md. Offline and deterministic.

    python3 scripts/prerequisite_discrepancy_register.py          # render
    python3 scripts/prerequisite_discrepancy_register.py --check  # fail on stale output or a false claim

The computed section answers one question the curated entries rely on: for every prerequisite id the
catalog no longer lists, would a course be blocked ONLY because of it (it sits in an AND with no
alternative), or does an OR sibling keep the requirement satisfiable?
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / "data" / "prerequisites" / "discrepancy_register.json"
OUT = ROOT / "docs" / "data-audit" / "prerequisite-discrepancy-register.md"


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def satisfiable(expr, dead: set[str]) -> bool:
    """Could the expression hold if every id in `dead` can never be satisfied?"""
    if not expr:
        return True
    if "course" in expr:
        return expr["course"] not in dead
    if "all" in expr:
        return all(satisfiable(c, dead) for c in expr["all"])
    return any(satisfiable(c, dead) for c in expr["any"])


def leaves(expr) -> list[str]:
    if not expr:
        return []
    if "course" in expr:
        return [expr["course"]]
    return [x for c in expr.get("all", expr.get("any", [])) for x in leaves(c)]


def analyse(tau: dict, equiv: dict) -> dict:
    allc = {**tau["referenced_courses"], **tau["courses"]}
    gone = {cid for cid, r in allc.items() if r.get("status") == "not_in_catalog" and not r.get("boards")}
    mapped = {e["retired"] for e in equiv["equivalences"]}
    blocking: dict[str, list[str]] = {}
    harmless: dict[str, list[str]] = {}
    for cid, rec in tau["courses"].items():
        expr = rec.get("expression")
        for r in sorted(set(leaves(expr)) & gone):
            others = gone - {r}
            only_this = not satisfiable(expr, {r})
            (blocking if only_this else harmless).setdefault(r, []).append(cid)
    return {"gone": sorted(gone), "mapped": sorted(mapped), "blocking": blocking, "harmless": harmless,
            "blocking_unmapped": sorted(set(blocking) - mapped)}


def validate(reg: dict, tau: dict, computed: dict) -> list[str]:
    errors = []
    allc = {**tau["referenced_courses"], **tau["courses"]}
    for e in reg["entries"]:
        for c in e["courses"]:
            if c not in allc:
                errors.append(f"{e['id']}: course {c} has no record in tau.json")
        if not e.get("official_evidence"):
            errors.append(f"{e['id']}: no official evidence")
    d8 = next(e for e in reg["entries"] if e["id"] == "D8")
    for c in d8["courses"]:
        if c in computed["blocking"]:
            errors.append(f"D8 claims {c} only appears in OR groups, but it blocks {computed['blocking'][c]}")
    for needed in ("0542-1830", "0555-2250", "0512-4262"):
        if needed not in computed["blocking"]:
            errors.append(f"expected {needed} to be a blocking retired id")
    return errors


def render(reg: dict, computed: dict) -> str:
    L = ["# Prerequisite discrepancy register", "",
         f"Catalog year {reg['catalog_year']}; official sources probed {reg['retrieved_on']}. Source: `data/prerequisites/discrepancy_register.json` (curated) + computed checks. **Nothing here is applied**; entries with *approval required* wait for the project owner.", "",
         "| # | Courses | Issue | Status | Approval | Safe to enforce |", "|---|---|---|---|---|---|"]
    for e in reg["entries"]:
        L.append(f"| {e['id']} | {', '.join(e['courses'][:3])}{'…' if len(e['courses']) > 3 else ''} | {e['title']} | {e['confidence']} | {'**yes**' if e['approval_required'] else 'no'} | {'yes' if e['enforcement_safe'] else 'no'} |")
    for e in reg["entries"]:
        L += ["", f"## {e['id']} — {e['title']}", "", f"- **Courses:** {', '.join(e['courses'])}", "- **Official evidence:**"]
        for ev in e["official_evidence"]:
            where = ev.get("url") or ev.get("ref") or ev.get("path") or ""
            L.append(f"  - {ev['source_type']}{' · ' + where if where else ''}: {ev['statement']}")
        L += [f"- **Conflict / interpretation:** {e['conflict']}", f"- **Proposed resolution:** {e['proposed_resolution']}",
              f"- **Confidence:** {e['confidence']}", f"- **Planning impact:** {e['planning_impact']}",
              f"- **Human approval required:** {'yes' if e['approval_required'] else 'no'} · **Safe for blocking enforcement:** {'yes' if e['enforcement_safe'] else 'no'}"]
    L += ["", "## Computed: which retired prerequisite ids actually block a course", "",
          "A retired id *blocks* a course when the course's expression cannot hold without it (it is in an AND with no alternative). It is *harmless* when an OR sibling keeps the requirement satisfiable.", "",
          "| Retired / missing id | Blocks (only-way requirement) | Harmless (OR sibling exists) | Approved equivalence |", "|---|---|---|---|"]
    for r in computed["gone"]:
        L.append(f"| {r} | {', '.join(computed['blocking'].get(r, [])) or '—'} | {', '.join(computed['harmless'].get(r, [])) or '—'} | {'yes' if r in computed['mapped'] else 'no'} |")
    L += ["", f"Blocking ids with no approved equivalence: {', '.join(computed['blocking_unmapped']) or '—'}."]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    reg = load(REGISTER)
    tau = load(ROOT / "data" / "prerequisites" / "tau.json")
    equiv = load(ROOT / "data" / "prerequisites" / "equivalences.json")
    computed = analyse(tau, equiv)
    errors = validate(reg, tau, computed)
    if errors:
        print("\n".join(errors))
        return 1
    md = render(reg, computed)
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != md:
            print("stale")
            return 1
        print("up to date")
        return 0
    OUT.write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
