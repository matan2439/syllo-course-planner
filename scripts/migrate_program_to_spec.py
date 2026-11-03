"""One-off: express a legacy enriched program as data/degrees/<inst>/<base>/<year>/spec.json.

Usage: python scripts/migrate_program_to_spec.py mechanical_engineering_2027
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.degrees.registry import get_program  # noqa: E402
from app.degrees.spec import program_to_spec, spec_path, spec_to_program, write_spec  # noqa: E402


def main(program_id: str) -> None:
    entry = get_program(program_id)
    enriched_path = ROOT / "data" / "programs" / f"{program_id}_enriched.json"
    program = json.loads(enriched_path.read_text(encoding="utf-8"))
    spec = program_to_spec(program, entry)
    if spec_to_program(spec) != program:
        raise SystemExit(f"{program_id}: spec does not round-trip to {enriched_path.name}; not writing.")
    out = spec_path(entry)
    write_spec(spec.model_copy(update={"coverage": {}}), out)
    print(f"wrote {out.relative_to(ROOT)} ({len(spec.mandatory_courses)} mandatory, {len(spec.categories)} categories)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
