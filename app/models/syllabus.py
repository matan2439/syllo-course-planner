from typing import Optional
from pydantic import BaseModel, Field


class SyllabusData(BaseModel):
    course_id: str                    # e.g. "0368-2157"
    name_he: Optional[str] = None
    name_en: Optional[str] = None
    credits: Optional[float] = None
    lecture_hours: Optional[float] = None
    tutorial_hours: Optional[float] = None
    lab_hours: Optional[float] = None
    prerequisites_raw_text: Optional[str] = None
    prerequisite_course_ids: list[str] = Field(default_factory=list)
    course_description: Optional[str] = None
    topics: list[str] = Field(default_factory=list)
    assignments: Optional[str] = None
    exam_info: Optional[str] = None
    raw_text_excerpt: Optional[str] = None
    source_file: Optional[str] = None
