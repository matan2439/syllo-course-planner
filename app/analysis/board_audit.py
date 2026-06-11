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

    # 8. no duplicated courses across semesters
    seen: dict[str, str] = {}
    for sem in board.get("semesters", []):
        sem_id = sem.get("semester_id")
        for c in sem.get("courses", []):
            cid = c.get("course_id")
            if not cid:
                continue
            if cid in seen:
                issues.append(AuditIssue(
                    "error", "duplicate_placement", cid,
                    f"placed in both {seen[cid]} and {sem_id}",
                ))
            else:
                seen[cid] = sem_id

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
