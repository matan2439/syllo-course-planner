"""Initial Postgres schema — programs, courses, plans, imports.

All 17 tables for the TAU course planner production database.
Written as raw SQL so the Postgres schema stays independent of the
SQLite table definitions in app/database/db.py.

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-05-29
"""

from __future__ import annotations

from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""

    -- ── programs ────────────────────────────────────────────────────────────
    CREATE TABLE programs (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        program_id  TEXT        UNIQUE NOT NULL,
        name_he     TEXT,
        name_en     TEXT,
        faculty     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── program_versions ────────────────────────────────────────────────────
    CREATE TABLE program_versions (
        id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        program_id           TEXT        NOT NULL REFERENCES programs(program_id),
        academic_year        INT         NOT NULL,
        academic_year_he     TEXT,
        is_active            BOOLEAN     NOT NULL DEFAULT true,
        source_type          TEXT,
        total_required_hours INT,
        notes                JSONB       NOT NULL DEFAULT '[]',
        raw_json             JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (program_id, academic_year)
    );
    CREATE INDEX program_versions_program_id_idx ON program_versions (program_id);
    CREATE INDEX program_versions_is_active_idx  ON program_versions (is_active);

    -- ── courses ─────────────────────────────────────────────────────────────
    CREATE TABLE courses (
        id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id              TEXT        UNIQUE NOT NULL,
        name_he                TEXT,
        name_en                TEXT,
        faculty                TEXT,
        department             TEXT,
        credits                FLOAT,
        lecture_hours          FLOAT,
        tutorial_hours         FLOAT,
        lab_hours              FLOAT,
        weekly_hours           FLOAT,
        course_description     TEXT,
        assignments            TEXT,
        exam_info              TEXT,
        topics                 JSONB       NOT NULL DEFAULT '[]',
        syllabus_links         JSONB       NOT NULL DEFAULT '[]',
        prerequisites_raw_text TEXT,
        last_seen_year         INT,
        last_seen_semester     TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX courses_faculty_idx        ON courses (faculty);
    CREATE INDEX courses_last_seen_year_idx ON courses (last_seen_year);

    -- ── course_offerings ────────────────────────────────────────────────────
    CREATE TABLE course_offerings (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id  TEXT        NOT NULL REFERENCES courses(course_id),
        year       INT         NOT NULL,
        semester   TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (course_id, year, semester)
    );
    CREATE INDEX course_offerings_course_year_idx ON course_offerings (course_id, year);

    -- ── course_groups ───────────────────────────────────────────────────────
    CREATE TABLE course_groups (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id     TEXT NOT NULL,
        year          INT,
        semester      TEXT,
        group_number  TEXT,
        lecturer      TEXT,
        teaching_type TEXT,
        day           TEXT,
        start_time    TEXT,
        end_time      TEXT,
        building      TEXT,
        room          TEXT,
        syllabus_url  TEXT,
        moodle_url    TEXT,
        UNIQUE (course_id, year, semester, group_number)
    );
    CREATE INDEX course_groups_course_year_sem_idx
        ON course_groups (course_id, year, semester);

    -- ── prerequisites ───────────────────────────────────────────────────────
    CREATE TABLE prerequisites (
        id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id              TEXT        NOT NULL,
        prerequisite_course_id TEXT        NOT NULL,
        source                 TEXT        NOT NULL DEFAULT 'parsed',
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (course_id, prerequisite_course_id)
    );
    CREATE INDEX prerequisites_course_id_idx     ON prerequisites (course_id);
    CREATE INDEX prerequisites_prereq_course_idx ON prerequisites (prerequisite_course_id);

    -- ── course_categories ───────────────────────────────────────────────────
    CREATE TABLE course_categories (
        id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        program_version_id UUID    NOT NULL
            REFERENCES program_versions(id) ON DELETE CASCADE,
        category_id        TEXT    NOT NULL,
        name_he            TEXT,
        min_courses        INT     NOT NULL DEFAULT 0,
        max_courses        INT,
        display_order      INT     NOT NULL DEFAULT 0,
        UNIQUE (program_version_id, category_id)
    );

    -- ── program_courses ─────────────────────────────────────────────────────
    CREATE TABLE program_courses (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        program_version_id UUID        NOT NULL
            REFERENCES program_versions(id) ON DELETE CASCADE,
        course_id          TEXT        NOT NULL,
        category_id        TEXT,
        is_mandatory       BOOLEAN     NOT NULL DEFAULT false,
        locked_by_default  BOOLEAN     NOT NULL DEFAULT false,
        allowed_semesters  JSONB       NOT NULL DEFAULT '[]',
        offered_semesters  JSONB       NOT NULL DEFAULT '[]',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (program_version_id, course_id)
    );
    CREATE INDEX program_courses_version_category_idx
        ON program_courses (program_version_id, category_id);
    CREATE INDEX program_courses_version_mandatory_idx
        ON program_courses (program_version_id, is_mandatory);

    -- ── grade_stats ─────────────────────────────────────────────────────────
    CREATE TABLE grade_stats (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id          TEXT        NOT NULL,
        year               INT,
        semester           TEXT,
        moed               TEXT,
        lecturer_name      TEXT,
        average_grade      FLOAT,
        median_grade       FLOAT,
        standard_deviation FLOAT,
        pass_rate          FLOAT,
        num_students       INT,
        source_name        TEXT        NOT NULL,
        source_url         TEXT,
        fetched_at         TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX grade_stats_course_id_idx
        ON grade_stats (course_id);
    CREATE INDEX grade_stats_course_year_idx
        ON grade_stats (course_id, year DESC);
    CREATE INDEX grade_stats_avg_not_null_idx
        ON grade_stats (course_id) WHERE average_grade IS NOT NULL;

    -- ── syllabus_sources ────────────────────────────────────────────────────
    CREATE TABLE syllabus_sources (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id    TEXT        NOT NULL,
        year         INT,
        semester     TEXT,
        group_number TEXT,
        url          TEXT        NOT NULL,
        is_active    BOOLEAN     NOT NULL DEFAULT true,
        source       TEXT        NOT NULL DEFAULT 'tau_ims',
        fetched_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX syllabus_sources_course_active_idx
        ON syllabus_sources (course_id, is_active);

    -- ── import_runs ─────────────────────────────────────────────────────────
    CREATE TABLE import_runs (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        source_name       TEXT        NOT NULL,
        status            TEXT        NOT NULL DEFAULT 'running'
            CHECK (status IN ('running', 'completed', 'failed')),
        started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at      TIMESTAMPTZ,
        courses_processed INT         NOT NULL DEFAULT 0,
        courses_inserted  INT         NOT NULL DEFAULT 0,
        courses_updated   INT         NOT NULL DEFAULT 0,
        courses_failed    INT         NOT NULL DEFAULT 0,
        error_message     TEXT,
        metadata          JSONB       NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX import_runs_source_started_idx
        ON import_runs (source_name, started_at DESC);
    CREATE INDEX import_runs_status_idx
        ON import_runs (status);

    -- ── users ───────────────────────────────────────────────────────────────
    CREATE TABLE users (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email        TEXT        UNIQUE,
        display_name TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── user_profiles ───────────────────────────────────────────────────────
    CREATE TABLE user_profiles (
        id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID        NOT NULL
            REFERENCES users(id) ON DELETE CASCADE,
        program_version_id    UUID
            REFERENCES program_versions(id),
        profile_name          TEXT,
        max_difficulty        FLOAT,
        max_weekly_hours      FLOAT,
        target_specialization TEXT,
        preferred_topics      JSONB       NOT NULL DEFAULT '[]',
        avoided_topics        JSONB       NOT NULL DEFAULT '[]',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX user_profiles_user_id_idx ON user_profiles (user_id);

    -- ── user_completed_courses ──────────────────────────────────────────────
    CREATE TABLE user_completed_courses (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID        NOT NULL
            REFERENCES users(id) ON DELETE CASCADE,
        course_id       TEXT        NOT NULL,
        personal_grade  FLOAT,
        completion_year INT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, course_id)
    );
    CREATE INDEX user_completed_courses_user_id_idx
        ON user_completed_courses (user_id);

    -- ── user_course_plans ───────────────────────────────────────────────────
    CREATE TABLE user_course_plans (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID        NOT NULL
            REFERENCES users(id) ON DELETE CASCADE,
        program_version_id UUID        NOT NULL
            REFERENCES program_versions(id),
        plan_name          TEXT        NOT NULL DEFAULT 'תוכנית ראשית',
        is_active          BOOLEAN     NOT NULL DEFAULT true,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX user_course_plans_user_active_idx
        ON user_course_plans (user_id, is_active);

    -- ── plan_semesters ──────────────────────────────────────────────────────
    CREATE TABLE plan_semesters (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id       UUID        NOT NULL
            REFERENCES user_course_plans(id) ON DELETE CASCADE,
        semester_id   TEXT        NOT NULL,
        display_label TEXT,
        is_completed  BOOLEAN     NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (plan_id, semester_id)
    );

    -- ── plan_courses ────────────────────────────────────────────────────────
    CREATE TABLE plan_courses (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id     UUID        NOT NULL
            REFERENCES user_course_plans(id) ON DELETE CASCADE,
        semester_id TEXT        NOT NULL,
        course_id   TEXT        NOT NULL,
        is_locked   BOOLEAN     NOT NULL DEFAULT false,
        added_by    TEXT        NOT NULL DEFAULT 'user',
        position    INT         NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (plan_id, course_id)
    );
    CREATE INDEX plan_courses_plan_semester_idx
        ON plan_courses (plan_id, semester_id);

    -- ── course_overrides ────────────────────────────────────────────────────
    CREATE TABLE course_overrides (
        id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                           UUID
            REFERENCES users(id) ON DELETE CASCADE,
        course_id                         TEXT        NOT NULL,
        user_notes                        TEXT        NOT NULL DEFAULT '',
        manual_weekly_hours               FLOAT,
        manual_conceptual_complexity_note TEXT        NOT NULL DEFAULT '',
        known_instructor_notes            TEXT        NOT NULL DEFAULT '',
        expected_instructor               TEXT        NOT NULL DEFAULT '',
        confidence_adjustment             FLOAT       NOT NULL DEFAULT 0.0
            CHECK (confidence_adjustment BETWEEN -1.0 AND 1.0),
        is_public                         BOOLEAN     NOT NULL DEFAULT false,
        updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, course_id)
    );
    CREATE INDEX course_overrides_course_id_idx ON course_overrides (course_id);

    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE IF EXISTS course_overrides        CASCADE;
    DROP TABLE IF EXISTS plan_courses            CASCADE;
    DROP TABLE IF EXISTS plan_semesters          CASCADE;
    DROP TABLE IF EXISTS user_course_plans       CASCADE;
    DROP TABLE IF EXISTS user_completed_courses  CASCADE;
    DROP TABLE IF EXISTS user_profiles           CASCADE;
    DROP TABLE IF EXISTS users                   CASCADE;
    DROP TABLE IF EXISTS import_runs             CASCADE;
    DROP TABLE IF EXISTS syllabus_sources        CASCADE;
    DROP TABLE IF EXISTS grade_stats             CASCADE;
    DROP TABLE IF EXISTS program_courses         CASCADE;
    DROP TABLE IF EXISTS course_categories       CASCADE;
    DROP TABLE IF EXISTS prerequisites           CASCADE;
    DROP TABLE IF EXISTS course_groups           CASCADE;
    DROP TABLE IF EXISTS course_offerings        CASCADE;
    DROP TABLE IF EXISTS courses                 CASCADE;
    DROP TABLE IF EXISTS program_versions        CASCADE;
    DROP TABLE IF EXISTS programs                CASCADE;
    """)
