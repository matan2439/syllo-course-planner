"""Golden master: `degree.py build` rebuilds the committed ME boards exactly (spec + facts + overlay)."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.analysis.board_audit import compute_board_hash  # noqa: E402
from app.degrees.registry import get_program  # noqa: E402

PROGRAM = "mechanical_engineering_2027"


def _gitignored_inputs_missing() -> str | None:
    raw = ROOT / "data" / "raw_html"
    if not (ROOT / "data" / "database.sqlite").exists():
        return "data/database.sqlite"
    if not raw.is_dir() or not any(p.name != ".gitkeep" for p in raw.iterdir()):
        return "data/raw_html/"
    return None


def _first_diffs(a, b, path="", out=None, limit=15):
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}.{k}: {'missing in build' if k not in a else 'extra in build'}")
            else:
                _first_diffs(a[k], b[k], f"{path}.{k}", out, limit)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            label = x.get("course_id") or x.get("semester_id") or x.get("category_id") if isinstance(x, dict) else None
            _first_diffs(x, y, f"{path}[{label or i}]", out, limit)
    elif a != b:
        out.append(f"{path}: build={json.dumps(a, ensure_ascii=False)[:120]} "
                   f"committed={json.dumps(b, ensure_ascii=False)[:120]}")
    return out


def _build(out_dir):
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "degree.py"), "build", "--program", PROGRAM,
         "--offline", "--out-dir", str(out_dir)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def test_offline_build_reproduces_committed_me_boards(tmp_path):
    missing = _gitignored_inputs_missing()
    if missing:
        pytest.skip(f"golden build needs gitignored local inputs ({missing} absent, e.g. in CI)")

    entry = get_program(PROGRAM)
    committed = degree.board_paths(entry)
    out_paths = degree.board_paths(entry, data_dir=tmp_path)
    for name, src in committed.items():
        out_paths[name].parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out_paths[name])

    proc = _build(tmp_path)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]

    for name, src in committed.items():
        built = json.loads(out_paths[name].read_text(encoding="utf-8"))
        expected = json.loads(src.read_text(encoding="utf-8"))
        nb, ne = degree.normalize_board(built), degree.normalize_board(expected)
        assert nb == ne, f"{name} differs:\n" + "\n".join(_first_diffs(nb, ne))

        # Byte-level: a rebuild into data/ leaves `git diff` empty (same key order, number
        # spelling, offline fetch timestamps, and board_data_version = hash of that content).
        built_lines = out_paths[name].read_text(encoding="utf-8").splitlines()
        committed_lines = src.read_text(encoding="utf-8").splitlines()
        assert out_paths[name].read_bytes().endswith(b"\n") == src.read_bytes().endswith(b"\n"), name
        if built_lines != committed_lines:
            first = next(i for i, (a, b) in enumerate(zip(built_lines + [None], committed_lines + [None])) if a != b)
            pytest.fail(f"{name}: text differs at line {first + 1}:\n  build:     {built_lines[first:first + 1]}\n"
                        f"  committed: {committed_lines[first:first + 1]}")

    # The Years 1-2 course index is regenerated from the built window board, byte-for-byte.
    built_index = degree.early_index_path(tmp_path).read_text(encoding="utf-8")
    assert built_index == degree.early_index_path().read_text(encoding="utf-8")

    # Every stored board_data_version is the hash of exactly the content written.
    first = {name: p.read_bytes() for name, p in out_paths.items()}
    for name, p in out_paths.items():
        board = json.loads(p.read_text(encoding="utf-8"))
        assert board["metadata"]["board_data_version"] == compute_board_hash(board), name

    # Idempotence: a second offline build over the first one's output changes nothing.
    proc = _build(tmp_path)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    for name, p in out_paths.items():
        assert p.read_bytes() == first[name], f"{name} changed on a second offline build"


def test_normalize_board_drops_only_version_and_timestamps():
    board = {
        "metadata": {"board_data_version": "x", "total_courses": 1,
                     "program_repository_courses": [{"course_id": "a", "syllabus_last_fetched_at": "t",
                                                     "syllabus_url": "u"}]},
        "semesters": [{"semester_id": "s", "courses": [{"course_id": "b", "syllabus_last_fetched_at": "t"}]}],
    }
    assert degree.normalize_board(board) == {
        "metadata": {"total_courses": 1, "program_repository_courses": [{"course_id": "a", "syllabus_url": "u"}]},
        "semesters": [{"semester_id": "s", "courses": [{"course_id": "b"}]}],
    }
    assert board["metadata"]["board_data_version"] == "x"  # input untouched


def test_board_paths_follow_registry():
    entry = get_program(PROGRAM)
    paths = degree.board_paths(entry)
    assert paths["semester_board"] == ROOT / "data" / "parsed_json" / "mechanical_semester_board_2027.json"
    assert paths["board"] == ROOT / "data" / "boards" / "mechanical_engineering_2027.json"
    assert paths["early_years"] == ROOT / "data" / "boards" / "mechanical_engineering_years_1_2_2027.json"
