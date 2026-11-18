#!/usr/bin/env python3
"""
Full EE + ME academic enrichment pipeline.

Phase 1: Process all courses with existing board content (deterministic, no network).
Phase 2: Fetch missing IMS syllabi (network, rate-limited, optional).
Phase 3: Generate enriched profile JSON files merging new + existing.
Phase 4: Print coverage report.

Constraints:
- Never overwrites profiles extracted by 'captured-review-v1' (hand-reviewed).
- Only assigns 'derived' (0.6) inference level for keyword matches.
- Each extractedEvidence is a verbatim substring of normalizedContent.
- evaluatedCapabilities always contains all program capabilities.
"""

import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

ROOT = Path(__file__).parent.parent
GENERATED_AT = "2026-11-18T00:00:00.000Z"

# ── Capability keyword tables ────────────────────────────────────────────────

CAPABILITY_KEYWORDS: dict[str, list[str]] = {
    'signal_processing': [
        'Z-transform', 'FFT', 'DFT', 'Fourier transform', 'Fourier', 'DTFT', 'STFT',
        'FIR filter', 'IIR filter', 'FIR', 'IIR', 'wavelets', 'wavelet',
        'sampling theorem', 'Nyquist', 'digital filter', 'spectral analysis',
        'signal processing', 'DSP', 'עיבוד אותות', 'פילטר דיגיטלי', 'ספקטרום',
        'ספקטרלי', 'Z-טרנספורמציה', 'ניידקוויסט',
    ],
    'vlsi': [
        'VLSI', 'CMOS', 'Verilog', 'VHDL', 'FPGA', 'RTL', 'chip design',
        'integrated circuit', 'silicon fabrication', 'logic synthesis',
        'placement and routing', 'floor plan', 'שבב', 'מעגל משולב',
        'לוגיקה ספרתית מתקדמת', 'עיצוב שבבים',
    ],
    'electromagnetics': [
        'Maxwell', 'electromagnetic', 'wave propagation', 'transmission line',
        'waveguide', 'antenna', 'אנטנה', 'אנטנות', 'התפשטות גלים',
        'שדה אלקטרומגנטי', 'אלקטרומגנטיקה', 'קו שידור',
    ],
    'communications': [
        'modulation', 'demodulation', 'OFDM', 'channel capacity', 'Shannon',
        'PSK', 'QAM', 'CDMA', 'MIMO', 'wireless communication', 'cellular',
        'אפנון', 'ביטול אפנון', 'קיבולת ערוץ', 'תקשורת אלחוטית',
        'אפנון ספרתי', 'אפנון אנלוגי', 'communication systems',
    ],
    'ml_ai': [
        'machine learning', 'deep learning', 'neural network', 'convolutional',
        'recurrent neural', 'gradient descent', 'backpropagation',
        'support vector machine', 'SVM', 'random forest',
        'למידת מכונה', 'רשתות נוירונים', 'בינה מלאכותית', 'למידה עמוקה',
        'רשת קונבולוציה', 'רשת נוירונים',
    ],
    'circuits_electronics': [
        'transistor', 'MOSFET', 'BJT', 'amplifier', 'op-amp', 'diode',
        'semiconductor device', 'feedback amplifier', 'oscillator',
        'active filter', 'impedance matching', 'differential amplifier',
        'טרנזיסטור', 'מגבר', 'מוליך למחצה', 'מגבר דיפרנציאלי',
        'אלקטרוניקה', 'מעגל אנלוגי',
    ],
    'optics_photonics': [
        'optics', 'photonics', 'laser', 'optical fiber', 'LED',
        'photodetector', 'diffraction', 'interference', 'holography',
        'אופטיקה', 'פוטוניקה', 'לייזר', 'סיב אופטי', 'עדשה',
    ],
    'bioelectronics': [
        'bioelectronics', 'biosignal', 'EEG', 'ECG', 'EMG',
        'medical instrumentation', 'neural recording', 'biopotential',
        'ביואלקטרוניקה', 'אותות ביולוגיים', 'רישום עצבי',
    ],
    'quantum_engineering': [
        'quantum computing', 'qubit', 'quantum mechanics', 'superposition',
        'entanglement', 'quantum dot', 'spin qubit', 'quantum gate',
        'קוונטי', 'קיוביט', 'סופרפוזיציה', 'שזירה קוונטית',
    ],
    'energy_power': [
        'power electronics', 'converter', 'inverter', 'electric motor',
        'renewable energy', 'solar energy', 'wind energy', 'power system',
        'AC/DC', 'DC/DC', 'buck converter', 'boost converter',
        'אלקטרוניקה של כוח', 'המרת כוח', 'מנוע חשמלי', 'אנרגיה מתחדשת',
        'אנרגיה סולארית', 'ממיר',
    ],
    'computer_systems': [
        'computer architecture', 'instruction set', 'pipeline processor',
        'cache memory', 'operating system', 'embedded system',
        'microprocessor', 'memory hierarchy', 'RISC', 'interrupt',
        'ארכיטקטורת מחשב', 'מערכות מוטמעות', 'מעבד', 'מערכות הפעלה',
        'סט פקודות', 'זיכרון מטמון', 'טיפול בהפרעות',
    ],
    'mechanical_design': [
        'mechanism design', 'kinematics', 'dynamics of machines', 'CAD',
        'SolidWorks', 'CATIA', 'gear', 'bearing', 'linkage', 'cam',
        'machine element', 'תכנון מכני', 'מנגנון', 'קינמטיקה',
        'דינמיקה של מכונות', 'אלמנט מכני', 'הילוכים', 'מסבים',
    ],
    'strength_analysis': [
        'stress analysis', 'strain', 'mechanics of materials', 'elasticity',
        'plasticity', 'fatigue', 'fracture mechanics', 'creep', 'yield',
        'מכניקה של חומרים', 'אלסטיות', 'פלסטיות', 'עייפות חומרים',
        'מכניקת שבר', 'כניעה', 'מאמץ', 'מתח',
    ],
    'finite_elements': [
        'finite element', 'FEM', 'FEA', 'mesh generation', 'Galerkin',
        'stiffness matrix', 'variational formulation', 'element type',
        'אלמנטים סופיים', 'רשת אלמנטים', 'מטריצת קשיחות',
    ],
    'heat_transfer': [
        'heat transfer', 'conduction', 'convection', 'radiation heat',
        'thermal conductivity', 'heat exchanger', 'Fourier law',
        'Newton cooling', 'Biot number',
        'מעבר חום', 'הולכה', 'הסעה', 'קרינה תרמית', 'מחליף חום',
        'מוליכות תרמית',
    ],
    'thermal_systems': [
        'thermodynamics', 'entropy', 'enthalpy', 'Carnot', 'heat engine',
        'refrigeration cycle', 'gas turbine', 'Rankine cycle', 'compressor',
        'תרמודינמיקה', 'אנטרופיה', 'אנטלפיה', 'מנוע חום', 'קירור',
        'מחזור קרנו',
    ],
    'fluids': [
        'fluid mechanics', 'viscosity', 'turbulence', 'laminar flow',
        'Navier-Stokes', 'Reynolds number', 'Bernoulli', 'boundary layer',
        'compressible flow', 'aerodynamics',
        'מכניקת זורמים', 'צמיגות', 'סוערות', 'זרימה למינרית',
        'מספר ריינולדס', 'ברנולי', 'שכבת גבול',
    ],
    'control_systems': [
        'feedback control', 'PID controller', 'transfer function', 'root locus',
        'Bode diagram', 'Nyquist', 'state space', 'stability analysis',
        'controller design', 'closed loop',
        'בקרה', 'משוב', 'פונקציית העברה', 'שורש עקום', 'יציבות',
        'מרחב מצב', 'עיצוב בקר',
    ],
    'manufacturing': [
        'machining', 'CNC', 'cutting tool', 'material removal', 'casting',
        'forging', 'welding', 'surface roughness', 'tolerance', 'process planning',
        'עיבוד שבבי', 'ריתוך', 'יציקה', 'חיתוך', 'עיבוד שטח',
        'תכנון תהליך', 'כלי חיתוך',
    ],
    'materials': [
        'microstructure', 'phase diagram', 'crystal structure', 'metallurgy',
        'polymer', 'composite material', 'ceramics', 'diffusion', 'heat treatment',
        'alloy', 'mechanical properties',
        'מיקרו-מבנה', 'דיאגרמת פאזות', 'מתכות', 'פולימרים',
        'חומר מרוכב', 'קרמיקה', 'טיפול חום', 'סגסוגת',
    ],
    'biomechanics': [
        'biomechanics', 'biological tissue', 'bone mechanics', 'muscle',
        'cartilage', 'prosthetic', 'implant', 'gait analysis', 'orthopedic',
        'ביומכניקה', 'עצם', 'רקמה ביולוגית', 'תותב', 'שתל',
    ],
    'energy': [
        'renewable energy', 'solar energy', 'wind energy', 'energy conversion',
        'sustainability', 'energy storage', 'fuel cell', 'photovoltaic',
        'אנרגיה מתחדשת', 'אנרגיה סולארית', 'אנרגיית רוח', 'המרת אנרגיה',
        'קיימות', 'תא דלק',
    ],
    'robotics': [
        'robotic arm', 'degrees of freedom', 'robot trajectory', 'workspace',
        'kinematics of robot', 'robot dynamics', 'automation',
        'רובוטיקה', 'זרוע רובוטית', 'דרגות חופש', 'מסלול רובוט',
        'רובוט תעשייתי', 'אוטומציה',
    ],
}

