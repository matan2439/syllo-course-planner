#!/usr/bin/env python3
"""
Stage 2 LLM Semantic Enrichment — extracts capability evidence from board
syllabus content using claude-haiku-5-5.

Usage
-----
  python3 scripts/stage2_semantic_enrichment.py \\
      --program electrical_engineering_2027 \\
      [--pilot 50]   # process only N courses, sorted by content length desc
      [--dry-run]    # print cost estimate only, do not call the API

Output files
------------
  data/enriched_profiles/stage2_checkpoint_<program>.json
      Per-course results keyed by course_id; resumable across restarts.
  data/enriched_profiles/stage2_review_queue.json
      Claims flagged for human review — excluded from automatic cache merge.

Cost
----
  Full 251-course corpus:  ~$0.063 single pass, ~$0.15 absolute maximum
  50-course pilot:         ~$0.013 single pass, ~$0.030 max
  Model: claude-haiku-5-5 at $0.10/MTok input, $0.50/MTok output (2026-11-19)

IMPORTANT: billable API calls. Obtain explicit authorization before running.
Do NOT merge output automatically; merge requires a separate PR and review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants — must stay in sync with api/ai/semantic_course_extraction.ts
# ---------------------------------------------------------------------------

CAPABILITY_ONTOLOGY = [
    # Mechanical Engineering
    "strength_analysis", "finite_elements", "mechanical_design",
    "heat_transfer", "thermal_systems", "fluids", "control_systems",
    "manufacturing", "materials", "biomechanics", "energy", "robotics",
    # Electrical Engineering
    "signal_processing", "vlsi", "electromagnetics", "communications",
    "ml_ai", "circuits_electronics", "optics_photonics", "bioelectronics",
    "quantum_engineering", "energy_power", "computer_systems",
    # Cross-program
    "general",
]

PROGRAM_CAPABILITIES: dict[str, list[str]] = {
    "electrical_engineering_2027": [
        "signal_processing", "vlsi", "electromagnetics", "communications",
        "ml_ai", "circuits_electronics", "optics_photonics", "bioelectronics",
        "quantum_engineering", "energy_power", "computer_systems",
    ],
    "mechanical_engineering_2027": [
        "strength_analysis", "finite_elements", "mechanical_design",
        "heat_transfer", "thermal_systems", "fluids", "control_systems",
        "manufacturing", "materials", "biomechanics", "energy", "robotics",
    ],
}

BOARD_FILE: dict[str, str] = {
    "electrical_engineering_2027": "data/boards/electrical_engineering_2027.json",
    "mechanical_engineering_2027": "data/boards/mechanical_engineering_2027.json",
}

MODEL = "claude-haiku-5-5"
MAX_RETRIES = 2          # per-course
REVIEW_CONFIDENCE_THRESHOLD = 0.60
MIN_EVIDENCE_CHARS = 20  # shorter spans cannot be reliably verified

# Hard spend limit — the script refuses to start a new API call once cumulative
# cost (input + output tokens at list price) exceeds this. Set via --max-spend.
# Default matches the documented two-pass maximum budget of $0.15 for 251 courses.
DEFAULT_MAX_SPEND_USD = 0.15

CAPABILITY_DESCRIPTIONS: dict[str, str] = {
    # EE
    "signal_processing": "Signal and system analysis, DSP, filters, transforms (FFT, DTFT), spectrum, sampling",
    "vlsi": "VLSI design, digital IC layout, RTL/synthesis, place-and-route, timing analysis",
    "electromagnetics": "Maxwell equations, wave propagation, antennas, RF, microwave, fields",
    "communications": "Modulation, channel coding, communication systems, wireless, networking protocols",
    "ml_ai": "Machine learning, deep learning, neural networks, statistical inference, AI algorithms",
    "circuits_electronics": "Analog/digital circuits, transistors, op-amps, semiconductor devices",
    "optics_photonics": "Optics, lasers, photonics, optical fiber, electro-optics, imaging systems",
    "bioelectronics": "Biomedical electronics, biosensors, neural interfaces, medical devices",
    "quantum_engineering": "Quantum mechanics, quantum computing, quantum optics, quantum information",
    "energy_power": "Power systems, power electronics, converters, motors, smart grid, energy storage",
    "computer_systems": "Computer architecture, OS, compilers, embedded systems, hardware-software",
    # ME
    "strength_analysis": "Mechanics of materials, stress/strain analysis, failure criteria, structural integrity",
    "finite_elements": "FEM, numerical methods for mechanics, structural simulation, mesh generation",
    "mechanical_design": "Machine design, CAD, mechanisms, tolerances, product design methodology",
    "heat_transfer": "Conduction, convection, radiation, thermal analysis, heat exchangers",
    "thermal_systems": "Thermodynamics, thermodynamic cycles, engines, power plants, refrigeration",
    "fluids": "Fluid mechanics, aerodynamics, CFD, pipe flow, turbulence, flow measurement",
    "control_systems": "Feedback control, PID, state-space, stability, Laplace/Z-transform, robotics control",
    "manufacturing": "Manufacturing processes, machining, casting, welding, quality, tolerances",
    "materials": "Materials science, metals, polymers, composites, failure analysis, microstructure",
    "biomechanics": "Biomechanics, orthopaedic engineering, biological tissues, human motion",
    "energy": "Energy conversion, renewables, sustainable systems, efficiency analysis",
    "robotics": "Robotics, kinematics, dynamics, motion planning, robotic systems",
    "general": "General engineering fundamentals (mathematics, physics, project management)",
}

# ---------------------------------------------------------------------------
# Syllabus content — mirrors buildSyllabusSnapshot in syllabus_snapshot.ts
# ---------------------------------------------------------------------------

BOILERPLATE_RE = re.compile(r"שעות:.*?משקל:\s*[\d.]+")
BOILERPLATE_STRIP_RE = re.compile(r"[\s\d\"״׳.:]+")


def _is_boilerplate_only(summary: str) -> bool:
    s = BOILERPLATE_RE.sub("", summary)
    s = BOILERPLATE_STRIP_RE.sub("", s)
    return len(s) <= 3


def build_normalized_content(course: dict[str, Any]) -> str:
    """Mirrors buildSyllabusSnapshot.normalizedContent — verbatim equivalence required."""
    summary = course.get("syllabus_summary_he") or ""
    if not isinstance(summary, str):
        summary = ""

    ai_topics = course.get("syllabus_ai_topics") or []
    topics_he = course.get("syllabus_topics_he") or []
    if isinstance(ai_topics, list):
        topics = " ".join(str(x) for x in ai_topics if x)
    elif isinstance(topics_he, list):
        topics = " ".join(str(x) for x in topics_he if x)
    else:
        topics = ""

    has_summary = bool(summary.strip()) and not _is_boilerplate_only(summary)
    if not has_summary:
        return ""

    combined = " \n ".join(x for x in [summary, topics] if x)
    # Normalize whitespace, mirroring the TS impl
    combined = re.sub(r"[ \t]+", " ", combined)
    combined = re.sub(r" *\n *", " \n ", combined)
    return combined.strip()


def build_extraction_content(course: dict[str, Any]) -> str:
    """Mirrors TypeScript buildSyllabusSnapshot.extractionContent exactly.

    All 7 syllabus fields concatenated with the same whitespace normalization as
    normalizedContent.  This is what the LLM receives AND what evidence spans are
    checked against, so excerpts from prerequisites / assessment / structure are
    accepted rather than rejected as 'not in normalizedContent'.
    """
    summary = course.get("syllabus_summary_he") or ""
    if not isinstance(summary, str):
        summary = ""

    ai_topics = course.get("syllabus_ai_topics") or []
    topics_he = course.get("syllabus_topics_he") or []
    if isinstance(ai_topics, list):
        topics = " ".join(str(x) for x in ai_topics if x)
    elif isinstance(topics_he, list):
        topics = " ".join(str(x) for x in topics_he if x)
    else:
        topics = ""

    prereqs = course.get("syllabus_prerequisites_he") or ""
    if not isinstance(prereqs, str):
        prereqs = ""

    assessment = course.get("syllabus_assessment_he") or ""
    if not isinstance(assessment, str):
        assessment = ""

    structure = course.get("syllabus_structure_he") or ""
    if not isinstance(structure, str):
        structure = ""

    assessment_raw = course.get("assessment_text_raw") or ""
    if not isinstance(assessment_raw, str):
        assessment_raw = ""

    all_parts = [p for p in [summary, topics, prereqs, assessment, structure, assessment_raw] if p]
    if not all_parts:
        return ""
    combined = " \n ".join(all_parts)
    combined = re.sub(r"[ \t]+", " ", combined)
    combined = re.sub(r" *\n *", " \n ", combined)
    return combined.strip()


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Course collection
# ---------------------------------------------------------------------------


def collect_courses(board: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for c in board.get("metadata", {}).get("program_repository_courses", []):
        if not c or not isinstance(c.get("course_id"), str):
            continue
        cid = c["course_id"]
        if cid not in seen:
            seen.add(cid)
            result.append(c)
    for s in board.get("semesters", []):
        for c in s.get("courses", []):
            if not c or not isinstance(c.get("course_id"), str):
                continue
            cid = c["course_id"]
            if cid not in seen:
                seen.add(cid)
                result.append(c)
    return result


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TEMPLATE = """\
You are an academic syllabus analyzer for Tel Aviv University engineering programs.

