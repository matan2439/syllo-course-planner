"""Pure, conservative parser for TAU IMS Drishot_L.aspx requirement tables.

Expressions are {course_id: "dddd-dddd"}, {all_of: [expressions]}, or
{any_of: [expressions]}. Explicit absence is {all_of: []}; unknown is None.
Nested IMS tables provide grouping. Mixed operators in one table have no
assumed precedence. Missing sections remain unknown, even on a valid page.

The result records course_id, source_url, semester (IMS YYYYS), identity_verified,
prerequisites, corequisites, status, and issues. Status is verified only when
both expressions are known. Identity verification compares the caller's course
and semester with the URL and the rendered course/academic-year headers. HTML
does not identify the specific semester within that academic year, so its term
provenance comes from the supplied URL. No fetching or file I/O occurs here.
"""
import re
from urllib.parse import parse_qs, urlsplit

from bs4 import BeautifulSoup, NavigableString, Tag


_COURSE = re.compile(r"[0-9]{4}-[0-9]{4}")
_HEADINGS = {
    "קורסי קדם נדרשים": "prerequisites",
    "קורסים מקבילים נדרשים": "corequisites",
}
_OPERATORS = {"וגם": "all_of", "או": "any_of"}
_NONE = {
    "prerequisites": "אין דרישות קדם",
    "corequisites": "אין דרישות מקבילות",
}
_MAX_HTML_LENGTH = 1_000_000
_MAX_DOM_NODES = 20_000
_MAX_DOM_DEPTH = 64


