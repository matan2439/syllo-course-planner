"""Add AI quota tables: anonymous_sessions, ai_usage_events, ai_credit_purchases.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-30
"""

from __future__ import annotations

from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""

    -- ── anonymous_sessions ──────────────────────────────────────────────────
    -- One row per browser session (UUID stored in localStorage as tau_ai_sid).
    -- credits_used: incremented server-side after each successful AI response.
    -- credits_paid: incremented by Stripe webhook (Phase 1).
    -- Effective quota: free_limit + credits_paid - credits_used > 0
    CREATE TABLE anonymous_sessions (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_token TEXT        UNIQUE NOT NULL,
        credits_used  INT         NOT NULL DEFAULT 0,
        credits_paid  INT         NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX anon_sessions_token_idx ON anonymous_sessions (session_token);

    -- ── ai_usage_events ──────────────────────────────────────────────────────
    -- Audit trail: one row per completed AI request.
    -- user_id is NULL for anonymous users; populated after auth (Phase 2).
    CREATE TABLE ai_usage_events (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
        session_token TEXT,
        model         TEXT        NOT NULL,
        input_tokens  INT,
        output_tokens INT,
        est_cost_usd  NUMERIC(10, 6),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ai_usage_session_idx ON ai_usage_events (session_token, created_at DESC);
    CREATE INDEX ai_usage_user_idx    ON ai_usage_events (user_id,       created_at DESC);

    -- ── ai_credit_purchases ──────────────────────────────────────────────────
    -- One row per Stripe Checkout payment (Phase 1).
    -- Seeded empty in Phase 0 — schema exists so the endpoint can insert later.
    CREATE TABLE ai_credit_purchases (
        id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                     UUID        REFERENCES users(id) ON DELETE SET NULL,
        session_token               TEXT,
        stripe_checkout_session_id  TEXT        UNIQUE NOT NULL,
        stripe_payment_intent_id    TEXT,
        package_id                  TEXT        NOT NULL,
        credits_purchased           INT         NOT NULL,
        amount_paid_usd             NUMERIC(10, 2) NOT NULL,
        status                      TEXT        NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at                TIMESTAMPTZ
    );
    CREATE INDEX ai_purchases_session_idx ON ai_credit_purchases (session_token);

    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE IF EXISTS ai_credit_purchases CASCADE;
    DROP TABLE IF EXISTS ai_usage_events      CASCADE;
    DROP TABLE IF EXISTS anonymous_sessions   CASCADE;
    """)
