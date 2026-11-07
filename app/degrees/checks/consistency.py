"""Consistency (spec vs. official course facts) and plannability (built board) gates.

``facts`` is one program's flat view of ``tau_course_facts_<year>.json``
(``app.degrees.facts.load_program_facts``):
``course_id -> {"offering": {"offered_semesters": [...], "status": ...}, "program": {"credits",
"weekly_hours"} | None, ...}``. Problems prefixed ``warn:`` never fail a check.
"""
import re
from typing import Any, Optional

from app.analysis.board_audit import audit_board
# Deliberate coupling: the board's own category reader, so check_board_carries_requirements sees
# exactly what the builder/validation read (a parallel re-implementation could drift from it).
from app.analysis.program_requirements import _get_unified_categories
from app.degrees.checks import CheckResult
from app.degrees.offering_windows import offering_window_ordinals, window_semesters
from app.degrees.registry import load_institution
from app.degrees.spec import DegreeSpec, spec_to_program

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


def check_rules_enforced(
    spec: DegreeSpec, boards: dict | None = None, facts: dict | None = None,
) -> CheckResult:
    """Every recorded course rule is enforced somewhere; ``enforced_by: none`` fails."""
    problems = [
        f"unenforced rule {r.rule_id}: {r.note}" for r in spec.course_rules if r.enforced_by == "none"
    ]
    for rule in spec.course_rules:
        if rule.enforced_by != "board":
            continue
        # Personal facts can remain unknown for an individual student, but the
        # published definition must reach the shared evaluator unchanged in both
        # windows. A note claiming enforcement is not a substitute for that data.
        runtime_definition = rule.kind in {"language_requirement", "cohort_restriction", "year_restriction", "load_limit", "optional_pathway", "course_exemption", "course_recognition"}
        runtime_definition = runtime_definition or (rule.kind == "study_duration" and "extension_years" in rule.params)
        runtime_definition = runtime_definition or (rule.kind == "distinct_categories" and rule.params.get("same_track_requires_third_lab") is True)
        if runtime_definition:
            for name in ("board", "early_years"):
                metadata = (boards or {}).get(name, {}).get("metadata", {})
                definitions = [r for r in metadata.get("degree_rules", []) if r.get("rule_id") == rule.rule_id]
                if definitions != [rule.model_dump()]:
                    problems.append(f"{rule.rule_id}: {name} does not preserve the exact runtime rule definition")
                if rule.kind == "course_recognition" and "requires_approval_after_track_minimum" in rule.params:
                    expected = sorted({cid for category in spec.categories if category.group == "track" for cid in category.course_ids})
                    actual = metadata.get("degree_rule_track_course_ids") if name == "early_years" else sorted({
                        cid for category in metadata.get("program_requirements_categories", {}).get("categories", [])
                        if category.get("group") == "track" for cid in category.get("course_ids", [])
                    })
                    if actual != expected:
                        problems.append(f"{rule.rule_id}: {name} does not preserve the track pool used to authorize supplementary courses")
                if name == "early_years" and rule.kind == "year_restriction" and rule.params.get("require_all_prior_year_courses") is True:
                    homes = metadata.get("degree_rule_mandatory_semesters", {})
                    expected_years = {course.course_id: course.year for course in spec.mandatory_courses}
                    if (not isinstance(homes, dict) or set(homes) != set(expected_years) or any(
                        not isinstance(home, str) or not re.fullmatch(r"year_[1-9]\d*_semester_[ab]", home)
                        or int(home.split("_")[1]) != expected_years.get(cid)
                        for cid, home in homes.items()
                    )):
                        problems.append(f"{rule.rule_id}: early_years does not preserve every published mandatory-course year")
            continue
        if rule.rule_id == "core-four-distinct-tracks":
            params = rule.params
            members = params.get("category_members")
            track_categories = {cat.category_id: cat.course_ids for cat in spec.categories if cat.group == "track"}
            core_ids = rule.course_ids
            valid_members = (
                isinstance(members, dict) and len(members) >= 4
                and all(
                    category in track_categories and isinstance(ids, list) and ids
                    and all(isinstance(cid, str) and cid.strip() for cid in ids)
                    and len(set(ids)) == len(ids)
                    for category, ids in members.items()
                )
            )
            if (rule.kind != "distinct_categories"
                    or set(params) != {"min_courses", "min_distinct_categories", "category_members",
                                       "within_track_courses_min", "labs_excluded_from_track_count"}
                    or any(type(params.get(key)) is not int or params[key] != value for key, value in (
                        ("min_courses", 4), ("min_distinct_categories", 4), ("within_track_courses_min", 12)))
                    or params.get("labs_excluded_from_track_count") is not True
                    or len(core_ids) < 4 or not all(isinstance(cid, str) and cid.strip() for cid in core_ids)
                    or len(set(core_ids)) != len(core_ids) or not valid_members
                    or set(core_ids) != {cid for ids in members.values() for cid in ids}):
                problems.append(f"{rule.rule_id}: unsupported board core definition")
                continue
            metadata = (boards or {}).get("board", {}).get("metadata", {})
            definitions = [r for r in metadata.get("degree_rules", []) if r.get("rule_id") == rule.rule_id]
            if definitions != [rule.model_dump()]:
                problems.append(f"{rule.rule_id}: main board does not preserve the exact core definition")
            requirements = metadata.get("program_requirements_categories", {})
            minimum = requirements.get("group_minimums", {}).get("track")
            if (type(minimum) is not int or minimum != 12
                    or type(spec.group_minimums.get("track")) is not int or spec.group_minimums.get("track") != 12):
                problems.append(f"{rule.rule_id}: main board must carry group_minimums.track = 12")
            categories = [cat for cat in requirements.get("categories", []) if cat.get("group") == "track"]
            if (len(categories) != len(track_categories)
                    or {cat.get("category_id"): cat.get("course_ids") for cat in categories} != track_categories):
                problems.append(f"{rule.rule_id}: main board does not preserve the exact track candidate pool")
            track_pool = {cid for ids in track_categories.values() for cid in ids}
            lab_ids = next((cat.course_ids for cat in spec.categories if cat.category_id == "advanced_labs"), [])
            labs = set(lab_ids)
            board_labs = [cat for cat in requirements.get("categories", []) if cat.get("category_id") == "advanced_labs"]
            if len(board_labs) != 1 or board_labs[0].get("course_ids") != lab_ids:
                problems.append(f"{rule.rule_id}: main board does not preserve the advanced lab pool")
            if track_pool & labs or set(core_ids) & labs:
                problems.append(f"{rule.rule_id}: advanced labs must be excluded from track and core pools")
            catalog_ids = {c.get("course_id") for c in metadata.get("program_repository_courses", [])}
            catalog_ids.update(c.get("course_id") for s in (boards or {}).get("board", {}).get("semesters", [])
                               for c in s.get("courses", []))
            if track_pool - catalog_ids:
                problems.append(f"{rule.rule_id}: main board lacks catalog identities for track candidates "
                                f"{', '.join(sorted(track_pool - catalog_ids))}")
            continue
        if rule.kind == "mutually_exclusive":
            ids = rule.course_ids
            params = rule.params
            printed = params.get("other_course_as_printed")
            valid_ids = all(isinstance(cid, str) and cid.strip() for cid in ids)
            self_reference = (
                valid_ids and len(ids) == 1 and params.get("published_self_reference") is True
                and set(params) <= {"published_self_reference", "other_course_as_printed", "other_name_as_printed"}
                and isinstance(printed, str) and bool(re.sub(r"[^0-9]", "", ids[0]))
                and re.sub(r"[^0-9]", "", printed) == re.sub(r"[^0-9]", "", ids[0])
                and ("other_name_as_printed" not in params
                     or isinstance(params["other_name_as_printed"], str) and bool(params["other_name_as_printed"].strip()))
            )
            if not valid_ids or (not self_reference and (len(set(ids)) < 2 or len(set(ids)) != len(ids) or params)):
                problems.append(f"{rule.rule_id}: unsupported board exclusion")
                continue
            for name in ("board", "early_years"):
                metadata = (boards or {}).get(name, {}).get("metadata", {})
                definitions = [r for r in metadata.get("degree_rules", []) if r.get("rule_id") == rule.rule_id]
                if definitions != [rule.model_dump()]:
                    problems.append(f"{rule.rule_id}: {name} does not encode the course exclusion")
            continue
        if rule.kind != "offering_window":
            continue
        definition = rule.model_dump()
        ordinals = offering_window_ordinals(definition)
        if ordinals is None:
            problems.append(f"{rule.rule_id}: unsupported board offering window")
            continue
        course_id = rule.course_ids[0]
        offering = (facts or {}).get(course_id, {}).get("offering", {})
        status = offering.get("status")
        if status not in {"offered", "not_offered"}:
            problems.append(f"{rule.rule_id}: missing verified offering for {course_id}")
            continue
        offered = offering["offered_semesters"] if status == "offered" else []
        for name in ("board", "early_years"):
            board = (boards or {}).get(name)
            if board is None:
                problems.append(f"{rule.rule_id}: missing built {name}")
                continue
            meta = board.get("metadata", {})
            expected = window_semesters(board, ordinals, offered)
            rows = [c for c in meta.get("program_repository_courses", []) if c["course_id"] == course_id]
            if (definition not in meta.get("degree_rules", []) or len(rows) != 1
                    or rows[0].get("offering_window_semesters") != expected
                    or rows[0].get("effective_allowed_semesters") != expected):
                problems.append(f"{rule.rule_id}: {name} does not encode the offering window {expected}")
    return _result("rules_enforced", problems)


