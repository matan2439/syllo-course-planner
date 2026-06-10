from pathlib import Path

from app.parsing.syllabus_parser import parse_syllabus
from app.parsing.syllabus_summary import build_syllabus_summary

FIXTURE = Path(__file__).resolve().parents[1] / "data" / "raw_html" / "syllabus" / "syllabus_05423792.html"


def _load_syllabus():
    html = FIXTURE.read_text(encoding="utf-8")
    syllabus = parse_syllabus(html, source_file=FIXTURE.name)
    assert syllabus is not None
    return syllabus


def test_syllabus_summary_for_0542_3792():
    syllabus = _load_syllabus()
    summary = build_syllabus_summary(
        syllabus,
        source_url="https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379205&year=2025",
        fetched_at="2026-06-10T00:00:00+00:00",
    )

    assert summary["syllabus_text_available"] is True

    prereqs = " ".join(summary["syllabus_prerequisites_he"])
    assert "מבוא להסתברות וסטטיסטיקה" in prereqs
    assert "מכניקת המוצקים (1)" in prereqs

    combined = " ".join([
        summary["syllabus_summary_he"] or "",
        " ".join(summary["syllabus_topics_he"]),
        summary["syllabus_assessment_he"] or "",
        summary["syllabus_structure_he"] or "",
    ])
    assert "מעבד" in combined  # labs
    assert "מדיד" in combined  # measurements
    assert "דוח" in combined or "דו\"ח" in combined  # reports

    assert summary["syllabus_source_url"].startswith("https://ims.tau.ac.il")
    assert summary["syllabus_confidence"] > 0


def test_build_syllabus_summary_handles_missing_syllabus():
    summary = build_syllabus_summary(None, source_url="https://example.com/syllabus")
    assert summary["syllabus_text_available"] is False
    assert summary["syllabus_topics_he"] == []
    assert summary["syllabus_prerequisites_he"] == []
    assert summary["syllabus_confidence"] == 0.0
