"""--live must bypass the on-disk cache for every official source."""

import sys
from pathlib import Path

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
    rcd.read_program(2026, offline=False, live=True)
    assert seen["force_refresh"] is True


def test_live_forces_refresh_timetable(monkeypatch, tmp_path):
    _point_caches_at(monkeypatch, tmp_path)
    seen = {}

    def fake(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        seen["force_refresh"] = force_refresh
        return []

    monkeypatch.setattr(rcd, "fetch_schedule_data", fake)
    rcd.read_timetable(2026, offline=False, live=True)
    assert seen["force_refresh"] is True
