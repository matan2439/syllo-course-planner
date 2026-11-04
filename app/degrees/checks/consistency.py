"""Consistency (spec vs. official course facts) and plannability (built board) gates.

``facts`` is one program's flat view of ``tau_course_facts_<year>.json``
(``app.degrees.facts.load_program_facts``):
``course_id -> {"offering": {"offered_semesters": [...], "status": ...}, "program": {"credits",
"weekly_hours"} | None, ...}``. Problems prefixed ``warn:`` never fail a check.
"""
from typing import Any, Optional

from app.analysis.board_audit import audit_board
from app.degrees.checks import CheckResult
from app.degrees.spec import DegreeSpec

WARN = "warn:"


def _result(name: str, problems: list[str]) -> CheckResult:
    return CheckResult(
        name=name,
        passed=not any(not p.startswith(WARN) for p in problems),
        problems=sorted(problems),
    )


def _credits(facts: dict, extra: dict[str, float], cid: str) -> Optional[float]:
    program = (facts.get(cid) or {}).get("program")
    if program and program.get("credits") is not None:
        return float(program["credits"])
    value = extra.get(cid)
    return float(value) if value is not None else None


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def _referenced(spec: DegreeSpec) -> list[str]:
    """Mandatory + category course ids (the general requirement is handled separately)."""
    ids = [m.course_id for m in spec.mandatory_courses]
    for cat in spec.categories:
        ids.extend(cat.course_ids)
    return list(dict.fromkeys(ids))


def check_courses_known(
    spec: DegreeSpec, facts: dict, extra_credits: Optional[dict[str, float]] = None
) -> CheckResult:
    """Every referenced course has credits; missing hours / unknown offering only warn.

    ``extra_credits`` supplements credits for courses the facts file does not cover
    (e.g. early-year courses sourced from the builder's own course index).
    """
    extra = extra_credits or {}
    problems: list[str] = []
    for cid in _referenced(spec):
        fact = facts.get(cid)
        if _credits(facts, extra, cid) is None:
            problems.append(f"no credits for {cid}")
        program = (fact or {}).get("program") or {}
        if program and program.get("weekly_hours") is None:
            problems.append(f"{WARN} no weekly hours for {cid}")
        offering = (fact or {}).get("offering") or {}
        if offering.get("status", "unknown") == "unknown":
            problems.append(f"{WARN} offering unknown for {cid}")
    gen = spec.general_requirement
    if gen:
        no_credit = [c for c in gen.get("course_ids", []) if _credits(facts, extra, c) is None]
        if no_credit:
            problems.append(f"{WARN} general requirement: {len(no_credit)} course(s) have no credits")
    return _result("courses_known", problems)


def check_double_counting(spec: DegreeSpec) -> CheckResult:
    allowed = set(spec.allowed_double_counted)
    problems: list[str] = []
    if spec.double_counting == "forbidden" and allowed:
        problems.append("allow-list set but double_counting is forbidden")
        allowed = set()
    homes: dict[str, list[str]] = {}
    for m in spec.mandatory_courses:
        homes.setdefault(m.course_id, []).append("mandatory")
    for cat in spec.categories:
        for cid in cat.course_ids:
            homes.setdefault(cid, []).append(cat.category_id)
    gen = spec.general_requirement or {}
    for cid in gen.get("course_ids", []):
        homes.setdefault(cid, []).append(gen.get("category_id", "general_requirement"))
    problems += [
        f"{cid} counted in several places: {', '.join(sorted(where))}"
        for cid, where in homes.items()
        if len(where) > 1 and cid not in allowed
    ]
    return _result("double_counting", problems)


def check_degree_length(spec: DegreeSpec) -> CheckResult:
    """The degree is ``spec.degree_years`` (N) long: the boards cover Years 1-2 (early window)
    and Years 3..N (main board).

    Fails for every mandatory course whose year is outside 1..N (the build would otherwise drop
    it silently). A year with no mandatory course (e.g. an electives-only final year) is fine.
    A ``study_duration`` rule that states the standard length (``params.semesters`` /
    ``params.years``) must agree with N. A disagreement stays red even when it is recorded in
    ``source_conflicts``: which official source governs is the owner's decision, so the problem
    names the rule and the matching conflict (one citing any of the rule's source ids).
    """
    n = spec.degree_years
    problems: list[str] = []
    for m in spec.mandatory_courses:
        if not 1 <= m.year <= n:
            problems.append(f"mandatory {m.course_id} is in year {m.year}, outside the degree's years 1-{n} "
                            f"(degree_years {n})")
    for r in spec.course_rules:
        if r.kind != "study_duration":
            continue
        semesters, years = r.params.get("semesters"), r.params.get("years")
        found = []
        if semesters is not None and semesters != 2 * n:
            whole = "" if semesters % 2 == 0 else " (not whole years: degree_years cannot express it yet)"
            found.append(f"says {semesters} semesters{whole}, but degree_years {n} is {2 * n} semesters")
        if years is not None and years != n:
            found.append(f"says {years} years, but degree_years is {n}")
        if not found:
            continue
        cited = set(r.source_ids)
        conflicts = [i for i, c in enumerate(spec.source_conflicts) if cited & set(c.sources)]
        if conflicts:
            refs = ", ".join(f"source_conflicts[{i}] ({spec.source_conflicts[i].description!r})" for i in conflicts)
            tail = f"; recorded as {refs} — the owner decides which source governs"
        else:
            tail = "; record a source_conflicts entry and ask the owner which source governs"
        problems += [f"study_duration rule {r.rule_id} {f}{tail}" for f in found]
    return _result("degree_length", problems)


