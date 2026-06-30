"""Add planner_runs table for agentic Planner Worker runs.

Stores one row per planning run: status, the full PlannerAction trace, the
generated candidates, the selected plan, the validation report and the
explanation (all JSONB). Written by POST /api/ai/planner-run.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""

    -- ── planner_runs ────────────────────────────────────────────────────────────
    -- One row per agentic Planner Worker run. Created 'running' at the start of a
    -- request and updated to a terminal status when the run finishes:
    --   running  — in progress
    --   done     — completed; plan valid and complete
    --   blocked  — completed but an irreducible requirement remains unmet
    --   failed   — unexpected error (error_text populated)
    -- trace/candidates/plan/report/explanation are stored as JSONB.
    CREATE TABLE planner_runs (
        id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_token           TEXT        NOT NULL,
        program_id              TEXT        NOT NULL,
        orchestrator            TEXT        NOT NULL DEFAULT 'llm',
        status                  TEXT        NOT NULL DEFAULT 'running'
            CHECK (status IN ('running', 'done', 'blocked', 'failed')),
        trace_json              JSONB,
        candidates_json         JSONB,
        selected_plan_json      JSONB,
        validation_report_json  JSONB,
        explanation_json        JSONB,
        error_text              TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at             TIMESTAMPTZ
    );
    CREATE INDEX planner_runs_session_idx ON planner_runs (session_token, created_at DESC);
    CREATE INDEX planner_runs_status_idx  ON planner_runs (status);

    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE IF EXISTS planner_runs CASCADE;
    """)