def validate_expression(expression: object, *, max_nodes: int = 256, max_depth: int = 16) -> bool:
    """Validate exact expression shapes iteratively, including cyclic inputs.

    Root depth is one. Empty any_of is invalid. Empty all_of is verified none.
    Every occurrence, including a shared subtree, consumes the node budget.
    """
    if not _valid_limits(max_nodes, max_depth):
        return False
    pending = [(expression, 1)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > max_nodes or depth > max_depth or type(node) is not dict or len(node) != 1:
            return False
        key, value = next(iter(node.items()))
        if key == "course_id":
            if not isinstance(value, str) or not _COURSE.fullmatch(value):
                return False
        elif key in ("all_of", "any_of"):
            if type(value) is not list or (key == "any_of" and not value):
                return False
            if count + len(pending) + len(value) > max_nodes:
                return False
            pending.extend((child, depth + 1) for child in value)
        else:
            return False
    return True


def _valid_limits(max_nodes: int, max_depth: int) -> bool:
    return (type(max_nodes) is int and 1 <= max_nodes <= 4096
            and type(max_depth) is int and 1 <= max_depth <= 32)


class _Unknown(ValueError):
    """The source cannot safely be represented by the expression schema."""


def _text(tag: Tag) -> str:
    return " ".join(tag.get_text(" ", strip=True).split())


def _children(tag: Tag, allowed: set[str]) -> list[Tag]:
    children = []
    for child in tag.children:
        if isinstance(child, Tag):
            if child.name not in allowed:
                raise _Unknown("Unsupported table structure")
            children.append(child)
        elif isinstance(child, NavigableString) and child.strip():
            raise _Unknown("Unexpected text outside table cells")
    return children


def _rows(table: Tag) -> list[Tag]:
    rows = []
    for child in _children(table, {"tr", "tbody", "thead", "tfoot"}):
        if child.name == "tr":
            rows.append(child)
        else:
            rows.extend(_children(child, {"tr"}))
    return rows


def _check_dom(soup: BeautifulSoup) -> None:
    pending = [(soup, 0)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > _MAX_DOM_NODES or depth > _MAX_DOM_DEPTH:
            raise _Unknown("HTML exceeds DOM limits")
        if isinstance(node, Tag):
            pending.extend((child, depth + 1) for child in node.children)


def _verify_identity(soup: BeautifulSoup, course_id: str, source_url: str, semester: str) -> None:
    if not isinstance(course_id, str) or not _COURSE.fullmatch(course_id):
        raise _Unknown("Expected a hyphenated course ID")
    if not isinstance(semester, str) or not re.fullmatch(r"[0-9]{4}[123]", semester):
        raise _Unknown("Invalid IMS semester")
    try:
        url = urlsplit(source_url)
        query = parse_qs(url.query, keep_blank_values=True)
        valid_url = (url.scheme == "https" and url.hostname in {"ims.tau.ac.il", "www.ims.tau.ac.il"}
                     and url.port in {None, 443} and not url.username and not url.password
                     and not url.fragment and url.path.lower() == "/tal/kr/drishot_l.aspx"
                     and query.get("kurs") == [course_id.replace("-", "")]
                     and query.get("sem") == [semester]
                     and len(query.get("kv", [])) == 1
                     and re.fullmatch(r"[0-9]{2}", query["kv"][0]))
    except (ValueError, TypeError, AttributeError):
        valid_url = False
    if not valid_url:
        raise _Unknown("Source URL does not identify the requested course and semester")
    headers = [tag for tag in soup.select("span.listtd") if _text(tag).startswith("קורס:")]
    if len(headers) != 1 or re.findall(r"\(([0-9]{4}-[0-9]{4})\)", _text(headers[0])) != [course_id]:
        raise _Unknown("Rendered course identity is missing or mismatched")
    years = [re.findall(r"\(([0-9]{4})/([0-9]{4})\)", _text(tag))
             for tag in soup.select("span.listtdbbld")]
    expected = (semester[:4], str(int(semester[:4]) + 1))
    if years != [[expected]]:
        raise _Unknown("Rendered academic year is missing or mismatched")


class _TableParser:
    def __init__(self, max_nodes: int, max_depth: int):
        self.remaining = max_nodes
        self.max_depth = max_depth

    def expression(self, rows: list[Tag], kind: str, depth: int = 1) -> dict:
        # Count table nesting as well as expression nodes to bound wrapper tables.
        self.remaining -= 1
        if self.remaining < 0 or depth > self.max_depth:
            raise _Unknown("Requirement expression exceeds node/depth limits")
        operands = []
        operators = []
        for row in rows:
            cells = _children(row, {"td"})
            if not cells:
                raise _Unknown("Empty requirement row")
            text = _text(row)
            if not text:
                if row.find("table"):
                    raise _Unknown("Empty nested group")
                continue
            if text in _OPERATORS:
                if len(cells) != 1 or len(operands) != len(operators) + 1:
                    raise _Unknown("Misplaced logical operator")
                operators.append(_OPERATORS[text])
                continue
            if len(operands) != len(operators):
                raise _Unknown("Missing logical operator")
            tables = row.find_all("table")
            if tables:
                direct_tables = [t for t in tables if t.find_parent("table") is row.find_parent("table")]
                if len(cells) != 1 or len(direct_tables) != 1:
                    raise _Unknown("Ambiguous nested grouping")
                nested = direct_tables[0]
                outside = [s for s in cells[0].strings if s.find_parent("table") is not nested
                           and nested not in s.parents and s.strip()]
                if outside:
                    raise _Unknown("Unrepresented text beside nested group")
                operand = self.expression(_rows(nested), kind, depth + 1)
            elif text == _NONE[kind] and len(cells) == 1 and len(rows) == 1:
                operand = {"all_of": []}
            elif len(cells) == 2 and _COURSE.fullmatch(_text(cells[0])) and _text(cells[1]):
                operand = {"course_id": _text(cells[0])}
            else:
                raise _Unknown("Unsupported requirement row or eligibility condition")
            operands.append(operand)
        if not operands or len(operators) != len(operands) - 1:
            raise _Unknown("Missing requirement or trailing operator")
        if len(set(operators)) > 1:
            raise _Unknown("Mixed operators without nested grouping")
        if not operators:
            return operands[0]
        return {operators[0]: operands}


def parse_ims_prerequisites(
    html: str, *, course_id: str, source_url: str, semester: str,
    max_nodes: int = 256, max_depth: int = 16,
) -> dict:
    """Parse a decoded IMS page, preserving logical grouping and provenance.

    Callers must decode the response using its declared charset (IMS uses UTF-8).
    Each expression has its own node/depth budget. Invalid identity or document
    structure invalidates both sections. A malformed section invalidates only
    that section. Issues explain every unknown result.
    """
    result = dict(course_id=course_id, source_url=source_url, semester=semester,
                  identity_verified=False, prerequisites=None, corequisites=None,
                  status="unknown", issues=[])
    try:
        if not _valid_limits(max_nodes, max_depth):
            raise _Unknown("Invalid parser limits")
        if not isinstance(html, str) or len(html) > _MAX_HTML_LENGTH:
            raise _Unknown("Expected decoded HTML within size limit")
        soup = BeautifulSoup(html, "html.parser")
        _check_dom(soup)
        _verify_identity(soup, course_id, source_url, semester)
        result["identity_verified"] = True
        tables = soup.select("table.tableblds")
        if len(tables) != 1:
            raise _Unknown("Expected one IMS requirements table")
        sections = {}
        current = None
        for row in _rows(tables[0]):
            cells = _children(row, {"td", "th"})
            if len(cells) == 1 and cells[0].name == "th":
                current = _HEADINGS.get(_text(cells[0]))
                if current is None or current in sections:
                    raise _Unknown("Unknown or duplicate requirement heading")
                sections[current] = []
            elif _text(row) or row.find("table") is not None:
                if current is None:
                    raise _Unknown("Requirement before section heading")
                sections[current].append(row)
        for kind in ("prerequisites", "corequisites"):
            try:
                if kind not in sections:
                    raise _Unknown("Missing section; absence is unverified")
                expression = _TableParser(max_nodes, max_depth).expression(sections[kind], kind)
                if not validate_expression(expression, max_nodes=max_nodes, max_depth=max_depth):
                    raise _Unknown("Invalid or oversized expression")
                result[kind] = expression
            except _Unknown as exc:
                result["issues"].append(f"{kind}: {exc}")
        if result["prerequisites"] is not None and result["corequisites"] is not None:
            result["status"] = "verified"
    except _Unknown as exc:
        result["prerequisites"] = result["corequisites"] = None
        result["issues"].append(str(exc))
    return result
