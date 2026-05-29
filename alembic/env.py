"""Alembic migration environment.

Database URL is read from the DIRECT_DATABASE_URL environment variable.
This must be the non-pooled (direct) Supabase connection string so that
DDL operations (CREATE TABLE, ALTER TABLE, etc.) work correctly.

Usage:
    DIRECT_DATABASE_URL=postgresql://... alembic upgrade head
    DIRECT_DATABASE_URL=postgresql://... alembic downgrade base
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context

# Load .env so DIRECT_DATABASE_URL is available without a manual shell export
load_dotenv()

# Make the project root importable so 'app.*' imports work inside migrations
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Raw-SQL migrations — no SQLAlchemy metadata needed for autogenerate
target_metadata = None


def _get_url() -> str:
    url = os.environ.get("DIRECT_DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "\n\nDIRECT_DATABASE_URL is not set.\n"
            "Get the direct connection string from:\n"
            "  Supabase dashboard → Settings → Database → Connection string (URI)\n"
            "Then run:\n"
            "  DIRECT_DATABASE_URL=postgresql://... alembic upgrade head\n"
        )
    return url


def run_migrations_offline() -> None:
    url = _get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,  # no pool needed for one-shot DDL migrations
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