Your task: given a course syllabus in Hebrew (and sometimes English), extract which of \
the following academic capability areas this course teaches, with evidence from the text.

CAPABILITY DEFINITIONS (use ONLY these identifiers, exact lowercase as shown):
{cap_defs}

OUTPUT SCHEMA (JSON, no markdown fence):
{{
  "courseId": "<course_id>",
  "snapshotHash": "<snapshot_hash>",
  "claims": [
    {{
      "courseId": "<course_id>",
      "capability": "<from the list above>",
      "relationship": "primary" | "secondary" | "absent",
      "strength": <0.0-1.0>,
      "inferenceLevel": "explicit" | "derived" | "estimated" | "missing",
      "confidence": <0.0-1.0>,
      "evidenceSpans": [
        {{
          "excerpt": "<verbatim text from the syllabus, do NOT paraphrase>",
          "section": "summary" | "topics" | "assessment" | "prerequisites" | null,
          "startOffset": <integer or -1 if unknown>,
          "endOffset": <integer or -1 if unknown>
        }}
      ],
      "rationale": "<one sentence Hebrew or English>",
      "unsupportedOrAmbiguous": false,
      "needsHumanReview": false,
      "reviewReason": null
    }}
  ]
}}

RULES:
1. Include ONLY the capabilities relevant to THIS PROGRAM (listed below under "Program scope").
2. Use "explicit" (strength 0.9) ONLY when the syllabus EXPLICITLY names a capability area as a \
learning objective or core topic (e.g. "students will design digital filters", "VLSI layout").
3. Use "derived" (strength 0.6) when the content STRONGLY IMPLIES the capability through \
technical terminology (e.g., multiple relevant technical terms, lab exercises).
4. Use "estimated" (strength 0.3) for weak indirect signals (single incidental term).
5. Use "missing" (strength 0.0) for capabilities clearly NOT present in this course.
6. Include "missing" only for capabilities where you have POSITIVE evidence of absence.
7. EVIDENCE SPANS: Every explicit/derived claim MUST include at least one span. \
The excerpt MUST be copied VERBATIM (character-for-character) from the provided syllabus text. \
Do NOT paraphrase, translate, or summarize.
8. Minimum excerpt length: 20 characters. Use up to 200 characters per span.
9. Set needsHumanReview=true and provide reviewReason when: confidence < 0.6, \
or the evidence is ambiguous, or the Hebrew text is too sparse to judge reliably.
10. Omit capabilities with strength=0.0 (missing) unless you are CERTAIN they are absent.
11. Return ONLY the JSON object — no explanation text, no markdown.

