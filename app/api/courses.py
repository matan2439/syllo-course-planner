from fastapi import APIRouter, HTTPException
from app.models.course import CourseBase, CourseFull

router = APIRouter()


@router.get("/", response_model=list[CourseBase])
def list_courses():
    """Return all stored courses. Not yet implemented."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{course_id}", response_model=CourseFull)
def get_course(course_id: str):
    """Return full details for a single course. Not yet implemented."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/fetch/{course_id}", response_model=CourseFull)
def fetch_and_store_course(course_id: str, semester: str):
    """Scrape, parse, and store a course by its TAU ID. Not yet implemented."""
    raise HTTPException(status_code=501, detail="Not implemented")
