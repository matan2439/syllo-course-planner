"""
Automated consistency/quality checks for a generated semester-board JSON
(see data/parsed_json/mechanical_semester_board_2027.json for the schema).

Pure-JSON checks — no DB/network access required, so this can run in CI or
as a pre-sync gate before pushing board_json to Supabase.

Usage:
    python -m app.analysis.board_audit data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


class AuditIssue:
    def __init__(self, level: str, check: str, course_id: str | None, message: str):
        self.level = level  # "error" | "warning"
        self.check = check
        self.course_id = course_id
        self.message = message

    def __repr__(self) -> str:
        cid = f"[{self.course_id}] " if self.course_id else ""
        return f"{self.level.upper():7s} {self.check:28s} {cid}{self.message}"


def compute_board_hash(board: dict[str, Any]) -> str:
    """Stable hash of the board's semester/course placement data.

    Excludes `metadata.board_data_version` itself so the hash is reproducible.
    """
    payload = {
        "semesters": board.get("semesters", []),
        "program_repository_courses": board.get("metadata", {}).get("program_repository_courses", []),
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def _all_courses(board: dict[str, Any]) -> list[tuple[str | None, dict[str, Any]]]:
    """Yield (semester_id, course) for every placed course, plus
    (None, course) for repository (unplaced) courses."""
    out: list[tuple[str | None, dict[str, Any]]] = []
    for sem in board.get("semesters", []):
        for c in sem.get("courses", []):
            out.append((sem.get("semester_id"), c))
    for c in board.get("metadata", {}).get("program_repository_courses", []):
        out.append((None, c))
    return out


_ANNUAL_TEXT_MARKERS = ("קורס שנתי", "שנתי")
_SEM_SUFFIX = {"A": "_semester_a", "B": "_semester_b"}


def _is_annual(c: dict[str, Any]) -> bool:
    return bool(c.get("is_annual"))


def _syllabus_text(c: dict[str, Any]) -> str:
    parts = []
    for f in ("syllabus_summary_he", "syllabus_structure_he", "syllabus_topics_he",
              "syllabus_assessment_he"):
        v = c.get(f)
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, list):
            parts.extend(str(x) for x in v)
    return " ".join(parts)


def _text_says_annual(c: dict[str, Any]) -> bool:
    text = _syllabus_text(c)
    # High-confidence only: explicit "קורס שנתי" phrasing.
    return "קורס שנתי" in text


def _offered_to_effective_set(offered: list[str]) -> set[str]:
    suffixes = [_SEM_SUFFIX[o] for o in offered if o in _SEM_SUFFIX]
    return set(suffixes)


def audit_board(board: dict[str, Any]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    all_courses = _all_courses(board)

    # 1. every course has course_id and a name
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if not cid:
            issues.append(AuditIssue("error", "missing_course_id", None, f"course in {sem_id} has no course_id"))
            continue
        if not c.get("name_he"):
            issues.append(AuditIssue("warning", "missing_name", cid,
                                      f"course has no name_he (name_source={c.get('name_source')!r})"))

    # 2. mandatory courses have placement_policy
    # 3. flexible mandatory courses have program_allowed_semesters
    # 4/5/6. offered_semesters / effective_allowed_semesters / placement validity
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if not c.get("is_mandatory"):
            continue
        if not c.get("placement_policy"):
            issues.append(AuditIssue("error", "missing_placement_policy", cid, "mandatory course has no placement_policy"))

        if c.get("placement_policy") != "flexible":
            continue

        program_allowed = c.get("program_allowed_semesters")
        if not program_allowed:
            issues.append(AuditIssue("error", "missing_program_allowed", cid,
                                      "flexible mandatory course has no program_allowed_semesters"))
            continue

        offered = c.get("offered_semesters")
        confidence = c.get("offering_source_confidence")
        effective = c.get("effective_allowed_semesters")

        if offered is not None and confidence == "high":
            expected_effective = _intersect_effective(program_allowed, offered)
            if set(effective or []) != set(expected_effective):
                issues.append(AuditIssue(
                    "error", "bad_effective_allowed", cid,
                    f"effective_allowed_semesters={effective} does not match "
                    f"program_allowed ∩ offered = {expected_effective}",
                ))
        elif effective is not None and set(effective) != set(program_allowed):
            issues.append(AuditIssue(
                "error", "unjustified_restriction", cid,
                f"effective_allowed_semesters={effective} is narrower than "
                f"program_allowed_semesters={program_allowed} but offering_source_confidence={confidence!r} "
                f"(must be 'high' with a known offered_semesters to restrict)",
            ))

        # 6. placement vs effective_allowed_semesters
        if sem_id is not None and effective and sem_id not in effective:
            issues.append(AuditIssue(
                "error", "invalid_placement", cid,
                f"placed in {sem_id}, outside effective_allowed_semesters={effective}",
            ))

    # 6b. GENERAL placement legality (Issue 3): ANY placed course — mandatory or
    #     elective — must sit inside its effective_allowed_semesters when those
    #     are known. The mandatory-only check above does not cover electives such
    #     as 0542-4223 (non-mandatory, effective=[*_semester_a]), so a Semester-B
    #     placement of it would otherwise pass. Annual courses legitimately span
    #     both spanned semesters and are exempt.
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if c.get("is_annual") or c.get("placement_policy") == "annual":
            continue
        effective = c.get("effective_allowed_semesters")
        if sem_id is not None and effective and sem_id not in effective:
            issues.append(AuditIssue(
                "error", "invalid_placement", cid,
                f"placed in {sem_id}, outside effective_allowed_semesters={effective}",
            ))

    # 7. semester total_weekly_hours == sum of visible course hours
    for sem in board.get("semesters", []):
        sem_id = sem.get("semester_id")
        visible_sum = sum(c.get("weekly_hours") or 0 for c in sem.get("courses", []))
        reported = sem.get("total_weekly_hours")
        if reported is not None and abs(visible_sum - reported) > 0.01:
            issues.append(AuditIssue(
                "error", "hours_mismatch", None,
                f"{sem_id}: total_weekly_hours={reported} but courses sum to {visible_sum}",
            ))

    # 8. no duplicated courses across semesters — EXCEPT annual courses, which
    #    legitimately span (are physically placed in) both spanned semesters.
    seen: dict[str, list[str]] = {}
    annual_placements: dict[str, list[str]] = {}
    for sem in board.get("semesters", []):
        sem_id = sem.get("semester_id")
        for c in sem.get("courses", []):
            cid = c.get("course_id")
            if not cid:
                continue
            if _is_annual(c):
                annual_placements.setdefault(cid, []).append(sem_id)
                continue
            if cid in seen:
                issues.append(AuditIssue(
                    "error", "duplicate_placement", cid,
                    f"placed in both {seen[cid][0]} and {sem_id}",
                ))
            else:
                seen[cid] = [sem_id]

    # 9. completed/personal status must not be baked into board_json
    for key in ("personal_status", "user_course_statuses", "completed_by_user"):
        if key in board.get("metadata", {}):
            issues.append(AuditIssue(
                "error", "personal_status_in_board", None,
                f"metadata.{key} should not be present in shared board_json",
            ))
    for sem_id, c in all_courses:
        for key in ("personal_status", "locked_by_user_override"):
            if key in c:
                issues.append(AuditIssue(
                    "error", "personal_status_in_board", c.get("course_id"),
                    f"course has '{key}' field — personal status must not be baked into board_json",
                ))

    # 10/11. syllabus enrichment coverage
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if c.get("syllabus_url") and not c.get("syllabus_summary_he"):
            issues.append(AuditIssue("warning", "syllabus_not_summarized", cid,
                                      f"has syllabus_url but no syllabus_summary_he: {c['syllabus_url']}"))
        if c.get("syllabus_parse_error"):
            issues.append(AuditIssue("warning", "syllabus_parse_failed", cid,
                                      str(c["syllabus_parse_error"])))

    # 12. repository courses where syllabus_summary_he exists but the AI
    # context would still be thin (missing topics/assessment)
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if c.get("syllabus_summary_he") and sem_id is None:
            if not c.get("syllabus_topics_he") and not c.get("syllabus_assessment_he"):
                issues.append(AuditIssue("warning", "syllabus_summary_thin", cid,
                                          "has syllabus_summary_he but no topics/assessment fields — "
                                          "AI context for this elective may be thin"))

    # 13. mojibake/garbled Hebrew text in name/category fields
    _HEBREW_TEXT_FIELDS = ("name_he", "program_category_name_he", "syllabus_summary_he")
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        for field in _HEBREW_TEXT_FIELDS:
            val = c.get(field)
            if not val:
                continue
            if "�" in val or any("À" <= ch <= "ÿ" for ch in val):
                issues.append(AuditIssue("error", "mojibake_text", cid,
                                          f"{field} appears to contain garbled/mojibake text: {val!r}"))

    # 14. course has a parsed syllabus summary but no hour data at all —
    # distinct from "syllabus missing" (check 10/11)
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if c.get("syllabus_summary_he") and c.get("weekly_hours") is None and c.get("semester_hours") is None:
            issues.append(AuditIssue("warning", "hours_missing_with_syllabus", cid,
                                      "has syllabus_summary_he but no weekly_hours/semester_hours data"))

    # === Extended data-integrity checks (offering / annual / legality) ===

    # Deduplicate course records by course_id for per-course checks (a course
    # may appear in multiple semesters when annual). Use the first record.
    by_cid: dict[str, dict[str, Any]] = {}
    placements_by_cid: dict[str, list[str]] = {}
    for sem_id, c in all_courses:
        cid = c.get("course_id")
        if not cid:
            continue
        by_cid.setdefault(cid, c)
        if sem_id is not None:
            placements_by_cid.setdefault(cid, []).append(sem_id)

    # CHECK 1 — Offering mismatch (high confidence only): syllabus/offering clearly
    # indicates a single semester but effective_allowed_semesters disagrees.
    for cid, c in by_cid.items():
        if _is_annual(c):
            continue
        offered = c.get("offered_semesters")
        effective = c.get("effective_allowed_semesters")
        confidence = c.get("offering_source_confidence")
        if (offered and confidence == "high" and len(offered) == 1
                and effective):
            # Single offered semester => every effective entry must end with that
            # semester's suffix. Flag only if an effective entry points at the
            # OTHER semester (high-confidence contradiction).
            suffixes = _offered_to_effective_set(offered)  # e.g. {"_semester_b"}
            bad = [e for e in effective if not any(e.endswith(suf) for suf in suffixes)]
            if bad and suffixes:
                issues.append(AuditIssue(
                    "error", "offering_mismatch", cid,
                    f"offered_semesters={offered} (confidence=high) indicates a single "
                    f"semester but effective_allowed_semesters contains {bad} which is in a "
                    f"different semester",
                ))

    # CHECK 2 — Annual problems.
    for cid, c in by_cid.items():
        if _text_says_annual(c) and not _is_annual(c):
            issues.append(AuditIssue(
                "error", "annual_not_represented", cid,
                "syllabus text contains 'קורס שנתי' but course lacks is_annual/spans_semesters representation",
            ))
        if _is_annual(c):
            spans = c.get("spans_semesters")
            if not c.get("count_hours_once"):
                issues.append(AuditIssue(
                    "error", "annual_missing_count_once", cid,
                    "is_annual course must have count_hours_once=true (degree hours counted once)",
                ))
            if not spans or len(spans) != 2:
                issues.append(AuditIssue(
                    "error", "annual_bad_span", cid,
                    f"is_annual course must have spans_semesters of length 2, got {spans}",
                ))
            if not c.get("root_course_id"):
                issues.append(AuditIssue(
                    "error", "annual_missing_root_course_id", cid,
                    "is_annual course must have root_course_id set (planner_goals.placedHours "
                    "dedupes on it; without it the course's hours are double-counted)",
                ))

    # CHECK 3 — Component conflicts: lecture/course + lab pairs (same base course id,
    # differing only by suffix) whose effective semesters conflict without syllabus
    # support. Conservative: only flag when both have effective sets, they are disjoint,
    # and neither cites high-confidence offering evidence.
    base_groups: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for cid, c in by_cid.items():
        # base id = strip a trailing -NN component suffix if present
        parts = cid.split("-")
        base = "-".join(parts[:2]) if len(parts) >= 2 else cid
        base_groups.setdefault(base, []).append((cid, c))
    for base, group in base_groups.items():
        if len(group) < 2:
            continue
        eff_sets = []
        for cid, c in group:
            eff = c.get("effective_allowed_semesters")
            if eff:
                eff_sets.append((cid, set(eff), c.get("offering_source_confidence")))
        for i in range(len(eff_sets)):
            for j in range(i + 1, len(eff_sets)):
                cid_a, set_a, conf_a = eff_sets[i]
                cid_b, set_b, conf_b = eff_sets[j]
                if set_a.isdisjoint(set_b) and not (conf_a == "high" and conf_b == "high"):
                    issues.append(AuditIssue(
                        "error", "component_semester_conflict", cid_a,
                        f"component pair {cid_a}/{cid_b} have disjoint effective semesters "
                        f"{sorted(set_a)} vs {sorted(set_b)} without high-confidence offering evidence",
                    ))

    # CHECK 4 — Board legality: every placed course is in its legal effective set;
    # annual courses present in both spanned semesters.
    for sem_id, c in all_courses:
        if sem_id is None:
            continue
        cid = c.get("course_id")
        effective = c.get("effective_allowed_semesters")
        if effective and sem_id not in effective:
            issues.append(AuditIssue(
                "error", "illegal_board_placement", cid,
                f"placed in {sem_id} but not in effective_allowed_semesters={effective}",
            ))
    for cid, c in by_cid.items():
        if not _is_annual(c):
            continue
        spans = set(c.get("spans_semesters") or [])
        placed = set(placements_by_cid.get(cid, []))
        if spans and placed and placed != spans:
            issues.append(AuditIssue(
                "error", "annual_placement_incomplete", cid,
                f"annual course must be placed in all spanned semesters {sorted(spans)} "
                f"but is placed in {sorted(placed)}",
            ))

    # CHECK 5 — Recommended-plan conflict: recommended_semester not a subset of
    # effective_allowed_semesters (effective wins; report the conflict).
    for cid, c in by_cid.items():
        rec = c.get("recommended_semester")
        effective = c.get("effective_allowed_semesters")
        if rec and effective and rec not in effective:
            placed = placements_by_cid.get(cid, [])
            # If the course is actually PLACED outside effective, that's a hard error
            # (real legality violation). If it's merely stale recommended metadata
            # while placement/effective are consistent, surface it as a warning
            # (effective wins) without masking it.
            placed_legally = bool(placed) and all(p in effective for p in placed)
            level = "warning" if placed_legally else "error"
            issues.append(AuditIssue(
                level, "recommended_conflicts_effective", cid,
                f"recommended_semester={rec!r} is not in effective_allowed_semesters={effective} "
                f"(effective wins; recommended is stale/wrong)",
            ))

    # CHECK 6 — PLACED course missing confident offering data is an ERROR (no
    # silent fallback). A placed, non-annual course MUST carry
    # effective_allowed_semesters; otherwise validateFinalPlan would block the
    # plan (`missing_offering_data`) and there is NO fallback to
    # program_allowed_semesters for final legality. This mirrors the UI authority
    # validator so the static board can never present an un-validatable placement.
    for sem_id, c in all_courses:
        if sem_id is None:
            continue  # repository (unplaced) — handled as a warning below
        if c.get("is_annual") or c.get("placement_policy") == "annual":
            continue
        cid = c.get("course_id")
        if not c.get("effective_allowed_semesters"):
            issues.append(AuditIssue(
                "error", "placed_missing_offering_data", cid,
                f"placed in {sem_id} but has no effective_allowed_semesters "
                "(confident offering data) — validateFinalPlan would block this; "
                "no fallback to program_allowed_semesters is permitted",
            ))

    # CHECK 7 — Repository (unplaced) electives missing confident offering data
    # are a data-quality WARNING (not an error): they cannot be safely placed by
    # the planner until offering data is resolved. Report the count + ids so the
    # data gap is visible. (Mandatory courses are excluded — they are governed by
    # program_allowed_semesters checks above.)
    missing_offering_repo = [
        c.get("course_id")
        for sem_id, c in all_courses
        if sem_id is None
        and not c.get("is_mandatory")
        and not c.get("is_annual")
        and c.get("placement_policy") != "annual"
        and not c.get("effective_allowed_semesters")
    ]
    if missing_offering_repo:
        ids = ", ".join(sorted(missing_offering_repo))
        issues.append(AuditIssue(
            "warning", "elective_missing_offering_data", None,
            f"{len(missing_offering_repo)} repository elective(s) lack confident "
            f"effective_allowed_semesters and cannot be placed until resolved: {ids}",
        ))

    return issues



def _intersect_effective(program_allowed: list[str], offered: list[str]) -> list[str]:
    suffix_map = {"A": "_semester_a", "B": "_semester_b"}
    suffixes = [suffix_map[p] for p in offered if p in suffix_map]
    effective = [s for s in program_allowed if any(s.endswith(suf) for suf in suffixes)]
    return effective or list(program_allowed)


def format_report(board: dict[str, Any], issues: list[AuditIssue]) -> str:
    errors   = [i for i in issues if i.level == "error"]
    warnings = [i for i in issues if i.level == "warning"]

    lines = ["=== Board Audit Report ===", ""]
    lines.append(f"board_hash: {compute_board_hash(board)}")
    lines.append(f"total courses: {len(_all_courses(board))}")
    lines.append(f"errors: {len(errors)}  warnings: {len(warnings)}")
    lines.append("")

    if errors:
        lines.append("-- ERRORS --")
        lines.extend(repr(i) for i in errors)
        lines.append("")
    if warnings:
        lines.append("-- WARNINGS --")
        lines.extend(repr(i) for i in warnings)
        lines.append("")

    lines.append("PASS" if not errors else "FAIL")
    return "\n".join(lines)


def main() -> int:
    board_path = Path(sys.argv[1])
    board = json.loads(board_path.read_text(encoding="utf-8"))
    issues = audit_board(board)
    print(format_report(board, issues))
    return 1 if any(i.level == "error" for i in issues) else 0


if __name__ == "__main__":
    raise SystemExit(main())
