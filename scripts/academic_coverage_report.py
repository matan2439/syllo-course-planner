"""
Reproducible academic-data coverage report (read-only, offline, deterministic).

    python3 scripts/academic_coverage_report.py            # write JSON + Markdown reports
    python3 scripts/academic_coverage_report.py --check    # fail if the committed reports are stale

Inputs are committed files only: data/boards/*.json, data/prerequisites/{tau,equivalences}.json,
data/degrees/tau/*/<year>/spec.json, data/config/programs.json. No network, no database.
Outputs: docs/data-audit/coverage-report.json and docs/data-audit/coverage-report.md.

Honesty rules (they shape every number below):
  * "verified_none" (registrar links no prerequisite page) is NOT merged with "none_listed"
    (absence in ONE source) or "assumed_none_no_syllabus" (no official page at all).
  * A course whose prerequisite depends on an INFERRED equivalence is counted separately from one
    that depends only on registrar-listed alternatives.
  * Machine-extracted syllabus topics (syllabus_ai_topics) are never counted as official topics.
  * "Unresolved" is always listed, never rounded away.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOARDS = [
    "mechanical_engineering_2027", "mechanical_engineering_years_1_2_2027",
    "electrical_engineering_2027", "electrical_engineering_years_1_2_2027",
]
BOARD_TO_FAMILY = {b: ("mechanical_engineering" if b.startswith("mechanical") else "electrical_engineering") for b in BOARDS}
OUT_JSON = ROOT / "docs" / "data-audit" / "coverage-report.json"
OUT_MD = ROOT / "docs" / "data-audit" / "coverage-report.md"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def refs(expr) -> list[str]:
    if not expr:
        return []
    if "course" in expr:
        return [expr["course"]]
    return [c for child in expr.get("all", expr.get("any", [])) for c in refs(child)]


def board_courses(board_id: str) -> dict[str, dict]:
    board = load(ROOT / "data" / "boards" / f"{board_id}.json")
    records = list(board.get("metadata", {}).get("program_repository_courses", []))
    records += [c for s in board.get("semesters", []) for c in s.get("courses", [])]
    out: dict[str, dict] = {}
    for rec in records:
        cid = rec.get("course_id")
        if isinstance(cid, str):
            merged = out.setdefault(cid, {})
            for k, v in rec.items():  # first non-empty value wins, semester records fill gaps
                if merged.get(k) in (None, "", [], False) and v not in (None, "", []):
                    merged[k] = v
    return out


def spec_for(family: str, year: int = 2027):
    path = ROOT / "data" / "degrees" / "tau" / family / str(year) / "spec.json"
    return load(path) if path.exists() else None


def analyse() -> dict:
    prereq = load(ROOT / "data" / "prerequisites" / "tau.json")
    equiv = load(ROOT / "data" / "prerequisites" / "equivalences.json")
    programs = load(ROOT / "data" / "config" / "programs.json")["programs"]
    pcourses = {**prereq["referenced_courses"], **prereq["courses"]}

    enriched = {}
    for bid in BOARDS:
        ep = ROOT / "data" / "enriched_profiles" / f"{bid}.json"
        enriched[bid] = load(ep).get("profiles", {}) if ep.exists() else {}
    names = {}
    for rec in pcourses.values():
        names.update(rec.get("course_names", {}))
    retired: dict[str, dict] = {e["retired"]: e for e in equiv["equivalences"]}
    report: dict = {
        "prerequisite_source": {"catalog_year": prereq["catalog_year"], "generated_at": prereq["generated_at"], "parser_version": prereq["parser_version"]},
        "boards": {}, "registered_programs_without_board": [], "priority_gaps": [],
    }

    # Reverse dependency counts (how many supported-board courses need X) — impact weighting.
    dependents: dict[str, set[str]] = defaultdict(set)
    for cid, rec in prereq["courses"].items():
        for r in refs(rec.get("expression")) + refs(rec.get("corequisites")):
            dependents[r].add(cid)

    all_board_ids = set()
    for board_id in BOARDS:
        courses = board_courses(board_id)
        all_board_ids |= set(courses)
        family = BOARD_TO_FAMILY[board_id]
        spec = spec_for(family)
        mandatory = {m["course_id"] for m in (spec or {}).get("mandatory_courses", [])}
        n = len(courses)
        pstatus = Counter()
        inferred_dep, registrar_alt_dep, retired_unresolved, outside = [], [], [], []
        needs_review, sources_disagree = [], []
        syl_cov = syl_none = syl_no_url = 0
        official_topics = ai_topics = summary_only = no_topics = 0
        avail_confirmed = avail_not_offered = avail_unknown = 0
        class_unresolved: list[str] = []
        for cid, c in sorted(courses.items()):
            pr = pcourses.get(cid) or {}
            st = pr.get("status", "missing_record")
            pstatus[st] += 1
            if pr.get("needs_review"):
                needs_review.append(cid)
            if pr.get("sources_disagree"):
                sources_disagree.append(cid)
            for r in set(refs(pr.get("expression")) + refs(pr.get("corequisites"))):
                ref_rec = pcourses.get(r) or {}
                if r in retired:
                    e = retired[r]
                    applicable = [a for a in e["accepts"] if family in a.get("programs", [family])]
                    (inferred_dep if e["status"] == "inferred" and applicable else registrar_alt_dep).append(f"{cid}→{r}")
                elif ref_rec.get("status") == "not_in_catalog":
                    retired_unresolved.append(f"{cid}→{r}")
                elif r not in courses:
                    outside.append(f"{cid}→{r}")
            # syllabus
            if c.get("syllabus_text_available"):
                syl_cov += 1
            elif c.get("syllabus_url") or c.get("syllabus_source_url"):
                syl_none += 1
            else:
                syl_no_url += 1
            # topics
            if c.get("syllabus_topics_he"):
                official_topics += 1
            elif c.get("syllabus_ai_topics"):
                ai_topics += 1
            elif c.get("syllabus_summary_he"):
                summary_only += 1
            else:
                no_topics += 1
            # availability
            if c.get("offered_in_year") and c.get("offered_semesters"):
                avail_confirmed += 1
            elif c.get("offered_in_year") is False:
                avail_not_offered += 1
            else:
                avail_unknown += 1
            if not c.get("category_id") or c.get("needs_category_review"):
                class_unresolved.append(cid)
        unresolved_prereq = sorted(
            cid for cid in courses
            if (pcourses.get(cid) or {}).get("status") in ("none_listed", "assumed_none_no_syllabus", "unknown", "not_in_catalog", None)
            or (pcourses.get(cid) or {}).get("needs_review"))
        report["boards"][board_id] = {
            "family": family,
            "total_courses": n,
            "syllabus": {"text_available": syl_cov, "url_but_no_text": syl_none, "no_official_url": syl_no_url},
            "prerequisites": {
                "verified_expression": pstatus["verified"],
                "verified_none": pstatus["verified_none"],
                "none_listed_single_source": pstatus["none_listed"],
                "assumed_none_no_syllabus": pstatus["assumed_none_no_syllabus"],
                "not_in_catalog": pstatus["not_in_catalog"],
                "unknown": pstatus["unknown"],
                "no_record": pstatus["missing_record"],
                "unresolved_total": len(unresolved_prereq),
                "unresolved_course_ids": unresolved_prereq,
                "needs_review": needs_review, "sources_disagree": sources_disagree,
            },
            "equivalence_reliance": {
                "edges_via_inferred_equivalence": sorted(inferred_dep),
                "edges_via_registrar_listed_alternative": sorted(registrar_alt_dep),
                "edges_to_retired_course_without_equivalence": sorted(retired_unresolved),
                "edges_to_courses_outside_this_board": len(outside),
            },
            "topics": {"official_syllabus_topics": official_topics, "machine_extracted_topics_only": ai_topics, "unstructured_syllabus_summary_only": summary_only, "no_usable_topics": no_topics, "captured_evidence_profiles": len(enriched.get(board_id, {}))},
            "availability": {"confirmed_official_year": avail_confirmed, "not_offered_this_year": avail_not_offered, "unknown": avail_unknown, "projected": 0,
                             "note": "No projection from historical offering patterns exists yet; every availability value is the official listing of catalog year %d." % prereq["catalog_year"]},
            "classification": {"unresolved": len(class_unresolved), "unresolved_course_ids": class_unresolved[:60]},
            "specialization_requirements": {
                "spec_present": spec is not None,
                "categories": [c.get("category_id") or c.get("id") for c in (spec or {}).get("categories", [])],
                "mandatory_courses": len(mandatory),
                "source_conflicts_recorded": len((spec or {}).get("source_conflicts", [])),
                "known_gaps_recorded": len((spec or {}).get("known_gaps", [])),
            },
        }

    boards_by_program = {b for b in BOARDS}
    for p in programs:
        if p["id"] not in boards_by_program:
            has = (ROOT / "data" / "boards" / f"{p['id']}.json").exists()
            report["registered_programs_without_board"].append({"program": p["id"], "year": p["year"], "status": p.get("status"), "board_file_present": has})

    # Priority gaps: unresolved prerequisite records ranked by dependents and mandatory status.
    mand_all = set()
    for fam in ("mechanical_engineering", "electrical_engineering"):
        mand_all |= {m["course_id"] for m in (spec_for(fam) or {}).get("mandatory_courses", [])}
    gaps = []
    for cid, rec in pcourses.items():
        st = rec.get("status")
        if st in ("none_listed", "assumed_none_no_syllabus", "unknown", "not_in_catalog") or rec.get("needs_review"):
            deps = sorted(dependents.get(cid, []))
            on_boards = bool(rec.get("boards"))
            score = len(deps) * 3 + (5 if cid in mand_all else 0) + (1 if on_boards else 0)
            gaps.append({"course_id": cid, "name_he": rec.get("name_he") or (rec.get("catalog") or {}).get("name_he") or names.get(cid), "status": st,
                         "mandatory_in_a_spec": cid in mand_all, "dependent_courses": len(deps), "impact_score": score,
                         "equivalence_status": (retired[cid]["status"] if cid in retired else None)})
    gaps.sort(key=lambda g: (-g["impact_score"], g["course_id"]))
    report["priority_gaps"] = gaps[:25]
    report["priority_gap_total"] = len(gaps)
    return report


def render_md(r: dict) -> str:
    L = ["# Academic data coverage report", "",
         f"Generated by `python3 scripts/academic_coverage_report.py` from committed files only (prerequisite data: catalog {r['prerequisite_source']['catalog_year']}, generated {r['prerequisite_source']['generated_at']}, parser v{r['prerequisite_source']['parser_version']}). Deterministic: re-running without data changes yields no diff.", "",
         "Counts are over every course on the board (repository pool + placed courses). Nothing here is inferred silently: *verified_none*, *none_listed* and *assumed_none* are reported separately.", ""]
    L += ["## Per-board coverage", "", "| Board | Courses | Syllabus text | Prereq verified | Verified none | One-source none | Assumed none | Not in catalog | Unresolved total | Inferred-equiv. edges | Official topics | Machine topics | Summary text only | Evidence profiles | No structured topics | Avail. confirmed | Not offered | Class. unresolved |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for b, d in r["boards"].items():
        p = d["prerequisites"]
        L.append(f"| {b} | {d['total_courses']} | {d['syllabus']['text_available']} | {p['verified_expression']} | {p['verified_none']} | {p['none_listed_single_source']} | {p['assumed_none_no_syllabus']} | {p['not_in_catalog']} | {p['unresolved_total']} | {len(d['equivalence_reliance']['edges_via_inferred_equivalence'])} | {d['topics']['official_syllabus_topics']} | {d['topics']['machine_extracted_topics_only']} | {d['topics']['unstructured_syllabus_summary_only']} | {d['topics']['captured_evidence_profiles']} | {d['topics']['no_usable_topics']} | {d['availability']['confirmed_official_year']} | {d['availability']['not_offered_this_year']} | {d['classification']['unresolved']} |")
    L += ["", "## Specialization requirements represented", "", "| Board | Spec file | Mandatory courses | Categories / tracks | Recorded source conflicts | Known gaps |", "|---|---|---|---|---|---|"]
    for b, d in r["boards"].items():
        s = d["specialization_requirements"]
        L.append(f"| {b} | {'yes' if s['spec_present'] else '**no**'} | {s['mandatory_courses']} | {len(s['categories'])}: {', '.join(c for c in s['categories'] if c)} | {s['source_conflicts_recorded']} | {s['known_gaps_recorded']} |")
    L += ["", "## Registered programs with no board data", ""]
    for p in r["registered_programs_without_board"]:
        L.append(f"- `{p['program']}` ({p['year']}, status `{p['status']}`): board file {'present' if p['board_file_present'] else '**absent**'} — not auditable, not covered.")
    L += ["", f"## Priority gaps (top {len(r['priority_gaps'])} of {r['priority_gap_total']}, ranked by dependent courses ×3 + mandatory +5 + on-board +1)", "", "| Course | Name | Status | Dependents | Mandatory | Equivalence | Score |", "|---|---|---|---|---|---|---|"]
    for g in r["priority_gaps"]:
        L.append(f"| {g['course_id']} | {g['name_he'] or ''} | {g['status']} | {g['dependent_courses']} | {'yes' if g['mandatory_in_a_spec'] else ''} | {g['equivalence_status'] or ''} | {g['impact_score']} |")
    L += ["", "## Reading guide", "",
          "- **One-source none** (`none_listed`): only the syllabus page was available (no parsed catalog listing) and it lists none. Not a verified absence; must stay advisory.",
          "- **Assumed none**: no official page found; a product assumption. Never evidence of absence.",
          "- **Inferred-equiv. edges**: prerequisite edges that only resolve through an equivalence the university does not state.",
          "- **Machine topics / summary only**: topics extracted by a model, or a free-text syllabus summary with no structure; neither is an official, structured topic statement. *No structured topics* = neither exists on the board record.",
          "- Availability is the official listing of the catalog year; no historical projection exists yet (projected = 0)."]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    report = analyse()
    js = json.dumps(report, ensure_ascii=False, indent=1) + "\n"
    md = render_md(report)
    if args.check:
        stale = [p.name for p, t in ((OUT_JSON, js), (OUT_MD, md)) if not p.exists() or p.read_text(encoding="utf-8") != t]
        if stale:
            print("stale:", ", ".join(stale))
            return 1
        print("up to date")
        return 0
    OUT_JSON.write_text(js, encoding="utf-8")
    OUT_MD.write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
