import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    profile_name: str
    completed_course_ids: list[str] = Field(default_factory=list)
    preferred_topics: list[str] = Field(default_factory=list)
    avoided_topics: list[str] = Field(default_factory=list)
    max_difficulty: Optional[float] = None
    max_weekly_hours: Optional[float] = None
    target_specialization: Optional[str] = None


def load_user_profile(path: str | Path) -> UserProfile:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Profile not found: {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    return UserProfile.model_validate(data)
