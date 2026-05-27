import pytest
from pydantic import ValidationError
from app.models.course import CourseBase, CourseFull


def test_course_base_minimal():
    course = CourseBase(course_id="0368-3101", name_hebrew="תכנות מערכות")
    assert course.course_id == "0368-3101"
    assert course.name_english is None
    assert course.prerequisites == [] if hasattr(course, "prerequisites") else True


def test_course_base_requires_id():
    with pytest.raises(ValidationError):
        CourseBase(name_hebrew="חסר מזהה")


def test_course_full_defaults():
    course = CourseFull(course_id="0368-3101", name_hebrew="תכנות מערכות")
    assert course.prerequisites == []
    assert course.credit_points is None
    assert course.weekly_hours is None


def test_course_full_with_prerequisites():
    course = CourseFull(
        course_id="0368-3101",
        name_hebrew="תכנות מערכות",
        prerequisites=["0368-1101", "0368-1102"],
        credit_points=3.0,
        weekly_hours=4.0,
    )
    assert len(course.prerequisites) == 2
    assert course.credit_points == 3.0