def check_known_gaps(spec: DegreeSpec) -> CheckResult:
    """Official sources not yet read: one failing problem per recorded gap."""
    problems = [f"known gap {g.gap_id}: {g.description}" for g in spec.known_gaps]
    return _result("known_gaps", problems)


def check_board_carries_requirements(spec: DegreeSpec) -> CheckResult:
    """Every spec requirement reaches the board; one failing problem per one that cannot.

    The board consumes only what ``spec_to_program`` emits, read the way the builder reads it
    (``_get_unified_categories``). Generic group minimums are carried alongside the legacy
    core minimum. Unsupported requirements include a category the builder never reads (e.g. an
    unkeyed category in a non-core group with no plain category beside it), and a category's
    ``min_credits`` (emitted, but no board or validation code reads it). A dropped requirement
    stays red until the board carries it -- never a silent drop.
    """
    problems: list[str] = []
    program = spec_to_program(spec)
    reqs = program["requirements"]
    for group, minimum in sorted(spec.group_minimums.items()):
        if group == "core" and reqs.get("core_courses_total_min") == minimum:
            continue
        if group != "core" and reqs.get("group_minimums", {}).get(group) == minimum:
            continue
        problems.append(f"group_minimums.{group} ({minimum} courses) cannot reach the board: "
                        f"its group minimum was not emitted")
    read = {c.get("category_id") for c in _get_unified_categories(program)}
    key_of = {cid: key for key, cid in spec.legacy.get("requirement_category_keys", {}).items()}
    for cat in spec.categories:
        if cat.category_id not in read:
            key = key_of.get(cat.category_id)
            if key and "elective_categories" in reqs:
                cause = (f"keyed as requirements.{key}, but shadowed: elective_categories takes precedence "
                         f"over the PDF-format reader that reads requirement keys")
            elif key:
                cause = f"keyed as requirements.{key}, a key the board's reader does not read"
            else:
                cause = (f"no requirement key, and group {cat.group!r} is not core while no plain category "
                         f"emits an elective_categories list")
            problems.append(f"categories[{cat.category_id}] never reaches the board's category list: {cause}")
        if cat.min_credits is not None:
            problems.append(f"categories[{cat.category_id}].min_credits ({_fmt(cat.min_credits)}) cannot reach "
                            f"the board: it enforces min_courses only")
    problems += _general_credits_problems(spec)
    return _result("board_carries_requirements", problems)


