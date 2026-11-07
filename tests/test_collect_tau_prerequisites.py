"""Collector safety, discovery completeness, and conservative consensus."""
import json
import hashlib
from pathlib import Path
from threading import Lock
import time
from unittest.mock import Mock

import pytest
import requests

from scripts.collect_tau_prerequisites import (
    collect, discover_links, program_course_ids, main, requirement_consensus,
)


CID = "0512-4100"
BASE = "https://ims.tau.ac.il/tal/kr/Drishot_L.aspx"
URL = f"{BASE}?kurs=05124100&kv=01&sem=20261"
INPUTS = [
    "data/degrees/tau/electrical_engineering/2027/spec.json",
    "data/boards/electrical_engineering_2027.json",
    "data/boards/electrical_engineering_years_1_2_2027.json",
]


def drishot(cid=CID, *, corequisite=True, none=False):
    pre = ("<tr><td>אין דרישות קדם</td></tr>" if none else
           "<tr><td><table><tr><td>0512-3632</td><td>שם</td></tr>"
           "<tr><td>או</td></tr><tr><td>0512-2532</td><td>שם</td></tr></table></td></tr>")
    co = "<tr><th>קורסים מקבילים נדרשים</th></tr><tr><td>אין דרישות מקבילות</td></tr>" if corequisite else ""
    return (f'<span class="listtdbbld">שנה"ל (2026/2027)</span>'
            f'<span class="listtd">קורס: שם ({cid})</span>'
            f'<table class="tableblds"><tr><th>קורסי קדם נדרשים</th></tr>{pre}{co}</table>')


def setup_root(tmp_path, links=None):
    registry = tmp_path / "data/config/programs.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(json.dumps({"programs": [{
        "id": "electrical_engineering_2027", "institution": "tau", "base": "electrical_engineering",
        "year": 2027, "sourceYear": 2026, "nameHe": "חשמל", "nameEn": "EE",
        "familyId": "electrical_engineering", "familyDescriptionHe": "חשמל",
        "descriptionHe": "חשמל", "yearLabelHe": "2027", "boardJsonFile": "ee.json",
        "sourceIds": {}, "status": "draft", "isFamilyDefault": True, "capabilities": [],
    }]}), encoding="utf-8")
    for path, cid in zip(INPUTS, [CID, "0512-3513", "0509-1117"]):
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        document = ({"mandatory_courses": [{"course_id": cid}]} if path.endswith("spec.json")
                    else {"semesters": [{"courses": [{"course_id": cid}]}]})
        target.write_text(json.dumps(document), encoding="utf-8")
    details = tmp_path / "data/raw_html/course_details/course_05124100_2026.html"
    details.parent.mkdir(parents=True, exist_ok=True)
    details.write_text(links or f'<a href="{URL}">דרישות</a>', encoding="utf-8")
    return tmp_path


def response(html=None, url=URL, status=200):
    result = Mock()
    result.status_code = status
    result.url = url
    result.headers = {"Content-Type": "text/html; charset=utf-8"}
    body = (drishot() if html is None else html).encode("utf-8")
    result.iter_content.return_value = [body]
    result.close = Mock()
    result.raise_for_status.side_effect = requests.HTTPError("unavailable") if status >= 400 else None
    return result


def test_program_ids_union_includes_early_board(tmp_path):
    assert program_course_ids(setup_root(tmp_path)) == {CID, "0512-3513", "0509-1117"}


def test_discovers_all_groups_terms_and_popup_links():
    html = (f'<a href="javascript:open_win(\'Drishot_L.aspx?kurs=05124100&amp;kv=01&amp;sem=20261\',800,600)">1</a>'
            f'<a href="{BASE}?kurs=05124100&kv=02&sem=20261">2</a>'
            f'<a onclick="open_win(\'Drishot_L.aspx?kurs=05124100&kv=01&sem=20262\',800,600)">3</a>')
    records = discover_links(html, course_id=CID, year=2026, path="capture.html")
    assert {(r["group"], r["semester"]) for r in records} == {("01", "20261"), ("02", "20261"), ("01", "20262")}
    assert all(r["url_identity_verified"] for r in records)