PROGRAM_CAPABILITIES: dict[str, list[str]] = {
    'electrical_engineering_2027': [
        'signal_processing', 'vlsi', 'electromagnetics', 'communications',
        'ml_ai', 'circuits_electronics', 'optics_photonics', 'bioelectronics',
        'quantum_engineering', 'energy_power', 'computer_systems',
    ],
    'mechanical_engineering_2027': [
        'mechanical_design',
    ],
}

# ── Snapshot normalization (matches syllabus_snapshot.ts) ───────────────────

_BOILERPLATE_HOURS_RE = re.compile(r'שעות:.*?משקל:\s*[\d.]+', re.DOTALL)
_BOILERPLATE_REMAINING_RE = re.compile(r'[\s\d"״׳.:]')


def is_boilerplate_only(summary: str) -> bool:
    cleaned = _BOILERPLATE_HOURS_RE.sub('', summary)
    cleaned = _BOILERPLATE_REMAINING_RE.sub('', cleaned)
    return len(cleaned) <= 3


def normalize_content(course: dict) -> str:
    summary = course.get('syllabus_summary_he') or ''
    if not isinstance(summary, str):
        summary = ''
    topics_list = course.get('syllabus_ai_topics') or course.get('syllabus_topics_he') or []
    topics = ' '.join(topics_list) if isinstance(topics_list, list) else ''
    has_summary = bool(summary.strip()) and not is_boilerplate_only(summary)
    if not has_summary:
        return ''
    parts = [p for p in [summary, topics] if p]
    joined = ' \n '.join(parts)
    # Match JS: replace [ \t]+ with ' ', then ' *\n *' with ' \n '
    joined = re.sub(r'[ \t]+', ' ', joined)
    joined = re.sub(r' *\n *', ' \n ', joined)
    return joined.strip()


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


