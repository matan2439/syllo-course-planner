"""Scaffolding a new draft degree: its registry entry and an empty spec skeleton.

``degree.py init`` resolves the program in TAU's official program index, then uses these to
append a ``status: "draft"`` registry entry and write ``spec.json`` with nothing mapped yet
(the add-degree skill fills it from the evidence).
"""
from __future__ import annotations

import re

from app.degrees.registry import ProgramEntry, load_institution
from app.degrees.spec import DegreeSpec
from app.scraping.tau_program_scraper import ProgramIndexEntry


def _year_label(year: int, academic_year_he: str) -> str:
    """'2027 (תשפ"ז)' from the index's 'תשפ"ז' (live form; an optional ' (2026-2027)' is dropped);
    just the year when it has none."""
    hebrew = academic_year_he.split("(")[0].strip()
    return f"{year} ({hebrew})" if hebrew else str(year)


BASE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def registry_entry(index_entry: ProgramIndexEntry, shana: int, base: str,
                   track_he: str | None = None, *, name_en: str | None = None) -> ProgramEntry:
    """The draft registry entry for TAU year ``shana`` of the indexed program, as ``<base>_<shana+1>``.

    ``base`` is a bare slug (no ``<institution>:`` prefix: paths are named after it). ``name_en``
    defaults to a placeholder from the slug (the index has no English title); ``degree.py init``
    requires it explicitly."""
    if not BASE_PATTERN.fullmatch(base or ""):
        raise ValueError(f"base {base!r} must match {BASE_PATTERN.pattern} (no institution prefix)")
    year = shana + 1
    title = index_entry.title_he
    described = f"{title} — {track_he}" if track_he else title
    return ProgramEntry(
        id=f"{base}_{year}",
        institution="tau",
        base=base,
        year=year,
        source_year=shana,
        name_he=title,
        name_en=name_en or base.replace("_", " ").title(),
        track=track_he,
        family_id=base,
        family_description_he=described,
        description_he=described,
        year_label_he=_year_label(year, index_entry.academic_year_he if index_entry.academic_year == str(shana) else ""),
        board_json_file=f"{base}_semester_board_{year}.json",
        source_ids={"tcid": index_entry.tcid},
        status="draft",
        is_family_default=True,
        capabilities=[],
    )


def new_spec(entry: ProgramEntry) -> DegreeSpec:
    """An empty spec for ``entry``: nothing required, nothing mapped yet."""
    return DegreeSpec(
        program_id=entry.id,
        institution=entry.institution,
        source_year=entry.source_year,
        total_required_credits=0,
        catalog_year_policy=entry.catalog_year_policy or load_institution(entry.institution).get("catalogYearPolicy"),
        mandatory_courses=[],
        categories=[],
        group_minimums={},
        ui={},
        legacy={},
        coverage={},
    )