@pytest.mark.parametrize("url", [
    URL.replace("ims.tau.ac.il", "example.com"),
    URL.replace("https:", "http:"),
    URL.replace("05124100", "05123513"),
    URL.replace("20261", "20251"),
    URL + "&sem=20262", URL + "&kv=", URL.replace("kv=01", "kv=1"),
    URL.replace("ims.tau.ac.il", "ims.tau.ac.il@evil.example"),
])
def test_rejected_links_are_retained_without_fetch(tmp_path, url):
    root = setup_root(tmp_path, f'<a href="{url}">דרישות</a>')
    fetch = Mock(side_effect=AssertionError("invalid URL must never be fetched"))
    result = collect(root, live=True, get=fetch)
    records = result["courses"][CID]["records"]
    assert len(records) == 1
    assert records[0]["retrieval_status"] == "invalid_url"
    assert records[0]["parsed"]["prerequisites"] is None
    fetch.assert_not_called()


def test_offline_default_retains_missing_courses_and_all_links(tmp_path):
    html = f'<a href="{URL}">1</a><a href="{URL.replace("kv=01", "kv=02")}">2</a>'
    root = setup_root(tmp_path, html)
    get = Mock(side_effect=AssertionError("offline must not use network"))
    result = collect(root, get=get)
    assert len(result["courses"][CID]["records"]) == 2
    assert all(r["retrieval_status"] == "unavailable" for r in result["courses"][CID]["records"])
    assert result["courses"]["0512-3513"]["details_status"] == "missing"
    assert result["courses"][CID]["consensus"]["status"] == "unknown"
    get.assert_not_called()


def test_live_fetch_preserves_or_and_response_provenance_then_reuses_cache(tmp_path):
    root = setup_root(tmp_path)
    fetch = Mock(return_value=response())
    result = collect(root, live=True, get=fetch)
    record = result["courses"][CID]["records"][0]
    assert record["parsed"]["identity_verified"]
    assert record["parsed"]["prerequisites"] == {"any_of": [{"course_id": "0512-3632"}, {"course_id": "0512-2532"}]}
    assert record["source_url"] == URL
    assert record["group"] == "01"
    assert record["semester"] == "20261"
    assert record["response"]["sha256"]
    assert record["response"]["fetched_at"]
    assert record["response"]["html"] == drishot()
    assert record["discovered_from"][0]["path"].endswith("course_05124100_2026.html")
    fetch.assert_called_once_with(URL, timeout=30, allow_redirects=False, stream=True)
    blocked = Mock(side_effect=AssertionError("cache must not fetch"))
    cached = collect(root, cache=result, get=blocked)
    assert cached["courses"][CID]["records"][0]["retrieval_status"] == "cache"
    assert cached["courses"][CID]["consensus"] == result["courses"][CID]["consensus"]
    blocked.assert_not_called()


def test_explicit_refresh_reads_changed_official_requirements_instead_of_reusing_capture(tmp_path):
    root = setup_root(tmp_path)
    previous = collect(root, live=True, get=Mock(return_value=response()))
    fresh = Mock(return_value=response(drishot(none=True)))
    updated = collect(root, live=True, refresh=True, cache=previous, get=fresh)
    fresh.assert_called_once()
    assert updated['courses'][CID]['consensus']['prerequisites'] == {'all_of': []}
    assert updated['courses'][CID]['records'][0]['response']['sha256'] != previous['courses'][CID]['records'][0]['response']['sha256']
    with pytest.raises(ValueError, match='requires --live'):
        collect(root, refresh=True, cache=previous)


def test_duplicate_links_merge_discovery_provenance(tmp_path):
    root = setup_root(tmp_path, f'<a href="{URL}">1</a><a onclick="open_win(\'{URL}\')">2</a>')
    result = collect(root)
    records = result["courses"][CID]["records"]
    assert len(records) == 1
    assert len(records[0]["discovered_from"]) == 2


def test_one_retry_then_failure_remains_unknown(tmp_path):
    fetch = Mock(side_effect=requests.Timeout("timeout"))
    result = collect(setup_root(tmp_path), live=True, get=fetch)
    assert fetch.call_count == 2
    record = result["courses"][CID]["records"][0]
    assert record["attempts"] == 2
    assert record["parsed"]["status"] == "unknown"
    assert result["courses"][CID]["consensus"]["prerequisites"] is None


@pytest.mark.parametrize("reply", [
    response(url=URL.replace("ims.tau.ac.il", "example.com")), response(status=302),
    response(html=drishot(cid="0512-3513")),
    response(html='<div class="msgerrs">אין נתונים</div>'),
])
def test_redirects_identity_mismatch_and_no_data_are_unknown(tmp_path, reply):
    result = collect(setup_root(tmp_path), live=True, get=Mock(return_value=reply))
    assert result["courses"][CID]["consensus"]["prerequisites"] is None