Program scope: {program_capabilities}
"""


def build_system_prompt(program_id: str) -> str:
    caps = PROGRAM_CAPABILITIES.get(program_id, list(CAPABILITY_DESCRIPTIONS.keys()))
    cap_defs = "\n".join(
        f"  {cap}: {CAPABILITY_DESCRIPTIONS.get(cap, '')}"
        for cap in caps
    )
    return SYSTEM_PROMPT_TEMPLATE.format(
        cap_defs=cap_defs,
        program_capabilities=", ".join(caps),
    )


def build_user_message(course: dict[str, Any]) -> tuple[str, str]:
    """Return (user_message_text, extraction_hash).

    Uses build_extraction_content so the LLM receives all 7 syllabus fields and
    the returned extraction_hash matches snapshot.extractionHash on the TS side.
    """
    course_id = course.get("course_id", "")
    name_he = course.get("name_he") or course.get("name", "") or ""
    extraction_content = build_extraction_content(course)
    extraction_hash = sha256_hex(extraction_content)
    msg = (
        f"Course ID: {course_id}\n"
        f"Course name: {name_he}\n"
        f"Snapshot hash: {extraction_hash}\n\n"
        f"Syllabus text:\n{extraction_content}"
    )
    return msg, extraction_hash


# ---------------------------------------------------------------------------
# Human-review flag logic
# ---------------------------------------------------------------------------

HEDGE_PATTERNS = re.compile(
    r"\b(likely|possibly|unclear|perhaps|probably|maybe|לא ברור|ייתכן|אולי|כנראה)\b",
    re.IGNORECASE,
)


def _flag_claim(claim: dict[str, Any], extraction_content: str) -> tuple[bool, str | None]:
    """Return (needs_review, reason) for a single claim.

    Checks excerpts against extraction_content (all 7 fields) rather than the
    narrower normalized_content, so evidence from prerequisites, assessment and
    structure fields is not incorrectly flagged as ungrounded.
    """
    if claim.get("confidence", 1.0) < REVIEW_CONFIDENCE_THRESHOLD:
        return True, f"confidence {claim.get('confidence'):.2f} < {REVIEW_CONFIDENCE_THRESHOLD}"

    spans = claim.get("evidenceSpans") or []
    if not spans and claim.get("inferenceLevel") not in ("missing", "estimated"):
        return True, "no evidence spans for explicit/derived claim"

    for span in spans:
        excerpt = span.get("excerpt", "")
        if len(excerpt) < MIN_EVIDENCE_CHARS:
            return True, f"evidence excerpt too short ({len(excerpt)} chars)"
        if extraction_content and excerpt not in extraction_content:
            return True, "evidence excerpt is not a verbatim substring of snapshot"

    rationale = claim.get("rationale", "")
    if HEDGE_PATTERNS.search(rationale):
        return True, "rationale contains hedging language"

    return False, None


# ---------------------------------------------------------------------------
# Checkpoint management
# ---------------------------------------------------------------------------

CheckpointEntry = dict[str, Any]


def load_checkpoint(path: Path) -> dict[str, CheckpointEntry]:
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_checkpoint(path: Path, data: dict[str, CheckpointEntry]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Cost estimation
# ---------------------------------------------------------------------------

INPUT_PRICE = 0.10 / 1_000_000   # $ per token
OUTPUT_PRICE = 0.50 / 1_000_000  # $ per token
CACHE_WRITE_PRICE = 0.025 / 1_000_000
CACHE_READ_PRICE = 0.01 / 1_000_000
SYS_PROMPT_TOKENS = 760
PER_COURSE_OVERHEAD = 70
OUTPUT_TOKENS_PER_COURSE = 400


def estimate_cost(courses: list[dict[str, Any]]) -> None:
    n = len(courses)
    total_syllabus_chars = sum(
        len(build_extraction_content(c)) for c in courses
    )
    mean_chars = total_syllabus_chars // max(n, 1)
    mean_toks = mean_chars // 2  # Hebrew: ~2 chars/token
    per_course_input = mean_toks + PER_COURSE_OVERHEAD

    cache_write = SYS_PROMPT_TOKENS * CACHE_WRITE_PRICE
    cache_reads = (n - 1) * SYS_PROMPT_TOKENS * CACHE_READ_PRICE
    uncached_input = n * per_course_input * INPUT_PRICE
    output_cost = n * OUTPUT_TOKENS_PER_COURSE * OUTPUT_PRICE
    single_pass = cache_write + cache_reads + uncached_input + output_cost
    max_budget = single_pass * 2 + n * (500 * INPUT_PRICE + 100 * OUTPUT_PRICE)

    print(f"\n=== COST ESTIMATE ===")
    print(f"Courses:            {n}")
    print(f"Mean syllabus:      {mean_chars} chars ≈ {mean_toks} tokens")
    print(f"Per-course input:   {per_course_input} tokens")
    print(f"Single pass:       ~${single_pass:.4f}")
    print(f"Max (2× + valid):  ~${max_budget:.4f}")
    print(f"Model:             {MODEL}")
    print(f"=====================\n")


# ---------------------------------------------------------------------------
# LLM extraction
# ---------------------------------------------------------------------------


def extract_one_course(
    client: Any,
    course: dict[str, Any],
    system_prompt: str,
    is_first_call: bool,
) -> tuple[dict[str, Any], str, int, int]:
    """Call the API for one course.

    Returns (parsed_json, extraction_hash, input_tokens, output_tokens).
    Uses build_extraction_content / build_user_message so the LLM receives all
    7 fields and the snapshotHash in the response equals snapshot.extractionHash.
    """
    import anthropic

    system: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},  # cache the system prompt
        }
    ]

    user_message, extraction_hash = build_user_message(course)

    for attempt in range(MAX_RETRIES + 1):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=800,
                system=system,
                messages=[{"role": "user", "content": user_message}],
            )
            raw = response.content[0].text.strip()
            # Strip markdown fence if the model wrapped it
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            parsed = json.loads(raw)
            input_toks = getattr(response.usage, "input_tokens", 0)
            output_toks = getattr(response.usage, "output_tokens", 0)
            return parsed, extraction_hash, input_toks, output_toks
        except json.JSONDecodeError as e:
            if attempt < MAX_RETRIES:
                time.sleep(1)
                continue
            raise RuntimeError(f"JSON parse failed after {attempt+1} attempts: {e}") from e
        except Exception as e:
            err = str(e)
            if "overloaded" in err.lower() and attempt < MAX_RETRIES:
                time.sleep(5 * (attempt + 1))
                continue
            raise


# ---------------------------------------------------------------------------
# Post-processing: validate spans and flag for review
# ---------------------------------------------------------------------------


def post_process_extraction(
    raw: dict[str, Any],
    course_id: str,
    extraction_content: str,
    program_caps: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Returns (cleaned_extraction, review_items).
    Removes claims outside the program capability set.
    Flags claims requiring human review against extraction_content (all 7 fields).
    """
    review_items: list[dict[str, Any]] = []
    cleaned_claims: list[dict[str, Any]] = []

    for claim in raw.get("claims", []):
        cap = claim.get("capability", "")

        # Drop claims for capabilities outside this program
        if cap not in CAPABILITY_ONTOLOGY:
            continue
        if cap not in program_caps and cap != "general":
            continue

        # Validate and flag against extraction_content
        needs_review, reason = _flag_claim(claim, extraction_content)
        claim["needsHumanReview"] = needs_review
        claim["reviewReason"] = reason

        if needs_review:
            review_items.append({
                "courseId": course_id,
                "capability": cap,
                "reviewReason": reason,
                "claim": claim,
            })

        # Keep all claims in the extraction (the TS validator will re-check spans)
        cleaned_claims.append(claim)

    cleaned = dict(raw)
    cleaned["claims"] = cleaned_claims
    cleaned["courseId"] = course_id  # ensure correct
    return cleaned, review_items


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run(program_id: str, pilot: int | None, dry_run: bool, max_spend_usd: float) -> None:
    repo_root = Path(__file__).parent.parent
    board_path = repo_root / BOARD_FILE[program_id]

    print(f"Loading board: {board_path}")
    with open(board_path, encoding="utf-8") as f:
        board = json.load(f)

    all_courses = collect_courses(board)
    # Filter to courses with any content
    courses_with_content = [
        c for c in all_courses
        if build_extraction_content(c).strip()
    ]
    # Sort by content length descending (process richest first)
    courses_with_content.sort(
        key=lambda c: len(build_extraction_content(c)), reverse=True
    )

    if pilot:
        courses_with_content = courses_with_content[:pilot]

    print(f"Program:  {program_id}")
    print(f"Courses with content: {len(courses_with_content)}")
    print(f"Hard spend limit:     ${max_spend_usd:.4f}")

    estimate_cost(courses_with_content)

    if dry_run:
        print("DRY RUN — no API calls made.")
        return

    # Require explicit authorization env variable before spending money
    if not os.environ.get("STAGE2_AUTHORIZED"):
        print(
            "ERROR: Set STAGE2_AUTHORIZED=1 to confirm you have authorization to\n"
            "       run billable inference. This is intentional friction.\n"
            "       The maximum budget for this run is shown above."
        )
        sys.exit(1)

    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic")
        sys.exit(1)

    client = anthropic.Anthropic()
    system_prompt = build_system_prompt(program_id)
    program_caps = PROGRAM_CAPABILITIES.get(program_id, [])

    checkpoint_path = repo_root / f"data/enriched_profiles/stage2_checkpoint_{program_id}.json"
    review_queue_path = repo_root / "data/enriched_profiles/stage2_review_queue.json"

    checkpoint = load_checkpoint(checkpoint_path)
    review_queue: list[dict[str, Any]] = []
    if review_queue_path.exists():
        try:
            review_queue = json.loads(review_queue_path.read_text())
        except (json.JSONDecodeError, OSError):
            review_queue = []

    processed = 0
    skipped = 0
    failed = 0
    cumulative_spend = 0.0

    for i, course in enumerate(courses_with_content):
        course_id = course["course_id"]

        if course_id in checkpoint and checkpoint[course_id].get("status") == "done":
            skipped += 1
            continue

        extraction_content = build_extraction_content(course)

        # Hard spend limit check before each API call
        if cumulative_spend >= max_spend_usd:
            print(
                f"\nSPEND LIMIT REACHED (${cumulative_spend:.4f} >= ${max_spend_usd:.4f}).\n"
                f"Processed {processed} courses. Resume with: "
                f"python3 scripts/stage2_semantic_enrichment.py --program {program_id} "
                f"[--max-spend N]\n"
                f"Checkpoint saved to: {checkpoint_path}"
            )
            break

        print(f"[{i+1}/{len(courses_with_content)}] {course_id} ({len(extraction_content)} chars, "
              f"spent ${cumulative_spend:.4f}) …", end=" ", flush=True)

        try:
            raw, extraction_hash, input_toks, output_toks = extract_one_course(
                client=client,
                course=course,
                system_prompt=system_prompt,
                is_first_call=(processed == 0 and skipped == 0),
            )

            call_cost = input_toks * INPUT_PRICE + output_toks * OUTPUT_PRICE
            cumulative_spend += call_cost

            cleaned, review_items = post_process_extraction(
                raw, course_id, extraction_content, program_caps
            )

            review_queue.extend(review_items)

            checkpoint[course_id] = {
                "status": "done",
                "extraction": cleaned,
                "snapshot_hash": extraction_hash,  # extractionHash — matches TS side
                "review_items_count": len(review_items),
                "tokens": {"input": input_toks, "output": output_toks},
                "cost_usd": round(call_cost, 6),
            }

            flag_str = f" [{len(review_items)} for review]" if review_items else ""
            claims_str = f"{len(cleaned.get('claims', []))} claims"
            print(f"OK — {claims_str}{flag_str} (${call_cost:.5f})")
            processed += 1

        except Exception as e:
            print(f"FAILED — {e}")
            checkpoint[course_id] = {"status": "failed", "error": str(e)}
            failed += 1

        # Save checkpoint after every course (resumability)
        save_checkpoint(checkpoint_path, checkpoint)
        save_checkpoint(review_queue_path, review_queue)  # type: ignore[arg-type]

    print(f"\n=== DONE ===")
    print(f"Processed: {processed}, Skipped (already done): {skipped}, Failed: {failed}")
    print(f"Total spend: ${cumulative_spend:.4f}")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Review queue: {review_queue_path} ({len(review_queue)} items)")
    print(f"\nNext step: human review of flagged items, then merge PR after approval.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stage 2 LLM semantic enrichment")
    parser.add_argument(
        "--program",
        required=True,
        choices=list(BOARD_FILE.keys()),
        help="Program ID to process",
    )
    parser.add_argument(
        "--pilot",
        type=int,
        default=None,
        metavar="N",
        help="Process only the top N courses by content length",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print cost estimate only, do not call the API",
    )
    parser.add_argument(
        "--max-spend",
        type=float,
        default=DEFAULT_MAX_SPEND_USD,
        metavar="USD",
        help=(
            f"Hard spending limit in USD (default: ${DEFAULT_MAX_SPEND_USD:.2f}). "
            "The script stops before the next API call once this is exceeded."
        ),
    )
    args = parser.parse_args()
    run(args.program, args.pilot, args.dry_run, args.max_spend)