# ── Excerpt extraction ───────────────────────────────────────────────────────

def extract_excerpt(content: str, keyword: str, max_len: int = 150) -> str:
    idx = content.find(keyword)
    if idx < 0:
        return ''
    start = max(0, idx - 30)
    for sep in ['. ', '.\n', ':\n', ': ', '\n']:
        bi = content.rfind(sep, 0, idx)
        if bi >= 0 and idx - bi < 60:
            start = bi + len(sep)
            break
    end = min(len(content), idx + len(keyword) + 100)
    for sep in ['. ', '.\n', '\n', ',']:
        ei = content.find(sep, idx + len(keyword))
        if ei >= 0 and ei - idx < 150:
            end = ei
            break
    excerpt = content[start:end].strip()
    if len(excerpt) > max_len:
        excerpt = excerpt[:max_len].rsplit(' ', 1)[0]
    # Guarantee keyword is present
    if keyword not in excerpt:
        # Fall back to minimal excerpt centered on keyword
        s2 = max(0, idx - 10)
        e2 = min(len(content), idx + len(keyword) + 40)
        excerpt = content[s2:e2].strip()
    return excerpt


# ── Deterministic extraction ─────────────────────────────────────────────────

def extract_capability(
    content: str,
    capability: str,
    course_id: str,
    source_url: Optional[str],
    source_year: Optional[int],
    retrieved_at: Optional[str],
) -> Optional[dict]:
    keywords = CAPABILITY_KEYWORDS.get(capability, [])
    for kw in keywords:
        if kw in content:
            excerpt = extract_excerpt(content, kw)
            if not excerpt or kw not in excerpt:
                # Minimal safe excerpt
                idx = content.find(kw)
                excerpt = content[idx: idx + len(kw) + 60].strip()
            # Verify verbatim
            if kw not in content or excerpt not in content:
                continue
            return {
                'courseId': course_id,
                'capability': capability,
                'claim': f'Course syllabus contains explicit reference to "{kw}" — evidence for {capability}.',
                'strength': 0.6,
                'sourceType': 'official_syllabus',
                'sourceUrl': source_url,
                'sourceAuthority': 'tau_official_syllabus',
                'sourceYear': source_year,
                'extractedEvidence': excerpt,
                'inferenceLevel': 'derived',
                'confidence': 0.6,
                'retrievedAt': retrieved_at,
            }
    return None