def test_consensus_requires_every_record_known_and_equal():
    known = {"prerequisites": {"any_of": [{"course_id": "0512-3632"}, {"course_id": "0512-2532"}]},
             "corequisites": {"all_of": []}, "identity_verified": True}
    records = [{"parsed": known, "url_identity_verified": True}] * 2
    assert requirement_consensus(records)["prerequisites"] == known["prerequisites"]
    unknown = {**known, "corequisites": None}
    result = requirement_consensus(records + [{"parsed": unknown, "url_identity_verified": True}])
    assert result["prerequisites"] == known["prerequisites"]
    assert result["corequisites"] is None
    different = {**known, "prerequisites": {"all_of": []}}
    assert requirement_consensus(records + [{"parsed": different, "url_identity_verified": True}])["prerequisites"] is None
    assert requirement_consensus([])["status"] == "unknown"


def test_missing_section_prevents_corequisite_consensus(tmp_path):
    result = collect(setup_root(tmp_path), live=True, get=Mock(return_value=response(drishot(corequisite=False))))
    consensus = result["courses"][CID]["consensus"]
    assert consensus["prerequisites"] is not None
    assert consensus["corequisites"] is None
    assert consensus["status"] == "unknown"


@pytest.mark.parametrize("options", [{"workers": 5}, {"workers": 0}, {"timeout": 31}, {"retries": 2}])
def test_network_bounds_are_enforced(tmp_path, options):
    with pytest.raises(ValueError):
        collect(setup_root(tmp_path), **options)


def test_cli_is_dry_run_by_default_and_write_is_explicit(tmp_path, capsys):
    setup_root(tmp_path)
    assert main(["--root", str(tmp_path)]) == 0
    output = tmp_path / "data/official/tau_prerequisites_electrical_engineering_2027.json"
    assert not output.exists()
    assert json.loads(capsys.readouterr().out)["dry_run"] is True
    assert main(["--root", str(tmp_path), "--write"]) == 0
    assert output.exists()
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert CID in saved["courses"]


def test_mismatched_response_hash_cannot_be_reused(tmp_path):
    root = setup_root(tmp_path)
    cached = collect(root, live=True, get=Mock(return_value=response()))
    cached["courses"][CID]["records"][0]["response"]["html"] = drishot(none=True)
    result = collect(root, cache=cached)
    assert result["courses"][CID]["consensus"]["prerequisites"] is None


def test_other_year_and_other_course_details_are_ignored(tmp_path):
    root = setup_root(tmp_path)
    details = root / "data/raw_html/course_details"
    (details / "course_05124100_2025.html").write_text(f'<a href="{URL}">old</a>', encoding="utf-8")
    (details / "course_99999999_2026.html").write_text(f'<a href="{URL}">other</a>', encoding="utf-8")
    assert len(collect(root)["courses"][CID]["records"]) == 1


