import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from app.scraping.tau_client import (
    normalize_course_id,
    build_course_search_url,
    fetch_course_search_page,
)


# ---------------------------------------------------------------------------
# normalize_course_id
# ---------------------------------------------------------------------------

def test_normalize_strips_hyphen():
    assert normalize_course_id("0368-2157") == "03682157"

def test_normalize_strips_spaces():
    assert normalize_course_id("0368 2157") == "03682157"

def test_normalize_already_clean():
    assert normalize_course_id("03682157") == "03682157"

def test_normalize_mixed_junk():
    assert normalize_course_id("03.68-21 57x") == "03682157"


# ---------------------------------------------------------------------------
# build_course_search_url
# ---------------------------------------------------------------------------

def test_build_url_contains_course_id():
    url = build_course_search_url("03682157", 2025)
    assert "03682157" in url

def test_build_url_contains_year():
    url = build_course_search_url("03682157", 2025)
    assert "2025" in url

def test_build_url_is_https():
    url = build_course_search_url("03682157", 2025)
    assert url.startswith("https://")

def test_build_url_uses_static_endpoint():
    url = build_course_search_url("03682157", 2025)
    assert "search_l.aspx" in url
    assert "course_num=03682157" in url

def test_build_url_optional_lang():
    url = build_course_search_url("03682157", 2025, lang="EN")
    assert "lang=EN" in url

def test_build_url_no_lang_by_default():
    url = build_course_search_url("03682157", 2025)
    assert "lang=" not in url


# ---------------------------------------------------------------------------
# fetch_course_search_page — cache hit (no network)
# ---------------------------------------------------------------------------

def test_fetch_loads_from_cache(tmp_path):
    cached_html = "<html>cached</html>"
    cache_file = tmp_path / "course_03682157_2025.html"
    cache_file.write_text(cached_html, encoding="utf-8")

    import app.scraping.tau_client as client_module
    original_cache_dir = client_module._CACHE_DIR
    client_module._CACHE_DIR = tmp_path

    try:
        result = fetch_course_search_page("0368-2157", 2025, force_refresh=False)
        assert result == cached_html
    finally:
        client_module._CACHE_DIR = original_cache_dir


def test_fetch_force_refresh_skips_cache(tmp_path):
    """force_refresh=True must hit the network even when cache exists."""
    cache_file = tmp_path / "course_03682157_2025.html"
    cache_file.write_text("<html>stale</html>", encoding="utf-8")

    mock_response = MagicMock()
    mock_response.text = "<html>fresh</html>"
    mock_response.raise_for_status = MagicMock()

    import app.scraping.tau_client as client_module
    original_cache_dir = client_module._CACHE_DIR
    client_module._CACHE_DIR = tmp_path

    try:
        with patch("requests.get", return_value=mock_response):
            result = fetch_course_search_page("0368-2157", 2025, force_refresh=True)
        assert result == "<html>fresh</html>"
    finally:
        client_module._CACHE_DIR = original_cache_dir
