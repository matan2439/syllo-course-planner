"""
Parser for the prerequisite block of TAU's official syllabus page
(ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx). Pure parsing — no network I/O.

The registrar renders prerequisites as a chain of courses joined by "+" (AND)
and "או" (OR), optionally followed by a "קורסים מקבילים" (corequisites) chain:

    קורסי קדם נדרשים  A (05422200) או B (05424224)
    קורסי קדם נדרשים  A (..) או A' (..)  +  B (..) או B' (..)

When a "+" sits BETWEEN the course spans it separates explicit groups, so the
second line is (A or A') and (B or B'). When both operators appear inside one
group the page does not say which binds tighter; we read OR as the tighter one
(alternatives of one requirement, the pattern every explicit case follows) and
flag the result `needs_review` so a person confirms it.

A page with no prerequisite block is the registrar listing none: `verified_none`.
A page that is not a real syllabus page is `unknown` — never "none".
"""
from __future__ import annotations

import html as _html
import re
from typing import Any, Optional

PARSER_VERSION = "1"

PREREQ_LABEL = "קורסי קדם נדרשים"
COREQ_LABEL = "קורסים מקבילים"

_SPAN = re.compile(r"<span>(.*?)</span>", re.S)
_ID = re.compile(r"\((\d{8})\)")
_TAG = re.compile(r"<[^>]+>")
_OP_IN_SPAN = re.compile(r"<strong><small>\s*(\+|או)\s*</small></strong>\s*</small>\s*$")
_OUTER_OP = re.compile(r"<strong><small>\s*(\+|או)\s*</small></strong>")


def format_course_id(digits: str) -> str:
    """'05422200' → '0542-2200'."""
    return f"{digits[:4]}-{digits[4:]}"


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(_TAG.sub(" ", fragment))).strip()


def _all(items: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    return None if not items else items[0] if len(items) == 1 else {"all": items}


def _any(items: list[dict[str, Any]]) -> dict[str, Any]:
    return items[0] if len(items) == 1 else {"any": items}


def _parse_chain(fragment: str) -> tuple[Optional[dict[str, Any]], dict[str, str], bool]:
    """A course chain → (expression, names by course id, needs_review)."""
    # Tokens: ('course', id, name, op_after_inside_span) and ('op', symbol) between spans.
    tokens: list[tuple] = []
    position = 0
    for match in _SPAN.finditer(fragment):
        for outer in _OUTER_OP.finditer(fragment[position:match.start()]):
            tokens.append(("op", outer.group(1)))
        body = match.group(1)
        course = _ID.search(body)
        if course:
            inside = _OP_IN_SPAN.search(body)
            name = _text(body[: course.start()])
            tokens.append(("course", format_course_id(course.group(1)), name, inside.group(1) if inside else None))
        position = match.end()
    for outer in _OUTER_OP.finditer(fragment[position:]):
        tokens.append(("op", outer.group(1)))

    names: dict[str, str] = {}
    # Outer operators split explicit groups; inside a group each course carries the operator after it.
    groups: list[tuple[list[tuple[str, Optional[str]]], Optional[str]]] = []
    current: list[tuple[str, Optional[str]]] = []
    for token in tokens:
        if token[0] == "course":
            names[token[1]] = token[2]
            current.append((token[1], token[3]))
        elif current:
            groups.append((current, token[1]))
            current = []
    if current:
        groups.append((current, None))
    if not groups:
        return None, names, False

    needs_review = False

    def group_expression(courses: list[tuple[str, Optional[str]]]) -> dict[str, Any]:
        nonlocal needs_review
        operators = {op for _, op in courses[:-1] if op}
        if len(operators) > 1:
            needs_review = True  # "+" and "או" in one group: precedence not stated
        # OR binds tighter: split on "+", each part is a set of alternatives.
        parts: list[list[dict[str, Any]]] = [[]]
        for course_id, op in courses:
            parts[-1].append({"course": course_id})
            if op == "+":
                parts.append([])
        return _all([_any(part) for part in parts if part])  # type: ignore[return-value]

    # Between explicit groups: split on "+", alternatives within.
    outer_ops = {op for _, op in groups[:-1] if op}
    if len(outer_ops) > 1:
        needs_review = True
    conjuncts: list[list[dict[str, Any]]] = [[]]
    for courses, op in groups:
        conjuncts[-1].append(group_expression(courses))
        if op == "+":
            conjuncts.append([])
    return _all([_any(part) for part in conjuncts if part]), names, needs_review


def parse_syllabus_prerequisites(page_html: str) -> dict[str, Any]:
    """
    Returns {status, expression, corequisites, course_names, raw_text, needs_review}.
    status: 'verified' | 'verified_none' | 'unknown'.
    """
    result: dict[str, Any] = {
        "status": "unknown", "expression": None, "corequisites": None,
        "course_names": {}, "raw_text": None, "needs_review": False,
    }
    # A real syllabus page always carries the course-contents or course-details sections.
    if "main-course-contents" not in page_html and "main-course-requirements" not in page_html:
        return result

    start = page_html.find(PREREQ_LABEL)
    coreq_only = page_html.find(COREQ_LABEL)
    if start < 0 and coreq_only < 0:
        result["status"] = "verified_none"
        return result

    begin = start if start >= 0 else coreq_only
    end = page_html.find('<p class="disclaimer"', begin)
    block = page_html[begin: end if end >= 0 else begin + 6000]
    coreq_at = block.find(COREQ_LABEL)
    prereq_part = block[: coreq_at] if coreq_at >= 0 else block
    coreq_part = block[coreq_at:] if coreq_at >= 0 else ""
    if start < 0:
        prereq_part = ""

    expression, names, review = _parse_chain(prereq_part)
    corequisites, coreq_names, coreq_review = _parse_chain(coreq_part)
    result.update({
        "expression": expression,
        "corequisites": corequisites,
        "course_names": {**names, **coreq_names},
        "raw_text": _text(block),
        "needs_review": review or coreq_review,
    })
    if expression is None and corequisites is None:
        # A labelled block we could not read is not "none".
        result["status"] = "unknown"
        result["needs_review"] = True
    else:
        result["status"] = "verified" if expression is not None else "verified_none"
    return result
