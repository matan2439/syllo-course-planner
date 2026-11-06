"""Verify saved alternatives and manual course edits against a Vercel preview."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlencode, urlsplit
from uuid import uuid4


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def vercel_command():
    # The Windows npm shim is a batch file. Invoke its Node entry point directly.
    shim = shutil.which("vercel.cmd") or shutil.which("vercel")
    require(shim, "Install the Vercel CLI and sign in first.")
    if Path(shim).suffix.lower() == ".cmd":
        entry = Path(shim).parent / "node_modules/vercel/dist/index.js"
        require(entry.is_file(), "Could not find the Node entry point for the Vercel CLI.")
        return ["node", str(entry)]
    return [shim]


def smoke(args, directory):
    cli = vercel_command()
    scope = ["--scope", args.scope]
    base = args.preview.rstrip("/")
    require(re.fullmatch(r"https://[a-z0-9-]+\.vercel\.app", base), "Use the unique HTTPS Vercel preview URL.")
    inspect = subprocess.run([*cli, "inspect", base, "--json", *scope], capture_output=True, text=True, timeout=45)
    require(inspect.returncode == 0, "Could not inspect the deployment. Check Vercel sign-in and team scope.")
    info = json.loads(inspect.stdout)
    require(
        info.get("target") == "preview" and info.get("readyState") == "READY"
        and info.get("url") == urlsplit(base).netloc,
        "The deployment must be READY and the URL must identify the preview itself.",
    )

    cookie_jar = directory / "session.txt"
    response = directory / "response.json"

    def request(path, payload=None):
        cmd = [
            *cli, "curl", path, "--deployment", base, *scope, "--",
            "--silent", "--show-error", "--max-time", "30",
            "--cookie", str(cookie_jar), "--cookie-jar", str(cookie_jar),
            "--output", str(response), "--write-out", "%{http_code}",
        ]
        if payload is not None:
            cmd += ["--header", "Content-Type: application/json", "--header", f"Origin: {base}",
                    "--data-binary", "@-"]
        result = subprocess.run(cmd, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True, timeout=45)
        require(result.returncode == 0, f"Vercel request failed for {path}.")
        try:
            data = json.loads(response.read_text(encoding="utf-8"))
        except ValueError:
            raise SystemExit(f"{path} returned a non-JSON response (HTTP {result.stdout.strip()}).")
        require(result.stdout.strip() == "200" and data.get("ok") is True,
                f"{path} returned HTTP {result.stdout.strip()} ({data.get('code', 'UNKNOWN')}).")
        return data

    workspace = "/api/ai/student-workspace"
    query = {"scope": "program", "program_id": args.program}
    target = f"{workspace}?{urlencode(query)}"
    initial = request(target)
    require(initial["revision"] == 0 and not initial["data"]["plans"], "Expected a fresh test workspace.")
    context = request("/api/ai/planning-context", {
        "program_id": args.program, "plan_context": {"semesters": [], "personal_status": {"completed": []}},
        "preferences": {},
    })
    now = time.time_ns() // 1_000_000
    plans = []
    for course, semester, year, term, group in args.alternative:
        plans.append({
            "id": f"plan_smoke_{uuid4().hex}", "name": f"Smoke test {course}", "notes": "",
            "catalogVersion": None, "createdAt": now, "updatedAt": now,
            "semesters": [{"semesterId": semester, "courseIds": [course]}],
            "weeklySchedule": {"termMapping": {}, "selections": {f"{course}:{year}:{term}": [group]}, "freeDays": []},
        })
    saved = request(workspace, {
        **query, "expected_revision": initial["revision"],
        "data": {"plans": plans, "activePlanId": plans[0]["id"]},
    })
    version = None
    for plan in (plans[0], plans[1], plans[0]):
        restored = request(workspace, {
            "action": "restore", "program_id": args.program, "plan_id": plan["id"],
            "expected_board_version": version, "idempotency_key": str(uuid4()),
        })
        version = restored["board"]["version"]
        placed = [row for row in restored["board"]["semesters"] if row["courseIds"]]
        require(placed == plan["semesters"], "Restored course placements changed.")
        require(restored["weeklySchedule"] == plan["weeklySchedule"], "Restored weekly groups changed.")
    reloaded = request(target)
    require(reloaded["revision"] == saved["revision"] and reloaded["data"]["plans"] == plans,
            "Saved alternatives changed after reload.")
    baseline = request(f"{workspace}?{urlencode({**query, 'program_id': args.baseline_program})}")
    require(not baseline["data"]["plans"], "Saved alternatives leaked into the baseline program.")

    course, start, end = args.edit
    for operation, semester in (("add_course", start), ("move_course", end), ("remove_course", None)):
        payload = {
            "operation": operation, "course_id": course, "program_id": args.program,
            "operation_id": str(uuid4()), "expected_board_version": version,
            "academic_status_digest": context["academic_status_digest"],
        }
        if semester:
            payload["semester_id"] = semester
        edited = request("/api/ai/edit-board", payload)
        version = edited["board"]["version"]
        placements = [s["semesterId"] for s in edited["board"]["semesters"] if course in s["courseIds"]]
        require(placements == ([semester] if semester else []), f"Wrong placement after {operation}.")
    print(f"{args.program}: save, A/B/A restore, weekly groups, reload, program isolation, and add/move/remove passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--scope", required=True, help="Vercel team for the preview")
    parser.add_argument("--program", required=True, help="Planner board ID")
    parser.add_argument("--baseline-program", default="mechanical_engineering_2027")
    parser.add_argument("--alternative", nargs=5, action="append", required=True,
                        metavar=("COURSE", "SEMESTER", "ACADEMIC_YEAR", "TERM", "GROUP"))
    parser.add_argument("--edit", nargs=3, required=True, metavar=("COURSE", "START_SEMESTER", "END_SEMESTER"))
    args = parser.parse_args()
    require(len(args.alternative) == 2 and args.alternative[0][0] != args.alternative[1][0],
            "Supply two alternatives with different courses.")
    require(args.program != args.baseline_program, "The baseline program must be different.")
    require(args.edit[0] not in {row[0] for row in args.alternative} and args.edit[1] != args.edit[2],
            "Choose a separate course and two different semesters for the edit.")
    scratch = Path(__file__).resolve().parent.parent / ".tmp"
    scratch.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="degree-smoke-", dir=scratch) as directory:
        smoke(args, Path(directory))


if __name__ == "__main__":
    main()
