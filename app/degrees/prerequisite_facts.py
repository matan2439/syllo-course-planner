"""Re-validate captured IMS requirements before emitting planner facts.

Stored consensus/parsed JSON is a report, not authority: parse its source HTML
again and require agreement across every captured group and term.
"""
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from app.degrees.prerequisites import parse_ims_prerequisites, validate_expression
from app.degrees.prerequisite_sources import discover_links


def load_prerequisite_facts(path: Path, *, program_id: str, source_year: int, root: Path) -> dict | None:
    if not path.exists():
        return None
    if path.stat().st_size > 50_000_000:
        raise ValueError("Prerequisite snapshot exceeds the supported size")
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    if (snapshot.get("schema_version") != 1 or snapshot.get("program_id") != program_id
            or snapshot.get("source_year") != source_year or not isinstance(snapshot.get("courses"), dict)):
        raise ValueError("Prerequisite snapshot identity does not match this program/year")
    facts = {}
    for cid, course in snapshot["courses"].items():
        if not isinstance(course, dict) or course.get("course_id") != cid:
            raise ValueError("Malformed prerequisite course identity")
        discovered = set()
        details = course.get("course_details", [])
        for detail in details:
            relative = Path(detail["path"])
            target = (root / relative).resolve()
            if not target.is_relative_to((root / "data/raw_html/course_details").resolve()):
                raise ValueError("Prerequisite course-detail path is outside the source cache")
            cached = target.read_bytes() if target.exists() else None
            captured = detail.get("html")
            original = cached if cached is not None else captured.encode("utf-8") if isinstance(captured, str) else None
            if original is None or hashlib.sha256(original).hexdigest() != detail.get("sha256"):
                raise ValueError(f"Prerequisite links changed for {cid}; collect requirements again")
            discovered.update(record["source_url"] for record in discover_links(
                original.decode("utf-8"), course_id=cid, year=source_year, path=relative.as_posix()))
        expressions = {"prerequisites": [], "corequisites": []}
        provenance = []
        records = course.get("records", [])
        if not isinstance(records, list) or len(records) > 1000:
            raise ValueError("Malformed prerequisite evidence records")
        if {r.get("source_url") for r in records} != discovered:
            raise ValueError(f"Prerequisite group inventory changed for {cid}; collect requirements again")
        for record in records:
            response = record.get("response") or {}
            html = response.get("html")
            source = record.get("source_url", "")
            semester = record.get("semester", "")
            valid = isinstance(html, str) and len(html.encode("utf-8")) <= 1_000_000
            valid = valid and hashlib.sha256(html.encode("utf-8")).hexdigest() == response.get("sha256")
            valid = valid and response.get("source_url") == source and bool(response.get("fetched_at"))
            final = response.get("final_url", "")
            # A redirect to another group/term cannot borrow the requested identity.
            valid = valid and urlsplit(source)._replace(fragment="") == urlsplit(final)._replace(fragment="")
            query = parse_qs(urlsplit(source).query)
            valid = valid and query.get("kv") == [record.get("group")] and str(semester).startswith(str(source_year))
            parsed = parse_ims_prerequisites(html, course_id=cid, source_url=source, semester=semester) if valid else {}
            for kind in expressions:
                value = parsed.get(kind)
                expressions[kind].append(value if parsed.get("identity_verified") and validate_expression(value) else None)
            provenance.append({"source_url": source, "semester": semester, "group": record.get("group"),
                               "fetched_at": response.get("fetched_at"), "sha256": response.get("sha256"),
                               "identity_verified": parsed.get("identity_verified") is True})
            if response.get("last_refresh_failed_at"):
                provenance[-1]["last_refresh_failed_at"] = response["last_refresh_failed_at"]
        facts[cid] = {"provenance": provenance}
        for kind, values in expressions.items():
            facts[cid][kind] = values[0] if values and values[0] is not None and all(v == values[0] for v in values) else None
    return facts


def apply_prerequisite_facts(board: dict, facts: dict | None) -> None:
    if facts is None:
        return
    courses = [c for semester in board.get("semesters", []) for c in semester.get("courses", [])]
    courses.extend(board.get("metadata", {}).get("program_repository_courses", []))
    for course in courses:
        fact = facts.get(course.get("course_id"), {})
        course["prerequisite_expression"] = fact.get("prerequisites")
        course["corequisite_expression"] = fact.get("corequisites")
        course["requirements_provenance"] = fact.get("provenance", [])
