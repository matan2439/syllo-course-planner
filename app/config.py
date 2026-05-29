from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "TAU Course Planner"
    debug: bool = False

    # ── Database ────────────────────────────────────────────────────────────
    # Postgres connection string (pooled, for app runtime).
    # When empty (default), the Python pipeline uses local SQLite instead.
    database_url: str = ""

    # Direct (non-pooled) Postgres URL used only by Alembic migrations.
    # Required only when running: alembic upgrade head
    direct_database_url: str = ""

    # ── Legacy / other ───────────────────────────────────────────────────────
    tau_base_url: str = "https://www.ims.tau.ac.il/Tal/KW/CourseDetails.aspx"
    request_delay_seconds: float = 1.0


settings = Settings()
