from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CourseBase(BaseModel):
    course_id: str = Field(..., description="TAU course identifier, e.g. '0368-3101'")
    name_hebrew: str
    name_english: Optional[str] = None
    faculty: Optional[str] = None
    semester: Optional[str] = None


class GroupInfo(BaseModel):
    """Schedule details for one group (קבוצה) of a course."""
    group_num: str
    teachers: list[str] = Field(default_factory=list)
    teaching_method: Optional[str] = None  # שיעור / תרגיל / הדרכה אישית
    semester: Optional[str] = None         # "א'" or "ב'"
    building: Optional[str] = None
    room: Optional[str] = None
    day: Optional[str] = None
    time_slot: Optional[str] = None
    syllabus_url: Optional[str] = None
    moodle_url: Optional[str] = None


class CourseSearchResult(CourseBase):
    """Parsed result from a TAU course search page (search_l.aspx)."""
    year: int
    department: Optional[str] = None       # last segment of faculty path
    groups: list[GroupInfo] = Field(default_factory=list)
    semesters: list[str] = Field(default_factory=list)  # deduplicated, ordered


class CourseFull(CourseBase):
    credit_points: Optional[float] = None
    weekly_hours: Optional[float] = None
    prerequisites: list[str] = Field(default_factory=list)
    description: Optional[str] = None
    syllabus_url: Optional[str] = None


class CourseInDB(CourseFull):
    model_config = ConfigDict(from_attributes=True)

    id: int