def check_mandatory_offered(spec: DegreeSpec, facts: dict) -> CheckResult:
    problems: list[str] = []
    for m in spec.mandatory_courses:
        offering = (facts.get(m.course_id) or {}).get("offering")
        if not offering or offering.get("status", "unknown") == "unknown":
            problems.append(f"{WARN} no offering data for mandatory {m.course_id}")
            continue
        if offering["status"] == "not_offered":
            problems.append(f"mandatory {m.course_id} is not offered")
            continue
        semesters = offering.get("offered_semesters") or []
        if not semesters:
            problems.append(f"{WARN} mandatory {m.course_id} is offered but lists no semesters")
        if m.semester != "either" and semesters and m.semester not in semesters:
            problems.append(
                f"mandatory {m.course_id} placed in semester {m.semester} "
                f"but offered only in {','.join(semesters)}"
            )
    return _result("mandatory_offered", problems)


def check_totals(
    spec: DegreeSpec, facts: dict, extra_credits: Optional[dict[str, float]] = None
) -> CheckResult:
    """Minimum required credits must fit the total, and a full selection must reach it.

    required = all mandatory credits + per category the larger of (its ``min_courses``
    smallest courses, ``min_credits``) + extra group-minimum courses (smallest remaining
    in the group) + the general requirement's credits when determinable (its official
    ``credits_required`` when stated, else from its courses' credits).
    reachable = mandatory + every category course + the general requirement's capped amount.
    """
    extra = extra_credits or {}
    problems: list[str] = []

    def credit(cid: str) -> Optional[float]:
        return _credits(facts, extra, cid)

    missing = sorted({c for c in _referenced(spec) if credit(c) is None})
    if missing:
        return _result("totals", [f"cannot compute totals: no credits for {', '.join(missing)}"])

    mandatory_ids = {m.course_id for m in spec.mandatory_courses}
    mandatory = sum(credit(c) for c in mandatory_ids)
    required = mandatory
    parts = [f"mandatory {_fmt(mandatory)}"]

    picked: set[str] = set()
    group_counts: dict[str, int] = {}
    for cat in spec.categories:
        ranked = sorted(cat.course_ids, key=lambda c: (credit(c), c))
        n = cat.min_courses or 0
        if n > len(ranked):
            problems.append(f"category {cat.category_id} needs {n} courses but lists {len(ranked)}")
            n = len(ranked)
        need = max(sum(credit(c) for c in ranked[:n]), cat.min_credits or 0.0)
        picked.update(ranked[:n])
        if cat.group:
            group_counts[cat.group] = group_counts.get(cat.group, 0) + n
        required += need
        if need:
            parts.append(f"{cat.category_id} {_fmt(need)}")

    for group, minimum in spec.group_minimums.items():
        extra_n = minimum - group_counts.get(group, 0)
        if extra_n <= 0:
            continue
        pool = sorted(
            {c for cat in spec.categories if cat.group == group for c in cat.course_ids} - picked,
            key=lambda c: (credit(c), c),
        )
        if len(pool) < extra_n:
            problems.append(f"group {group} needs {extra_n} more courses but only {len(pool)} remain")
        need = sum(credit(c) for c in pool[:extra_n])
        required += need
        parts.append(f"{group} group extra {_fmt(need)}")

    gen_min = gen_max = 0.0
    gen = spec.general_requirement
    if gen:
        gen_credits = sorted(c for c in (credit(i) for i in gen.get("course_ids", [])) if c is not None)
        n = gen.get("min_courses") or 0
        stated = gen.get("credits_required")
        gen_min = max(float(gen.get("min_credits") or 0.0), float(stated or 0.0))
        if n and len(gen_credits) >= n:
            gen_min = max(gen_min, sum(gen_credits[:n]))
            gen_max = max(gen_min, sum(gen_credits[-n:]))
        else:
            gen_max = gen_min
            if n and not gen_min:
                problems.append(
                    f"{WARN} general requirement credits unknown ({n} courses); excluded from totals"
                )
        required += gen_min
        if gen_min:
            parts.append(f"general {_fmt(gen_min)}")

    total = spec.total_required_credits
    if required > total:
        problems.append(f"minimum required {_fmt(required)} exceeds total {_fmt(total)} ({' + '.join(parts)})")

    reachable = mandatory + gen_max + sum(
        credit(c) for c in {i for cat in spec.categories for i in cat.course_ids} - mandatory_ids
    )
    if reachable < total:
        problems.append(
            f"a full selection reaches only {_fmt(reachable)} of {_fmt(total)} "
            f"(mandatory {_fmt(mandatory)} + all category courses + general {_fmt(gen_max)})"
        )
    return _result("totals", problems)


def check_rules_enforced(spec: DegreeSpec) -> CheckResult:
    """Every recorded course rule is enforced somewhere; ``enforced_by: none`` fails."""
    problems = [
        f"unenforced rule {r.rule_id}: {r.note}" for r in spec.course_rules if r.enforced_by == "none"
    ]
    return _result("rules_enforced", problems)


def check_known_gaps(spec: DegreeSpec) -> CheckResult:
    """Official sources not yet read: one failing problem per recorded gap."""
    problems = [f"known gap {g.gap_id}: {g.description}" for g in spec.known_gaps]
    return _result("known_gaps", problems)


def check_plannable(board: dict[str, Any]) -> CheckResult:
    problems = [
        f"{i.check}: {i.course_id or '-'}: {i.message}"
        for i in audit_board(board)
        if i.level == "error"
    ]
    return _result("plannable", problems)