def _general_credits_problems(spec: DegreeSpec) -> list[str]:
    """``general_requirement.credits_required`` is spec-only (the board enforces ``min_courses``),
    so it is carried only when it equals min_courses x the institution's
    ``generalRequirement.creditsPerCourse``. If that can't be verified, it counts as not carried."""
    gen = spec.general_requirement or {}
    stated = gen.get("credits_required")
    if stated is None:
        return []
    try:
        per_course = load_institution(spec.institution)["generalRequirement"]["creditsPerCourse"]
    except (KeyError, TypeError):
        per_course = None
    n = gen.get("min_courses") or 0
    if per_course is not None and float(stated) == n * float(per_course):
        return []
    why = (f"{spec.institution} states no generalRequirement.creditsPerCourse to verify it"
           if per_course is None else f"min_courses {n} x {_fmt(float(per_course))} credits per course "
                                      f"= {_fmt(n * float(per_course))}")
    return [f"general_requirement.credits_required ({_fmt(float(stated))}) cannot reach the board: it "
            f"enforces min_courses only, and {why}"]


def check_plannable(board: dict[str, Any]) -> CheckResult:
    problems = [
        f"{i.check}: {i.course_id or '-'}: {i.message}"
        for i in audit_board(board)
        if i.level == "error"
    ]
    return _result("plannable", problems)
