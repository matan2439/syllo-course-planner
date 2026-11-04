"""DegreeSpec: the one structured requirements format every degree uses (spec.json).

Generic fields are the source of truth for what they cover. ``legacy`` holds, verbatim,
only what the current board builder needs that has no generic home yet, so
``spec_to_program`` can rebuild the exact enriched-program dict the builder consumes today.
"""
import json
import re
from pathlib import Path
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.degrees.registry import ProgramEntry, load_institution

ROOT = Path(__file__).resolve().parents[2]
DEGREES_DIR = ROOT / "data" / "degrees"
EARLY_YEAR_INDEX = ROOT / "data" / "config" / "early_year_courses.json"

CatalogYearPolicy = Literal["start_year", "may_opt_newer", "always_latest"]
Semester = Literal["A", "B", "either"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MandatoryCourse(_Strict):
    course_id: str
    year: int
    semester: Semester
    placement_rule: str


class Category(_Strict):
    category_id: str
    name_he: str
    min_courses: Optional[int] = None
    min_credits: Optional[float] = None
    course_ids: list[str]
    group: Optional[str] = None


class MappedTo(_Strict):
    mapped_to: str


class NotPlanningRule(_Strict):
    not_planning_rule: str


CoverageEntry = Union[MappedTo, NotPlanningRule]


RuleKind = Literal[
    "equivalent_to", "prerequisite_substitute", "year_restriction", "cohort_restriction",
    "offering_window", "annual", "general_requirement_exemption",
]


class CourseRule(_Strict):
    """An official course-level rule the generic requirement fields cannot hold.

    ``enforced_by`` says honestly where it is enforced today: ``board`` only when the built
    board demonstrably encodes it (the ``note`` names the board field), otherwise ``none``
    (``check_rules_enforced`` then fails until something enforces it).
    """

    rule_id: str = Field(min_length=1)
    kind: RuleKind
    course_ids: list[str]
    params: dict = {}
    source_ids: list[str]
    enforced_by: Literal["board", "none"]
    note: str = Field(min_length=1, pattern=r"\S")


class KnownGap(_Strict):
    """An official source that was not read, so it may hold rules the spec does not have.

    ``check_known_gaps`` fails while any gap is recorded: a gap is closed by reading the
    source and mapping what it says, never by deleting the entry.
    """

    gap_id: str = Field(min_length=1)
    description: str = Field(min_length=1, pattern=r"\S")
    source_ids: list[str]


class SourceConflict(_Strict):
    """Official sources disagree (about a course, or program-wide when ``course_id`` is None);
    recorded instead of silently resolved."""

    course_id: Optional[str] = None
    description: str
    sources: list[str]


class DegreeSpec(_Strict):
    """A degree's requirements in the one generic format.

    ``mandatory_courses`` covers every year of the degree. It is currently a mirror kept
    synchronized with the builder input files (the legacy ``courses_file`` for Y3/Y4 and
    ``data/config/early_year_courses.json`` for Y1/Y2), enforced by
    ``tests/test_degree_spec.py::test_mandatory_courses_match_builder_inputs``. A course the
    two sources place differently appears once here and is listed in ``source_conflicts``.
    A later task makes the builder inputs generated from the spec.
    """

    program_id: str
    institution: str
    source_year: int
    total_required_credits: float
    catalog_year_policy: Optional[CatalogYearPolicy] = None
    mandatory_courses: list[MandatoryCourse]
    categories: list[Category]
    group_minimums: dict[str, int]
    general_requirement: Optional[dict] = None
    double_counting: Literal["forbidden", "allowed_listed"] = "forbidden"
    allowed_double_counted: list[str] = []
    ui: dict
    legacy: dict
    coverage: dict[str, CoverageEntry] = {}
    source_conflicts: list[SourceConflict] = []
    course_rules: list[CourseRule] = []
    known_gaps: list[KnownGap] = []

    @model_validator(mode="after")
    def _unique_rule_ids(self):
        ids = [r.rule_id for r in self.course_rules]
        dups = sorted({i for i in ids if ids.count(i) > 1})
        if dups:
            raise ValueError(f"duplicate course rule ids: {dups}")
        gaps = [g.gap_id for g in self.known_gaps]
        dups = sorted({i for i in gaps if gaps.count(i) > 1})
        if dups:
            raise ValueError(f"duplicate known gap ids: {dups}")
        return self


# ---------------------------------------------------------------- io


def spec_path(program: ProgramEntry) -> Path:
    return DEGREES_DIR / program.institution / program.base / str(program.year) / "spec.json"


def load_spec(path: Path) -> DegreeSpec:
    return DegreeSpec.model_validate_json(Path(path).read_text(encoding="utf-8"))


def write_spec(spec: DegreeSpec, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(spec.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    path.write_bytes(text.encode("utf-8"))  # LF on every OS


# ---------------------------------------------------------------- spec -> legacy program

# Legacy enriched-program keys rebuilt from generic fields (everything else is in legacy).
_GENERIC_PROGRAM_KEYS = {"program_id", "total_required_hours", "ui", "requirements"}
_GENERIC_REQUIREMENT_KEYS = {"core_courses_total_min", "core_categories", "general_requirements"}
_LEGACY_CATEGORY_KEYS = {"category_id", "name_he", "min_courses", "min_credits", "course_ids"}
_CORE = "core"
# general_requirement keys the legacy program has no equivalent for (never emitted to it)
_SPEC_ONLY_GENERAL_KEYS = {"credits_required"}


def _number(value: float):
    return int(value) if float(value).is_integer() else value


def _category_to_legacy(cat: Category) -> dict:
    out: dict = {"category_id": cat.category_id, "name_he": cat.name_he}
    if cat.min_courses is not None:
        out["min_courses"] = cat.min_courses
    if cat.min_credits is not None:
        out["min_credits"] = _number(cat.min_credits)
    out["course_ids"] = list(cat.course_ids)
    return out


def spec_to_program(spec: DegreeSpec) -> dict:
    """Rebuild the enriched-program dict ``build_semester_board(program=...)`` consumes.

    Only legacy pieces are emitted: mandatory_courses (all years) is not part of the
    enriched dict, which points at its Y3/Y4 courses file via legacy requirements.
    """
    legacy = spec.legacy
    cats = {c.category_id: c for c in spec.categories}

    requirements: dict = dict(legacy.get("requirements", {}))
    if _CORE in spec.group_minimums:
        requirements["core_courses_total_min"] = spec.group_minimums[_CORE]
    core = [_category_to_legacy(c) for c in spec.categories if c.group == _CORE]
    if core:
        requirements["core_categories"] = core
    keyed = legacy.get("requirement_category_keys", {})
    for key, category_id in keyed.items():
        requirements[key] = _category_to_legacy(cats[category_id])
    # A category with no legacy key and no group (any degree but the migrated ME) goes to the
    # builder's classic ``elective_categories`` list. That format is read INSTEAD of the PDF
    # one, so it then lists every unkeyed category, core ones included.
    keyed_ids = set(keyed.values())
    if any(c.group is None and c.category_id not in keyed_ids for c in spec.categories):
        requirements["elective_categories"] = [
            _category_to_legacy(c) for c in spec.categories if c.category_id not in keyed_ids
        ]
    if spec.general_requirement is not None:
        requirements["general_requirements"] = {
            k: v for k, v in spec.general_requirement.items() if k not in _SPEC_ONLY_GENERAL_KEYS
        }

    program: dict = dict(legacy.get("program", {}))
    program["program_id"] = spec.program_id
    program["total_required_hours"] = _number(spec.total_required_credits)
    program["requirements"] = requirements
    program["ui"] = spec.ui

    order = legacy.get("key_order", {})
    return {
        **{k: program[k] for k in order.get("program", []) if k in program},
        **program,
        "requirements": {
            **{k: requirements[k] for k in order.get("requirements", []) if k in requirements},
            **requirements,
        },
    }


# ---------------------------------------------------------------- legacy program -> spec (migration)

_SEMESTER_ID = re.compile(r"^year_(\d+)_semester_([ab])$")


def _parse_semester_ids(ids: list[str], course_id: str) -> tuple[int, Semester]:
    parsed = []
    for sid in ids:
        m = _SEMESTER_ID.match(sid)
        if not m:
            raise ValueError(f"{course_id}: unrecognized semester id {sid!r}")
        parsed.append((int(m.group(1)), m.group(2).upper()))
    years = {y for y, _ in parsed}
    if len(years) != 1:
        raise ValueError(f"{course_id}: allowed semesters span several years {ids}")
    semesters = {s for _, s in parsed}
    return years.pop(), (semesters.pop() if len(semesters) == 1 else "either")


def _category_from_legacy(raw: dict, group: Optional[str]) -> Category:
    unknown = set(raw) - _LEGACY_CATEGORY_KEYS
    if unknown:
        raise ValueError(f"category {raw.get('category_id')!r} has unmapped keys {sorted(unknown)}")
    return Category(**raw, group=group)


def _early_year_mandatory(program_id: str) -> list[MandatoryCourse]:
    if not EARLY_YEAR_INDEX.exists():
        return []
    rows = json.loads(EARLY_YEAR_INDEX.read_text(encoding="utf-8")).get(program_id, [])
    out = []
    for row in rows:
        year, semester = _parse_semester_ids([row["semesterId"]], row["courseId"])
        out.append(MandatoryCourse(course_id=row["courseId"], year=year, semester=semester,
                                   placement_rule="fixed_semester"))
    return out


def _late_year_mandatory(program: dict) -> list[MandatoryCourse]:
    ref = program.get("requirements", {}).get("mandatory_courses") or {}
    if not ref.get("courses_file"):
        return []
    rows = json.loads((ROOT / ref["courses_file"]).read_text(encoding="utf-8"))["courses"]
    page_rules = {c["course_id"]: c.get("placement_rule") for c in program.get("mandatory_courses_from_page", [])}
    out = []
    for row in rows:
        cid = row["course_id"]
        allowed = row.get("allowed_semesters") or []
        year, semester = _parse_semester_ids(allowed, cid)
        if row.get("year") is not None and row["year"] != year:
            raise ValueError(f"{cid}: year {row['year']} disagrees with allowed semesters {allowed}")
        rule = page_rules.get(cid) or ("fixed_semester" if len(allowed) == 1 else "choose_one_allowed_semester")
        out.append(MandatoryCourse(course_id=cid, year=year, semester=semester, placement_rule=rule))
    return out


def program_to_spec(program: dict, entry: ProgramEntry) -> DegreeSpec:
    """Express a legacy enriched program as a DegreeSpec (migration only)."""
    if program.get("program_id") != entry.id:
        raise ValueError(f"program_id {program.get('program_id')!r} != registry id {entry.id!r}")
    reqs = program.get("requirements", {})

    # All years: Y3/Y4 from the legacy mandatory file win over a Y1/Y2 duplicate, because
    # that file is what the board builder places today.
    # A course both sources place differently is kept once (late placement) and recorded.
    late = _late_year_mandatory(program)
    late_by_id = {m.course_id: m for m in late}
    early = _early_year_mandatory(entry.id)
    mandatory = [m for m in early if m.course_id not in late_by_id] + late
    early_src = EARLY_YEAR_INDEX.relative_to(ROOT).as_posix()
    late_src = (reqs.get("mandatory_courses") or {}).get("courses_file", "")
    conflicts = []
    for m in early:
        other = late_by_id.get(m.course_id)
        if other is None or (other.year, other.semester) == (m.year, m.semester):
            continue
        conflicts.append(SourceConflict(
            course_id=m.course_id,
            description=(
                f"listed Y{m.year}/{m.semester} in {early_src} and Y{other.year}/{other.semester} "
                f"in {late_src}; both current boards place it. mandatory_courses keeps "
                f"Y{other.year}/{other.semester}."
            ),
            sources=[early_src, late_src],
        ))

    categories = [_category_from_legacy(c, _CORE) for c in reqs.get("core_categories", [])]
    category_keys: dict[str, str] = {}
    for key, value in reqs.items():
        if key in _GENERIC_REQUIREMENT_KEYS or not (isinstance(value, dict) and "category_id" in value):
            continue
        categories.append(_category_from_legacy(value, None))
        category_keys[key] = value["category_id"]

    group_minimums = {}
    if "core_courses_total_min" in reqs:
        group_minimums[_CORE] = reqs["core_courses_total_min"]

    policy = entry.catalog_year_policy or load_institution(entry.institution).get("catalogYearPolicy")

    legacy = {
        "program": {k: v for k, v in program.items() if k not in _GENERIC_PROGRAM_KEYS},
        "requirements": {
            k: v for k, v in reqs.items() if k not in _GENERIC_REQUIREMENT_KEYS and k not in category_keys
        },
        "requirement_category_keys": category_keys,
        "key_order": {"program": list(program), "requirements": list(reqs)},
    }

    return DegreeSpec(
        program_id=entry.id,
        institution=entry.institution,
        source_year=entry.source_year,
        total_required_credits=program["total_required_hours"],
        catalog_year_policy=policy,
        mandatory_courses=mandatory,
        categories=categories,
        group_minimums=group_minimums,
        general_requirement=reqs.get("general_requirements"),
        ui=program.get("ui", {}),
        legacy=legacy,
        coverage={},
        source_conflicts=conflicts,
    )


# ---------------------------------------------------------------- path resolution

_BRACKET = r"\[([^\[\]]+)\]"
_PATHS = {
    "mandatory": re.compile(rf"^mandatory_courses{_BRACKET}$"),
    "category": re.compile(rf"^categories{_BRACKET}$"),
    "category_course": re.compile(rf"^categories{_BRACKET}\.course_ids{_BRACKET}$"),
    "group": re.compile(r"^group_minimums\.([^.\[\]]+)$"),
    "rule": re.compile(rf"^course_rules{_BRACKET}$"),
    "gap": re.compile(rf"^known_gaps{_BRACKET}$"),
}


def resolve_spec_path(spec: DegreeSpec, path: str) -> bool:
    """True when ``path`` names an existing target in ``spec``; False otherwise (never raises)."""
    try:
        if not isinstance(path, str):
            return False
        if path == "total_required_credits":
            return spec.total_required_credits is not None
        if path == "general_requirement":
            return spec.general_requirement is not None
        if path == "catalog_year_policy":
            return spec.catalog_year_policy is not None
        if m := _PATHS["mandatory"].match(path):
            return any(c.course_id == m.group(1) for c in spec.mandatory_courses)
        if m := _PATHS["category"].match(path):
            return any(c.category_id == m.group(1) for c in spec.categories)
        if m := _PATHS["category_course"].match(path):
            return any(c.category_id == m.group(1) and m.group(2) in c.course_ids for c in spec.categories)
        if m := _PATHS["gap"].match(path):
            return any(g.gap_id == m.group(1) for g in spec.known_gaps)
        if m := _PATHS["rule"].match(path):
            return any(r.rule_id == m.group(1) for r in spec.course_rules)
        if m := _PATHS["group"].match(path):
            return m.group(1) in spec.group_minimums
        return False
    except Exception:
        return False
