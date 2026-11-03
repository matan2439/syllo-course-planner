"""Single degree registry, shared with TypeScript (shared/programs.ts)."""
import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

CONFIG_DIR = Path(__file__).resolve().parents[2] / "data" / "config"
DEFAULT_PATH = CONFIG_DIR / "programs.json"
INSTITUTIONS_PATH = CONFIG_DIR / "institutions.json"


class ProgramEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    institution: str
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
    is_family_default: bool = Field(alias="isFamilyDefault")
    capabilities: list[str]
    catalog_year_policy: Optional[Literal["start_year", "may_opt_newer", "always_latest"]] = Field(
        default=None, alias="catalogYearPolicy"
    )


def load_registry(path: Path = DEFAULT_PATH) -> list[ProgramEntry]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [ProgramEntry.model_validate(p) for p in raw["programs"]]


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
