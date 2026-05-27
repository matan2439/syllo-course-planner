from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "TAU Course Planner"
    debug: bool = False
    database_url: str = "sqlite:///./tau_courses.db"
    tau_base_url: str = "https://www.ims.tau.ac.il/Tal/KW/CourseDetails.aspx"
    request_delay_seconds: float = 1.0


settings = Settings()
