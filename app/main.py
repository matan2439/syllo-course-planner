from fastapi import FastAPI
from app.api.courses import router as courses_router

app = FastAPI(
    title="TAU Course Planner",
    description="Collects and analyzes Tel Aviv University course data",
    version="0.1.0",
)

app.include_router(courses_router, prefix="/courses", tags=["courses"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