# ── Board loading ────────────────────────────────────────────────────────────

def load_board_courses(board_path: Path) -> dict[str, dict]:
    with open(board_path, encoding='utf-8') as f:
        board = json.load(f)
    courses: dict[str, dict] = {}
    for s in board.get('semesters', []):
        for c in s.get('courses', []):
            cid = c.get('course_id')
            if cid:
                courses[cid] = c
    for c in board.get('metadata', {}).get('program_repository_courses', []):
        cid = c.get('course_id')
        if cid:
            courses[cid] = c
    return courses


# ── IMS fetch ────────────────────────────────────────────────────────────────

def fetch_ims_content(course_id: str) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """Fetch IMS syllabus page. Returns (content, url, year) or (None, None, None)."""
    if not HAS_REQUESTS:
        return None, None, None
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return None, None, None

    for year in [2026, 2025]:
        url = f'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course={course_id}&year={year}'
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code != 200:
                continue
            soup = BeautifulSoup(resp.content, 'html.parser')
            # Try multiple selectors
            body = None
            for sel in ['.syllabus-body', '#ContentPlaceHolder1_pnlSyllabus',
                        '.course-syllabus', '#syllabus', 'table']:
                el = soup.select_one(sel)
                if el:
                    body = el.get_text(separator=' ', strip=True)
                    break
            if not body:
                body = soup.get_text(separator=' ', strip=True)
            body = re.sub(r'\s+', ' ', body).strip()
            if len(body) < 60 or is_boilerplate_only(body):
                continue
            return body, url, year
        except Exception:
            pass
        time.sleep(1)
    return None, None, None


# ── Profile generation ───────────────────────────────────────────────────────

def build_profile(
    course_id: str,
    content: str,
    capabilities: list[str],
    source_url: Optional[str],
    source_year: Optional[int],
    retrieved_at: Optional[str],
) -> dict:
    snapshot_hash = sha256(content)
    evidence = []
    for cap in capabilities:
        ev = extract_capability(content, cap, course_id, source_url, source_year, retrieved_at)
        if ev:
            evidence.append(ev)
    return {
        'courseId': course_id,
        'snapshotHash': snapshot_hash,
        'schemaVersion': '1',
        'ontologyVersion': '1',
        'extractorVersion': '1',
        'extractorName': 'deterministic-v1',
        'extractorKind': 'captured',
        'evaluatedCapabilities': capabilities,
        'evidence': evidence,
        'quarantined': False,
        'createdAt': GENERATED_AT,
    }


# ── Main pipeline ────────────────────────────────────────────────────────────

PROGRAMS = [
    {
        'id': 'electrical_engineering_2027',
        'board': ROOT / 'data/boards/electrical_engineering_2027.json',
        'profile': ROOT / 'data/enriched_profiles/electrical_engineering_2027.json',
        'capabilities': PROGRAM_CAPABILITIES['electrical_engineering_2027'],
    },
    {
        'id': 'mechanical_engineering_2027',
        'board': ROOT / 'data/boards/mechanical_engineering_2027.json',
        'profile': ROOT / 'data/enriched_profiles/mechanical_engineering_2027.json',
        'capabilities': PROGRAM_CAPABILITIES['mechanical_engineering_2027'],
    },
]


