"""Add board_json column to program_versions.

Stores the pre-computed board document (identical schema to
data/parsed_json/mechanical_semester_board_2027.json) so the API
can return it without reconstructing it from relational tables.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-29
"""

from __future__ import annotations

from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE program_versions ADD COLUMN board_json JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE program_versions DROP COLUMN board_json")
