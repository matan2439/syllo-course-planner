"""TAU evidence adapters: tochniot program tree, official timetable, IMS course pages."""
import ast
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.degrees.evidence import EvidenceItem, strip_html, text_id
from app.degrees.registry import ProgramEntry
from app.scraping.tau_program_scraper import fetch_program_data, fetch_schedule_data

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw_html"
GRAPHQL_URL = "https://tochniot.tau.ac.il/graphql"
SCHEDULE_URL = "https://www.tau.ac.il/study-program?safa=1&shana={shana}&tab=schedule&tcid={tcid}"

BODY_TEXT_FIELDS = ("teurtochnit", "teurtoar", "teurshaot", "disclaimerletoar")
KURS_DATA_FIELDS = ("mishkal", "shaotuni", "drishotkedem", "drishotmakbilot", "shiyuch", "misgeret")


def _refresh():
    scripts = str(ROOT / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import refresh_course_data

    return refresh_course_data


def _read_ims(course_id: str, year: int, offline: bool, live: bool) -> dict:
    return _refresh().read_ims(course_id, year, offline, live)


def _ims_cache_path(course_id: str, year: int) -> Path:
    r = _refresh()
    return r.IMS_CACHE / f"course_{r.digits(course_id)}_{year}.html"


def _mtime(path: Path) -> datetime | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None


def _provenance(cache: Path, live: bool) -> tuple[bool, datetime]:
    """(from_cache, fetched_at), decided before any fetch runs."""
    mtime = None if live else _mtime(cache)
    return (True, mtime) if mtime else (False, datetime.now(timezone.utc))


def _parse(value):
    """json first, then python-repr (ast.literal_eval); non-strings pass through."""
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        pass
    try:
        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return None


def _bodies(raw) -> list[dict]:
    """Program bodies from a fetcher result (a body list, or a whole wrapped payload)."""
    raw = _parse(raw)
    if isinstance(raw, dict):
        raw = _parse(raw.get("data", raw))
        raw = raw.get("results", raw) if isinstance(raw, dict) else raw
        raw = _parse(raw.get("body", raw)) if isinstance(raw, dict) else raw
    return [b for b in (raw or []) if isinstance(b, dict)]


def _children(node: dict, key: str) -> list[dict]:
    return [c for c in (_parse(node.get(key)) or []) if isinstance(c, dict)]


def tochniot_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    tcid, shana = program.source_ids["tcid"], str(program.source_year)
    cache = RAW_DIR / f"tau_program_{tcid}_{shana}.json"
    if offline and not live and not cache.exists():
        return []
    from_cache, fetched_at = _provenance(cache, live)
    bodies = _bodies(fetch_program_data(tcid, shana, cache_path=cache, force_refresh=live))
    dashed = _refresh().dashed
    T = f"tau:{tcid}:{shana}"
    items: list[EvidenceItem] = []

    def add(id_, kind, path, raw_text, **kw):
        items.append(EvidenceItem(id=id_, source_url=GRAPHQL_URL, fetched_at=fetched_at, from_cache=from_cache,
                                  kind=kind, path=list(path), raw_text=raw_text, **kw))

    def walk(node: dict, path: list[str]) -> None:
        for r in _children(node, "rama"):
            rid = str(r.get("ramaid"))
            title = (r.get("teurrama") or "").strip()
            rpath = path + [title]
            shaot = (r.get("shaot") or "").strip()
            add(f"{T}:rama:{rid}", "section", rpath, " ".join(p for p in (title, shaot) if p),
                data={k: r.get(k) for k in ("shaot", "mishkal") if r.get(k)})
            hesber = r.get("hesber") or ""
            if strip_html(hesber):
                add(f"{T}:rama:{rid}:hesber:{text_id(hesber)}", "rule_text", rpath, hesber)
            for k in _children(r, "kurs"):
                show = k.get("kursshow") or k.get("kursid") or ""
                add(f"{T}:rama:{rid}:kurs:{show}", "course_listing", rpath, (k.get("teurkurs") or "").strip(),
                    course_id=dashed(show), cancelled=(k.get("mevutal") or "0") == "1",
                    data={f: k.get(f) for f in KURS_DATA_FIELDS})
            walk(r, rpath)

    for b in bodies:
        for field in BODY_TEXT_FIELDS:
            if strip_html(b.get(field) or ""):
                add(f"{T}:body:{field}", "program_text", [], b[field])
        nosaf = b.get("hesbernosaf") or ""
        if strip_html(nosaf):
            add(f"{T}:body:hesbernosaf:{text_id(nosaf)}", "rule_text", [], nosaf)
        for key in ("terms", "prev_newsletters"):
            for entry in _parse(b.get(key)) or []:
                if isinstance(entry, dict):
                    title = entry.get("Title") or entry.get("shana") or ""
                    add(f"{T}:body:terms:{text_id(title)}", "policy_text", [], title, data=dict(entry))
        walk(b, [])
    return items


def timetable_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    tcid, shana = program.source_ids["tcid"], str(program.source_year)
    cache = RAW_DIR / f"tau_schedule_{tcid}_{shana}.json"
    if offline and not live and not cache.exists():
        return []
    from_cache, fetched_at = _provenance(cache, live)
    bodies = _bodies(fetch_schedule_data(tcid, shana, cache_path=cache, force_refresh=live))
    r = _refresh()
    T = f"tau:{tcid}:{shana}"
    found: dict[str, dict] = {}

    def walk(node: dict, path: list[str]) -> None:
        for child in _children(node, "rama"):
            cpath = path + [(child.get("teurrama") or "").strip()]
            for k in _children(child, "kurs"):
                cid = r.dashed(k.get("kursshow") or k.get("kursid") or "")
                rec = found.setdefault(cid, {"name": (k.get("teurkurs") or "").strip(), "path": cpath, "sems": set()})
                rec["sems"] |= set(r.timetable_semesters({"kvutza": _children(k, "kvutza")}))
            walk(child, cpath)

    for b in bodies:
        walk(b, [])
    url = SCHEDULE_URL.format(shana=shana, tcid=tcid)
    return [
        EvidenceItem(id=f"{T}:timetable:{cid}", source_url=url, fetched_at=fetched_at, from_cache=from_cache,
                     kind="course_fact", path=rec["path"], raw_text=rec["name"], course_id=cid,
                     data={"semesters": sorted(rec["sems"])})
        for cid, rec in found.items()
    ]


def ims_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]:
    shana = program.source_year
    # course list comes from the tochniot pass; it is cached by now, so never re-download it here
    course_ids = sorted({i.course_id for i in tochniot_evidence(program, False, offline) if i.course_id})
    items = []
    for cid in course_ids:
        from_cache, fetched_at = _provenance(_ims_cache_path(cid, shana), live)
        ims = _read_ims(cid, shana, offline, live)
        items.append(EvidenceItem(
            id=f"tau:ims:{shana}:{cid}", source_url=ims.get("url", ""), fetched_at=fetched_at,
            from_cache=from_cache, kind="course_fact", path=[], raw_text=ims.get("name_he") or "",
            course_id=cid, data=ims))
    return items