def run_pipeline(fetch_missing: bool = False) -> None:
    total_summary: list[str] = []

    for prog in PROGRAMS:
        prog_id = prog['id']
        capabilities = prog['capabilities']
        print(f'\n{"="*60}')
        print(f'Program: {prog_id}')
        print(f'{"="*60}')

        # Load board
        courses = load_board_courses(prog['board'])
        print(f'  Total courses in board: {len(courses)}')

        # Load existing profiles
        with open(prog['profile'], encoding='utf-8') as f:
            existing = json.load(f)
        existing_profiles: dict[str, dict] = existing.get('profiles', {})
        protected_ids = {
            cid for cid, p in existing_profiles.items()
            if p.get('extractorName') == 'captured-review-v1'
        }
        print(f'  Existing profiles: {len(existing_profiles)} ({len(protected_ids)} hand-reviewed, protected)')

        new_profiles: dict[str, dict] = {}
        stats = {
            'with_content': 0,
            'no_content': 0,
            'skipped_protected': 0,
            'skipped_already': 0,
            'enriched': 0,
            'fetch_attempted': 0,
            'fetch_ok': 0,
            'fetch_fail': 0,
            'evidence_found': 0,
        }

        for course_id, course in sorted(courses.items()):
            # Never overwrite hand-reviewed
            if course_id in protected_ids:
                stats['skipped_protected'] += 1
                continue

            # Skip if already enriched by deterministic-v1 (unless we want refresh)
            if course_id in existing_profiles and existing_profiles[course_id].get('extractorName') == 'deterministic-v1':
                stats['skipped_already'] += 1
                continue

            content = normalize_content(course)
            source_url = course.get('syllabus_source_url') or course.get('syllabus_url')
            retrieved_at = course.get('syllabus_last_fetched_at')
            source_year = None
            if source_url:
                m = re.search(r'year=(\d{4})', source_url)
                if m:
                    source_year = int(m.group(1))

            if not content and fetch_missing:
                stats['fetch_attempted'] += 1
                fetched_content, fetched_url, fetched_year = fetch_ims_content(course_id)
                time.sleep(1)
                if fetched_content:
                    content = normalize_content({'syllabus_summary_he': fetched_content})
                    if content:
                        stats['fetch_ok'] += 1
                        source_url = fetched_url
                        source_year = fetched_year
                        retrieved_at = GENERATED_AT
                        print(f'    FETCHED {course_id}: {len(content)} chars')
                    else:
                        stats['fetch_fail'] += 1
                else:
                    stats['fetch_fail'] += 1

            if not content:
                stats['no_content'] += 1
                continue

            stats['with_content'] += 1
            profile = build_profile(course_id, content, capabilities, source_url, source_year, retrieved_at)

            # Verify all evidence excerpts are verbatim in content
            valid_evidence = []
            for ev in profile['evidence']:
                excerpt = ev.get('extractedEvidence', '')
                if excerpt and excerpt in content:
                    valid_evidence.append(ev)
                else:
                    print(f'    WARNING: {course_id} {ev["capability"]} excerpt not in content, dropping')
            profile['evidence'] = valid_evidence

            if profile['evidence']:
                stats['evidence_found'] += 1

            new_profiles[course_id] = profile
            stats['enriched'] += 1

        # Merge: existing protected + existing deterministic-v1 (from previous run) + new
        merged: dict[str, dict] = {}
        # Keep all existing
        for cid, p in existing_profiles.items():
            merged[cid] = p
        # Add/update new deterministic profiles
        for cid, p in new_profiles.items():
            merged[cid] = p

        # Build output file
        output = {
            'programOrCatalog': prog_id,
            'generatedAt': GENERATED_AT,
            'schemaVersion': '1',
            'ontologyVersion': '1',
            'extractorVersion': '1',
            'extractorName': 'deterministic-v1',
            'extractorKind': 'captured',
            'profiles': merged,
            'runDiagnostics': {
                'totalCourses': len(courses),
                'totalProfilesInFile': len(merged),
                'handReviewedProfiles': len(protected_ids),
                'newlyEnriched': stats['enriched'],
                'skippedNoContent': stats['no_content'],
                'skippedProtected': stats['skipped_protected'],
                'skippedAlreadyEnriched': stats['skipped_already'],
                'fetchAttempted': stats['fetch_attempted'],
                'fetchOk': stats['fetch_ok'],
                'fetchFail': stats['fetch_fail'],
                'withEvidence': stats['evidence_found'],
            },
        }

        with open(prog['profile'], 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        pct = round(len(merged) / len(courses) * 100, 1) if courses else 0
        ev_pct = round(stats['evidence_found'] / stats['with_content'] * 100, 1) if stats['with_content'] else 0
        print(f'  Profiles in file: {len(merged)} / {len(courses)} ({pct}%)')
        print(f'  Newly enriched: {stats["enriched"]} ({stats["evidence_found"]} with evidence, {ev_pct}%)')
        print(f'  No content: {stats["no_content"]} | Protected: {stats["skipped_protected"]} | Already done: {stats["skipped_already"]}')
        if fetch_missing:
            print(f'  IMS fetch: {stats["fetch_ok"]} OK / {stats["fetch_fail"]} failed')
        total_summary.append(
            f'{prog_id}: {len(merged)}/{len(courses)} profiles ({pct}%), {stats["evidence_found"]} with keyword evidence'
        )

    print(f'\n{"="*60}')
    print('PIPELINE COMPLETE — SUMMARY')
    print(f'{"="*60}')
    for line in total_summary:
        print(f'  {line}')


if __name__ == '__main__':
    fetch = '--fetch' in sys.argv
    if fetch and not HAS_REQUESTS:
        print('ERROR: --fetch requires the requests library. pip install requests beautifulsoup4')
        sys.exit(1)
    run_pipeline(fetch_missing=fetch)
