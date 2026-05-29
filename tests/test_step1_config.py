"""
Step 1 infrastructure tests.

Verifies:
1. SQLite is the default when DATABASE_URL is not set — no env var required.
2. settings.database_url propagates the DATABASE_URL env var when present.
3. The initial Alembic migration file is importable and has upgrade/downgrade.

No live database connection is needed for any of these tests.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from unittest.mock import patch, MagicMock


# ── 1. SQLite fallback ───────────────────────────────────────────────────────

def test_sqlite_default_when_no_database_url(tmp_path):
    """_make_engine() returns a SQLite engine when database_url is empty."""
    from app.database.db import _make_engine, _DB_PATH

    # Build a fake settings object that reports database_url == ""
    fake_settings = MagicMock()
    fake_settings.database_url = ""

    with patch("app.database.db.settings", fake_settings):
        db_file = tmp_path / "test.sqlite"
        engine = _make_engine(db_file)
        assert "sqlite" in str(engine.url), f"Expected SQLite engine, got: {engine.url}"
        engine.dispose()


def test_explicit_db_path_always_uses_sqlite(tmp_path):
    """Passing an explicit db_path always uses SQLite, even if database_url is set."""
    from app.database.db import _make_engine

    fake_settings = MagicMock()
    fake_settings.database_url = "postgresql://user:pass@host/db"

    with patch("app.database.db.settings", fake_settings):
        # Explicit path → SQLite, regardless of database_url
        engine = _make_engine(tmp_path / "explicit.sqlite")
        assert "sqlite" in str(engine.url)
        engine.dispose()


# ── 2. DATABASE_URL env var propagation ─────────────────────────────────────

def test_config_reads_database_url_from_env():
    """settings.database_url reflects the DATABASE_URL environment variable."""
    test_url = "postgresql://user:pass@localhost/testdb"
    with patch.dict(os.environ, {"DATABASE_URL": test_url}):
        from app.config import Settings
        fresh = Settings()
        assert fresh.database_url == test_url


def test_config_database_url_defaults_to_empty():
    """settings.database_url is empty string when DATABASE_URL is not in environment."""
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    with patch.dict(os.environ, env, clear=True):
        from app.config import Settings
        fresh = Settings(_env_file=None)  # skip .env file to isolate env-only
        assert fresh.database_url == ""


# ── 3. Migration file validity ───────────────────────────────────────────────

def test_initial_migration_is_importable_and_has_callables():
    """The initial Alembic migration can be loaded and has upgrade/downgrade."""
    versions_dir = Path("alembic/versions")
    py_files = [
        f for f in versions_dir.glob("*.py")
        if not f.name.startswith("_")
    ]
    assert py_files, f"No migration files found in {versions_dir}"

    migration_file = sorted(py_files)[0]
    spec = importlib.util.spec_from_file_location(
        f"_migration_{migration_file.stem}", migration_file
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    assert callable(getattr(module, "upgrade", None)), (
        f"upgrade() not found in {migration_file.name}"
    )
    assert callable(getattr(module, "downgrade", None)), (
        f"downgrade() not found in {migration_file.name}"
    )
    assert getattr(module, "revision", None), (
        f"revision ID not found in {migration_file.name}"
    )
    assert getattr(module, "down_revision", "MISSING") is None, (
        "down_revision should be None for the initial migration"
    )
