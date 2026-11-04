"""--live must bypass the on-disk cache for every official source."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import refresh_course_data as rcd  # noqa: E402

NOT_OFFERED_HTML = rcd.NOT_OFFERED_MARKER


def _point_caches_at(monkeypatch, tmp_path):
    monkeypatch.setattr(rcd, "IMS_CACHE", tmp_path / "course_details")
    monkeypatch.setattr(rcd, "ROOT", tmp_path)
    monkeypatch.setattr(rcd.time, "sleep", lambda *_: None)


def test_live_forces_refresh_ims(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    seen = {}

    def fake_fetch_url(url, cache_path, force_refresh=False):
        seen["force_refresh"] = force_refresh
        return NOT_OFFERED_HTML

    monkeypatch.setattr(rcd, "fetch_url", fake_fetch_url)
    rcd.read_ims("0542-4120", 2026, offline=False, live=True)
    assert seen["force_refresh"] is True


def test_not_live_does_not_force_refresh_ims(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    seen = {}

    def fake_fetch_url(url, cache_path, force_refresh=False):
        seen["force_refresh"] = force_refresh
        return NOT_OFFERED_HTML

    monkeypatch.setattr(rcd, "fetch_url", fake_fetch_url)
    rcd.read_ims("0542-4120", 2026, offline=False)
    assert seen["force_refresh"] is False


def test_live_forces_refresh_program(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    seen = {}

    def fake(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        seen["force_refresh"] = force_refresh
        return []

    monkeypatch.setattr(rcd, "fetch_program_data", fake)
    with pytest.raises(RuntimeError, match="refusing to write degraded facts"):
        rcd.read_program(2026, offline=False, live=True)  # an empty response fails closed
    assert seen["force_refresh"] is True


def test_live_forces_refresh_timetable(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    seen = {}

    def fake(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        seen["force_refresh"] = force_refresh
        return []

    monkeypatch.setattr(rcd, "fetch_schedule_data", fake)
    with pytest.raises(RuntimeError, match="refusing to write degraded facts"):
        rcd.read_timetable(2026, offline=False, live=True)  # an empty response fails closed
    assert seen["force_refresh"] is True


@pytest.mark.parametrize("reader,fetcher", [("read_program", "fetch_program_data"),
                                            ("read_timetable", "fetch_schedule_data")])
def test_failed_fetch_raises_instead_of_returning_no_facts(monkeypatch, tmp_path, reader, fetcher):
    """_fetch_body returns [] when the GraphQL call fails; that must not become 'no facts'."""
    _point_caches_at(monkeypatch, tmp_path)
    monkeypatch.setattr(rcd, fetcher, lambda *a, **k: [])
    for live in (True, False):
        with pytest.raises(RuntimeError, match="refusing to write degraded facts"):
            getattr(rcd, reader)(2026, offline=False, live=live)


def test_offline_without_cache_is_no_data_not_an_error(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    assert rcd.read_program(2026, offline=True) == {}
    assert rcd.read_timetable(2026, offline=True) == {}