def test_four_worker_limit_is_observed(tmp_path):
    urls = [URL.replace("kv=01", f"kv={group:02d}") for group in range(1, 13)]
    root = setup_root(tmp_path, "".join(f'<a href="{url}">קדם</a>' for url in urls))
    lock = Lock()
    active = peak = 0

    def get(url, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return response(url=url)

    result = collect(root, live=True, get=get, workers=4)
    assert 1 < peak <= 4
    assert result["summary"]["fetched_records"] == 12
    assert len(result["courses"][CID]["records"]) == 12


def test_source_snapshot_is_preserved_if_input_changes_during_fetch(tmp_path):
    root = setup_root(tmp_path)
    path = root / INPUTS[0]
    original = path.read_text(encoding="utf-8")

    def get(url, **kwargs):
        path.write_text('{}', encoding="utf-8")
        return response()

    result = collect(root, live=True, get=get)
    assert next(item for item in result["input_files"] if item["path"] == INPUTS[0])["sha256"] == hashlib.sha256(original.encode("utf-8")).hexdigest()
    assert CID in result["courses"]


def test_oversized_and_non_html_responses_are_retained_unknown(tmp_path):
    root = setup_root(tmp_path)
    reply = response()
    reply.iter_content.return_value = [b" " * 1_000_001]
    result = collect(root, live=True, get=Mock(return_value=reply), retries=0)
    assert result["courses"][CID]["consensus"]["prerequisites"] is None
    assert "size limit" in result["courses"][CID]["records"][0]["issues"][0]
    reply = response()
    reply.headers = {"Content-Type": "application/octet-stream"}
    result = collect(root, live=True, get=Mock(return_value=reply), retries=0)
    assert result["courses"][CID]["records"][0]["retrieval_status"] == "unavailable"


def test_equal_expressions_with_invalid_source_never_form_consensus():
    known = {"identity_verified": True, "prerequisites": {"all_of": []}, "corequisites": {"all_of": []}}
    result = requirement_consensus([{"parsed": known, "url_identity_verified": False}])
    assert result["prerequisites"] is result["corequisites"] is None


def test_consensus_does_not_equate_or_with_and_or_drop_failed_groups(tmp_path):
    root = setup_root(tmp_path, f'<a href="{URL}">1</a><a href="{URL.replace("kv=01", "kv=02")}">2</a>')

    def get(url, **kwargs):
        if "kv=02" in url:
            return response(html=drishot().replace("או", "וגם"), url=url)
        return response(url=url)

    result = collect(root, live=True, get=get)
    course = result["courses"][CID]
    assert len(course["records"]) == 2
    assert course["consensus"]["prerequisites"] is None
    assert any("conflicting" in issue for issue in course["consensus"]["issues"])


def test_registry_drives_another_program_and_source_year(tmp_path, capsys):
    root = setup_root(tmp_path)
    registry_path = root / "data/config/programs.json"
    registry = json.loads(registry_path.read_bytes())
    other = {**registry["programs"][0], "id": "next_degree_2028", "base": "next_degree",
             "year": 2028, "sourceYear": 2027, "familyId": "next_degree"}
    registry["programs"].append(other)
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    spec = root / "data/degrees/tau/next_degree/2028/spec.json"
    spec.parent.mkdir(parents=True)
    spec.write_text(json.dumps({"source_year": 2027, "mandatory_courses": [{"course_id": "0512-3513"}]}), encoding="utf-8")
    details = root / "data/raw_html/course_details/course_05123513_2027.html"
    url = URL.replace("05124100", "05123513").replace("20261", "20271")
    details.write_text(f'<a href="{url}">קדם</a>', encoding="utf-8")
    result = collect(root, program="next_degree_2028")
    assert result["source_year"] == 2027
    assert result["catalog_year"] == 2028
    assert result["program_id"] == "next_degree_2028"
    assert "next_degree_2028" in result["report_id"]
    assert result["scope"] == "registered_program"
    assert list(result["courses"]) == ["0512-3513"]
    assert result["courses"]["0512-3513"]["records"][0]["semester"] == "20271"
    assert len(result["missing_inputs"]) == 2
    assert main(["--root", str(root), "--program", "next_degree_2028", "--write"]) == 0
    assert (root / "data/official/tau_prerequisites_next_degree_2028.json").exists()


def test_external_rule_counterparts_are_distinguished(tmp_path):
    root = setup_root(tmp_path)
    spec_path = root / INPUTS[0]
    spec = json.loads(spec_path.read_bytes())
    spec["course_rules"] = [{"course_ids": [CID, "0368-2161"]}]
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    result = collect(root)
    assert result["courses"][CID]["course_role"] == "program_course"
    counterpart = result["courses"]["0368-2161"]
    assert counterpart["course_role"] == "external_required_source"
    assert counterpart["unavailable_external_required_source"] is True
    assert counterpart["details_status"] == "missing"
    assert result["summary"]["unavailable_external_required_sources"] == 1


def test_input_hashes_cover_exact_crlf_bytes(tmp_path):
    root = setup_root(tmp_path)
    spec = root / INPUTS[0]
    raw = b'{\r\n  "mandatory_courses": [{"course_id": "0512-4100"}]\r\n}\r\n'
    spec.write_bytes(raw)
    result = collect(root)
    item = next(item for item in result["input_files"] if item["path"] == INPUTS[0])
    assert item["sha256"] == hashlib.sha256(raw).hexdigest()


def test_shared_discovery_is_reexported():
    from app.degrees.prerequisite_sources import discover_links as shared
    assert discover_links is shared


def test_unknown_program_is_rejected(tmp_path):
    root = setup_root(tmp_path)
    with pytest.raises(ValueError, match="Unknown registered program"):
        collect(root, program="missing_2027")
