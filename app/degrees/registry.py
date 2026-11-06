"""Single degree registry, shared with TypeScript (shared/programs.ts)."""
import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONFIG_DIR = Path(__file__).resolve().parents[2] / "data" / "config"
DEFAULT_PATH = CONFIG_DIR / "programs.json"
INSTITUTIONS_PATH = CONFIG_DIR / "institutions.json"


class ProgramEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    # ``<base>_<year>`` ids, optionally ``<institution>:``-prefixed (shared/programs.ts: same rule).
    id: str = Field(pattern=r"^(?:[a-z0-9_]+:)?[a-z0-9_]+$")
    institution: str = Field(pattern=r"^[a-z0-9_]+$")
    base: str
    year: int
    source_year: int = Field(alias="sourceYear")
    name_he: str = Field(alias="nameHe")
    name_en: str = Field(alias="nameEn")
    track: Optional[str] = None
    family_id: str = Field(alias="familyId")
    family_description_he: str = Field(alias="familyDescriptionHe")
    description_he: str = Field(alias="descriptionHe")
    year_label_he: str = Field(alias="yearLabelHe")
    board_json_file: str = Field(alias="boardJsonFile")
    source_ids: dict[str, str] = Field(alias="sourceIds")
    status: Literal["draft", "live", "archived"]
    public_planner: Optional[bool] = Field(default=None, alias="publicPlanner")
    is_family_default: bool = Field(alias="isFamilyDefault")
    capabilities: list[str]
    catalog_year_policy: Optional[Literal["start_year", "may_opt_newer", "always_latest"]] = Field(
        default=None, alias="catalogYearPolicy"
    )

    @model_validator(mode="after")
    def _id_matches_base_and_year(self):
        # shared/programs.ts parseRegistry: same rules.
        prefix, _, bare = self.id.rpartition(":")
        if prefix and prefix != self.institution:
            raise ValueError(f"{self.id}: id prefix must be the institution ({self.institution})")
        if bare != f"{self.base}_{self.year}":
            raise ValueError(f"{self.id}: id must be <base>_<year> ({self.base}_{self.year})")
        if self.year != self.source_year + 1:
            raise ValueError(f"{self.id}: year ({self.year}) must be sourceYear + 1 ({self.source_year + 1})")
        return self


def validate_registry(entries: list[ProgramEntry]) -> list[ProgramEntry]:
    """Registry-wide rules (shared/programs.ts parseRegistry: same rules): ids are unique and
    every family has exactly one default entry. Per-entry id/base/year rules are on ProgramEntry."""
    ids = [e.id for e in entries]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        raise ValueError(f"duplicate program ids: {dups}")
    defaults: dict[str, int] = {}
    for e in entries:
        defaults[e.family_id] = defaults.get(e.family_id, 0) + int(e.is_family_default)
    bad = {f: n for f, n in sorted(defaults.items()) if n != 1}
    if bad:
        raise ValueError(f"every family needs exactly one isFamilyDefault entry: {bad}")
    return entries


def load_registry(path: Path | None = None) -> list[ProgramEntry]:
    """The validated registry (default: data/config/programs.json, resolved at call time)."""
    raw = json.loads(Path(path or DEFAULT_PATH).read_text(encoding="utf-8"))
    return validate_registry([ProgramEntry.model_validate(p) for p in raw["programs"]])


def get_program(program_id: str) -> ProgramEntry:
    for entry in load_registry():
        if entry.id == program_id:
            return entry
    raise KeyError(program_id)


def load_institution(institution_id: str) -> dict:
    raw = json.loads(INSTITUTIONS_PATH.read_text(encoding="utf-8"))
    for inst in raw["institutions"]:
        if inst["id"] == institution_id:
            return inst
    raise KeyError(institution_id)


def add_program(entry: ProgramEntry, path: Path | None = None) -> None:
    """Append ``entry`` to the registry file (default: data/config/programs.json), keeping the
    existing entries, their order and the file's layout (indent 2, UTF-8, trailing newline).
    The whole registry, new entry included, is validated before anything is written."""
    path = Path(path or DEFAULT_PATH)
    raw = json.loads(path.read_text(encoding="utf-8"))
    validate_registry([ProgramEntry.model_validate(p) for p in raw["programs"]] + [entry])
    row = entry.model_dump(mode="json", by_alias=True)
    if row.get("catalogYearPolicy") is None:
        row.pop("catalogYearPolicy", None)  # absent = the institution default
    raw["programs"].append(row)
    path.write_bytes((json.dumps(raw, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def set_status(program_id: str, status: str, path: Path | None = None) -> None:
    """Set ``program_id``'s ``status`` in the registry file (default: data/config/programs.json),
    changing nothing else and keeping add_program's layout (indent 2, UTF-8, trailing newline).
    The whole registry, changed entry included, is validated before anything is written;
    an unknown id raises KeyError."""
    path = Path(path or DEFAULT_PATH)
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = [dict(p, status=status) if p.get("id") == program_id else p for p in raw["programs"]]
    if not any(p.get("id") == program_id for p in raw["programs"]):
        raise KeyError(program_id)
    validate_registry([ProgramEntry.model_validate(p) for p in rows])
    raw["programs"] = rows
    path.write_bytes((json.dumps(raw, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
