"""Collect IMS Drishot evidence for one registered TAU program and its boards.

Default execution is a dry run using cached evidence only. --write saves the
report; --live explicitly enables fetching missing responses from official IMS.
The report embeds decoded response HTML and its UTF-8 SHA-256 for offline reuse.
No course-detail pages are fetched and no separate HTML cache is written.

Every discovered course/group/term is retained, including invalid links and
failed fetches. Consensus compares each section across every discovered record
using exact structural equality, without simplifying or flattening expressions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile

import requests


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.degrees.prerequisites import parse_ims_prerequisites, validate_expression
from app.degrees.prerequisite_sources import _url_identity, discover_links
from app.degrees.registry import ProgramEntry, validate_registry


DEFAULT_PROGRAM = "electrical_engineering_2027"
MAX_RESPONSE_BYTES = 1_000_000


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _course_ids(document: object) -> set[str]:
    courses = set()
    pending = [document]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            pending.extend(value.keys())
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{4}", value):
            courses.add(value)
    return courses


def _program_inputs(root: Path, program_id: str) -> tuple[ProgramEntry, dict[str, bytes], list[str]]:
    registry_path = "data/config/programs.json"
    inputs = {registry_path: (root / registry_path).read_bytes()}
    raw = json.loads(inputs[registry_path])
    entries = validate_registry([ProgramEntry.model_validate(row) for row in raw["programs"]])
    entry = next((row for row in entries if row.id == program_id), None)
    if entry is None:
        raise ValueError(f"Unknown registered program: {program_id}")
    if entry.institution != "tau":
        raise ValueError("IMS collection requires a TAU program")
    if not re.fullmatch(r"[a-z0-9_]+", entry.base):
        raise ValueError("Invalid program base path")
    paths = [f"data/degrees/{entry.institution}/{entry.base}/{entry.year}/spec.json",
             f"data/boards/{entry.id}.json",
             f"data/boards/{entry.base}_years_1_2_{entry.year}.json"]
    missing = []
    for index, path in enumerate(paths):
        if (root / path).exists():
            inputs[path] = (root / path).read_bytes()
        elif index == 0:
            raise ValueError(f"Missing program spec: {path}")
        else:
            missing.append(path)
    spec = json.loads(inputs[paths[0]])
    if spec.get("source_year", entry.source_year) != entry.source_year:
        raise ValueError("Spec source_year differs from registry")
    return entry, inputs, missing


def program_course_ids(root: Path, program: str = DEFAULT_PROGRAM) -> set[str]:
    """Union of structured IDs from a registered program, including counterparts."""
    _, inputs, _ = _program_inputs(root, program)
    return set().union(*(_course_ids(json.loads(raw)) for path, raw in inputs.items()
                        if path != "data/config/programs.json"))


def _catalog_course_ids(inputs: dict[str, bytes]) -> set[str]:
    catalog = set()
    for path, raw in inputs.items():
        doc = json.loads(raw)
        if path.endswith("/spec.json"):
            catalog.update(_course_ids([doc.get("mandatory_courses", []), doc.get("categories", []),
                                        doc.get("general_requirement", {})]))
        elif path.startswith("data/boards/"):
            rows = [row for semester in doc.get("semesters", []) for row in semester.get("courses", [])]
            rows.extend(doc.get("metadata", {}).get("program_repository_courses", []))
            catalog.update(_course_ids([row.get("course_id") for row in rows]))
    return catalog


def requirement_consensus(records: list[dict]) -> dict:
    result = {"prerequisites": None, "corequisites": None, "status": "unknown", "issues": []}
    for kind in ("prerequisites", "corequisites"):
        expressions = []
        for record in records:
            parsed = record["parsed"]
            expression = parsed.get(kind)
            if (not record["url_identity_verified"] or not parsed.get("identity_verified")
                    or not validate_expression(expression)):
                break
            expressions.append(expression)
        if not records or len(expressions) != len(records):
            result["issues"].append(f"{kind}: missing or unknown evidence in at least one group/term")
        elif any(expression != expressions[0] for expression in expressions[1:]):
            result["issues"].append(f"{kind}: conflicting expressions across groups/terms")
        else:
            result[kind] = expressions[0]
    if result["prerequisites"] is not None and result["corequisites"] is not None:
        result["status"] = "verified"
    return result


def _cached_response(record: dict, cache: dict, year: int) -> dict | None:
    previous = cache.get("courses", {}).get(record["course_id"], {}).get("records", [])
    for item in previous:
        response = item.get("response")
        if item.get("source_url") != record["source_url"] or not isinstance(response, dict):
            continue
        html = response.get("html")
        if (not isinstance(html, str) or len(html.encode("utf-8")) > MAX_RESPONSE_BYTES
                or _sha256(html) != response.get("sha256") or not response.get("fetched_at")
                or response.get("source_url") != record["source_url"]):
            continue
        group, semester, valid = _url_identity(response.get("final_url", ""), record["course_id"], year)
        if valid and group == record["group"] and semester == record["semester"]:
            return response
    return None


def _fetch_response(record: dict, *, get, timeout: float, year: int) -> dict:
    reply = get(record["source_url"], timeout=timeout, allow_redirects=False, stream=True)
    try:
        if reply.status_code != 200:
            raise requests.HTTPError(f"Expected HTTP 200, received {reply.status_code}")
        group, semester, valid = _url_identity(reply.url, record["course_id"], year)
        if not valid or group != record["group"] or semester != record["semester"]:
            raise ValueError("Response URL does not match requested course/group/term")
        mime = reply.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if mime not in {"text/html", "application/xhtml+xml"}:
            raise ValueError("Expected an HTML response")
        chunks = []
        size = 0
        for chunk in reply.iter_content(chunk_size=65536):
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise ValueError("Response exceeds size limit")
            chunks.append(chunk)
        encoding = requests.utils.get_encoding_from_headers(reply.headers) or "utf-8"
        html = b"".join(chunks).decode(encoding)
        return {"source_url": record["source_url"], "final_url": reply.url,
                "fetched_at": datetime.now(timezone.utc).isoformat(), "encoding": encoding,
                "sha256": _sha256(html), "html": html}
    finally:
        reply.close()


def _collect_record(record: dict, *, cache: dict, live: bool, get, timeout: float, retries: int, year: int, refresh: bool = False) -> dict:
    record = {**record, "retrieval_status": "unavailable", "attempts": 0, "response": None, "issues": []}
    record["parsed"] = {
        "course_id": record["course_id"], "semester": record["semester"],
        "source_url": record["source_url"], "identity_verified": False,
        "prerequisites": None, "corequisites": None, "status": "unknown", "issues": [],
    }
    if not record["url_identity_verified"]:
        record["retrieval_status"] = "invalid_url"
        record["issues"].append("Rejected source URL identity")
        return record
    previous = _cached_response(record, cache, year)
    needs_fetch = live and (refresh or previous is None or previous.get("last_refresh_failed_at"))
    response = None if needs_fetch else previous
    if response is not None:
        record["retrieval_status"] = "stale_cache" if response.get("last_refresh_failed_at") else "cache"
    if needs_fetch:
        for attempt in range(retries + 1):
            record["attempts"] = attempt + 1
            try:
                response = _fetch_response(record, get=get, timeout=timeout, year=year)
                record["retrieval_status"] = "fetched"
                break
            except (requests.RequestException, ValueError, LookupError) as exc:
                record["issues"].append(f"Attempt {attempt + 1}: {type(exc).__name__}: {exc}")
        if response is None and previous is not None:
            response = {**previous, "last_refresh_failed_at": datetime.now(timezone.utc).isoformat(),
                        "last_refresh_error": record["issues"][-1][:500]}
            record["retrieval_status"] = "stale_cache"
    if response is None:
        record["issues"].append("No cached or fetched response")
        return record
    record["response"] = response
    record["parsed"] = parse_ims_prerequisites(
        response["html"], course_id=record["course_id"], source_url=record["source_url"], semester=record["semester"],
    )
    return record


def collect(
    root: Path, *, live: bool = False, cache: dict | None = None,
    workers: int = 4, timeout: float = 30, retries: int = 1, program: str = DEFAULT_PROGRAM, refresh: bool = False, get=None,
) -> dict:
    """Discover cached links and collect every record, with at most four workers."""
    if refresh and not live:
        raise ValueError("Refreshing captured requirements requires --live")
    if (type(workers) is not int or not 1 <= workers <= 4
            or type(retries) is not int or retries not in (0, 1)
            or type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 30):
        raise ValueError("Use 1-4 workers, timeout up to 30 seconds, and 0-1 retries")
    root = Path(root)
    entry, input_bytes, missing_inputs = _program_inputs(root, program)
    year = entry.source_year
    ids = set().union(*(_course_ids(json.loads(raw)) for path, raw in input_bytes.items()
                        if path != "data/config/programs.json"))
    catalog = _catalog_course_ids(input_bytes)
    courses = {cid: {"course_id": cid, "course_role": "program_course" if cid in catalog else "external_required_source",
                     "details_status": "missing", "course_details": [], "records": []}
               for cid in sorted(ids)}
    discovered = {}
    pattern = re.compile(rf"course_([0-9]{{8}})_{year}(?:_[a-z]+)?\.html", re.I)
    for path in sorted((root / "data/raw_html/course_details").rglob("*.html")):
        match = pattern.fullmatch(path.name)
        if not match:
            continue
        digits = match[1]
        course_id = digits[:4] + "-" + digits[4:]
        if course_id not in ids:
            continue
        raw_html = path.read_bytes()
        html = raw_html.decode("utf-8-sig")
        relative = path.relative_to(root).as_posix()
        courses[course_id]["course_details"].append({"path": relative, "sha256": hashlib.sha256(raw_html).hexdigest(),
                                                   "html": raw_html.decode("utf-8")})
        courses[course_id]["details_status"] = "cached"
        for record in discover_links(html, course_id=course_id, year=year, path=relative):
            key = (course_id, record["source_url"])
            if key in discovered:
                discovered[key]["discovered_from"].extend(record["discovered_from"])
            else:
                discovered[key] = record
    def process(record):
        return _collect_record(record, cache=cache or {}, live=live, get=get or requests.get,
                               timeout=timeout, retries=retries, year=year, refresh=refresh)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        records = list(executor.map(process, sorted(discovered.values(), key=lambda r: (r["course_id"], r["source_url"]))))
    for record in records:
        courses[record["course_id"]]["records"].append(record)
    for course in courses.values():
        if course["details_status"] == "cached" and not course["records"]:
            course["details_status"] = "no_drishot_links"
        course["consensus"] = requirement_consensus(course["records"])
        course["unavailable_external_required_source"] = (
            course["course_role"] == "external_required_source"
            and (not course["records"] or any(r["response"] is None for r in course["records"]))
        )
    summary = {
        "course_count": len(courses), "discovered_records": len(records),
        "missing_course_details": sum(c["details_status"] == "missing" for c in courses.values()),
        "no_drishot_links": sum(c["details_status"] == "no_drishot_links" for c in courses.values()),
        "fetched_records": sum(r["retrieval_status"] == "fetched" for r in records),
        "cached_records": sum(r["retrieval_status"] == "cache" for r in records),
        "stale_records": sum(bool((r["response"] or {}).get("last_refresh_failed_at")) for r in records),
        "invalid_url_records": sum(not r["url_identity_verified"] for r in records),
        "unavailable_records": sum(r["retrieval_status"] == "unavailable" for r in records),
        "verified_records": sum(r["parsed"]["status"] == "verified" for r in records),
        "verified_prerequisite_consensus": sum(c["consensus"]["prerequisites"] is not None for c in courses.values()),
        "verified_corequisite_consensus": sum(c["consensus"]["corequisites"] is not None for c in courses.values()),
        "external_required_courses": sum(c["course_role"] == "external_required_source" for c in courses.values()),
        "unavailable_external_required_sources": sum(c["unavailable_external_required_source"] for c in courses.values()),
    }
    input_files = [{"path": path, "sha256": hashlib.sha256(raw).hexdigest()} for path, raw in input_bytes.items()]
    snapshot = {"program_id": program, "input_files": input_files, "missing_inputs": missing_inputs,
                "details": [course["course_details"] for course in courses.values()],
                "responses": [{"source_url": r["source_url"], "sha256": (r["response"] or {}).get("sha256")}
                              for r in records]}
    report_id = f"tau_prerequisites:{program}:{_sha256(json.dumps(snapshot, sort_keys=True))[:16]}"
    return {"schema_version": 1, "report_id": report_id, "program_id": program,
            "scope": "registered_program", "catalog_year": entry.year, "source_year": year,
            "collected_at": datetime.now(timezone.utc).isoformat(), "mode": "live" if live else "offline",
            "network_limits": {"workers": workers, "timeout_seconds": timeout, "retries": retries},
            "input_files": input_files, "missing_inputs": missing_inputs,
            "summary": summary, "courses": courses}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--program", default=DEFAULT_PROGRAM, help="Registered TAU program ID")
    parser.add_argument("--output", type=Path, help="Report path, relative to root unless absolute")
    parser.add_argument("--live", action="store_true", help="Fetch missing IMS responses")
    parser.add_argument("--refresh", action="store_true", help="With --live, re-fetch every discovered response instead of reusing captures")
    parser.add_argument("--write", action="store_true", help="Save report atomically; default is dry run")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, choices=(0, 1), default=1)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    output = args.output or Path(f"data/official/tau_prerequisites_{args.program}.json")
    if not output.is_absolute():
        output = root / output
    try:
        cache = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
        result = collect(root, live=args.live, cache=cache, workers=args.workers, timeout=args.timeout,
                         retries=args.retries, program=args.program, refresh=args.refresh)
        if args.write:
            output.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                                 prefix=output.name + ".", suffix=".tmp", delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(result, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
                temporary.replace(output)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps({"dry_run": not args.write, "mode": result["mode"], "report_id": result["report_id"],
                      "program_id": result["program_id"], "source_year": result["source_year"],
                      "output": str(output) if args.write else None, **result["summary"]}, indent=2))
    return 1 if args.live and (result["summary"]["stale_records"] or result["summary"]["unavailable_records"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
