"""Shared IMS Drishot URL validation and cached-link inventory discovery."""
import re
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup


IMS_BASE = "https://ims.tau.ac.il/tal/kr/"


def _url_identity(url: str, course_id: str, year: int) -> tuple[str | None, str | None, bool]:
    group = semester = None
    try:
        parsed = urlsplit(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        groups = query.get("kv", [])
        terms = query.get("sem", [])
        group = groups[0] if len(groups) == 1 else None
        semester = terms[0] if len(terms) == 1 else None
        valid = (parsed.scheme == "https"
                 and parsed.hostname in {"ims.tau.ac.il", "www.ims.tau.ac.il"}
                 and parsed.port in {None, 443} and not parsed.username and not parsed.password
                 and not parsed.fragment and not re.search(r"[\x00-\x20]", url)
                 and parsed.path.lower() == "/tal/kr/drishot_l.aspx"
                 and set(query) == {"kurs", "kv", "sem"}
                 and query["kurs"] == [course_id.replace("-", "")]
                 and group is not None and re.fullmatch(r"[0-9]{2}", group) is not None
                 and semester is not None and re.fullmatch(rf"{year}[123]", semester) is not None)
        return group, semester, bool(valid)
    except (ValueError, TypeError):
        return group, semester, False


def discover_links(html: str, *, course_id: str, year: int, path: str) -> list[dict]:
    """Inventory direct and quoted popup links without evaluating JavaScript.

    Return every occurrence, including invalid URLs. Valid URLs are canonicalized
    to source_url with kurs/kv/sem query order. Each item contains course_id,
    group, semester, source_url, url_identity_verified, and discovered_from
    (path, attribute, raw_link). Callers may merge repeated source_url occurrences
    while retaining discovered_from. Distinct groups and terms stay distinct.
    """
    records = []
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(True):
        for attribute in ("href", "onclick"):
            raw = tag.get(attribute, "")
            if not isinstance(raw, str) or "drishot_l.aspx" not in raw.lower():
                continue
            if raw.lower().startswith("javascript:") or attribute == "onclick":
                candidates = re.findall(r'''['"]([^'"]*Drishot_L\.aspx[^'"]*)['"]''', raw, re.I)
                if not candidates:
                    candidates = [raw]
            else:
                candidates = [raw]
            for candidate in candidates:
                url = urljoin(IMS_BASE, candidate)
                group, semester, valid = _url_identity(url, course_id, year)
                if valid:
                    url = IMS_BASE + "Drishot_L.aspx?" + urlencode({
                        "kurs": course_id.replace("-", ""), "kv": group, "sem": semester,
                    })
                records.append({
                    "course_id": course_id, "group": group, "semester": semester,
                    "source_url": url, "url_identity_verified": valid,
                    "discovered_from": [{"path": path, "attribute": attribute, "raw_link": raw}],
                })
    return records
