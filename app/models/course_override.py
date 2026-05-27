"""
User-supplied course overrides.

Override data fills gaps when official DB records are incomplete.
All data is marked as user-provided and never overwrites the official DB.
"""

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CourseOverride(BaseModel):
    model_config = ConfigDict(extra="ignore")

    user_notes: str = ""
    manual_weekly_hours: Optional[float] = None
    manual_conceptual_complexity_note: str = ""
    known_instructor_notes: str = ""
    expected_instructor: str = ""
    confidence_adjustment: float = Field(default=0.0, ge=-1.0, le=1.0)
    updated_at: str = ""

    def has_any_data(self) -> bool:
        """True if any meaningful override field is populated."""
        return bool(
            self.user_notes.strip()
            or self.manual_weekly_hours is not None
            or self.manual_conceptual_complexity_note.strip()
            or self.known_instructor_notes.strip()
            or self.expected_instructor.strip()
        )

    def extra_text(self) -> str:
        """Combined text from user notes and complexity note for keyword analysis."""
        return " ".join(
            p for p in [self.user_notes, self.manual_conceptual_complexity_note]
            if p and p.strip()
        )


def load_course_overrides(path: str | Path) -> dict[str, CourseOverride]:
    """
    Return {course_id -> CourseOverride} from a JSON file.

    Returns an empty dict if the file does not exist.
    Courses with missing or empty data still produce a CourseOverride with defaults.
    """
    p = Path(path)
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {
        cid: CourseOverride.model_validate(vals)
        for cid, vals in data.get("courses", {}).items()
    }


def save_course_overrides(
    overrides: dict[str, CourseOverride],
    path: str | Path,
) -> None:
    """Write overrides to a UTF-8 JSON file (creates parent dirs as needed)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "courses": {cid: ov.model_dump() for cid, ov in overrides.items()}
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
