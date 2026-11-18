#!/usr/bin/env python3
"""
Full EE + ME academic enrichment pipeline.

Phase 1: Process all courses with existing board content (deterministic, no network).
Phase 2: Merge new profiles with existing — never overwrites 'captured-review-v1'.
Phase 3: Print four-tier coverage report.

Quality rules:
- Single keyword match in a course -> 'estimated' (strength 0.3)
- Two or more keyword matches -> 'derived' (strength 0.6)
- Hand-reviewed ('captured-review-v1') -> keep as-is ('explicit' at 0.9)
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).parent.parent
GENERATED_AT = datetime.now(timezone.utc).isoformat().replace('+00:00', '.000Z')

SCHEMA_VERSION = "1"
ONTOLOGY_VERSION = "1"
EXTRACTOR_VERSION = "1"
EXTRACTOR_NAME = "deterministic-v1"
EXTRACTOR_KIND = "captured"

CAPABILITY_KEYWORDS = {
    'signal_processing': [
        'Z-transform', 'FFT', 'DFT', 'Fourier transform', 'Fourier', 'DTFT', 'STFT',
        'FIR filter', 'IIR filter', 'FIR', 'IIR', 'wavelets', 'wavelet',
        'sampling theorem', 'Nyquist', 'digital filter', 'spectral analysis',
        'signal processing', 'DSP', 'עיבוד אותות',
        'פילטר דיגיטלי',
        'ספקטרום', 'ספקטרלי',
    ],
    'vlsi': [
        'VLSI', 'CMOS', 'Verilog', 'VHDL', 'FPGA', 'RTL', 'chip design',
        'integrated circuit', 'silicon fabrication', 'logic synthesis',
        'placement and routing', 'floor plan',
        'שבב', 'מעגל משולב',
        'עיצוב שבבים',
    ],
    'electromagnetics': [
        'Maxwell', 'electromagnetic', 'wave propagation', 'transmission line',
        'waveguide', 'antenna',
        'אנטנה', 'אנטנות',
        'אלקטרומגנטיקה',
        'קו שידור',
    ],
    'communications': [
        'modulation', 'demodulation', 'OFDM', 'channel capacity', 'Shannon',
        'PSK', 'QAM', 'CDMA', 'MIMO', 'wireless communication', 'cellular',
        'אפנון', 'קיבולת ערוץ',
        'תקשורת אלחוטית',
        'communication systems',
    ],
    'ml_ai': [
        'machine learning', 'deep learning', 'neural network', 'convolutional',
        'recurrent neural', 'gradient descent', 'backpropagation',
        'support vector machine', 'SVM', 'random forest',
        'למידת מכונה',
        'רשתות נוירונים',
        'בינה מלאכותית',
        'למידה עמוקה',
    ],
    'circuits_electronics': [
        'transistor', 'MOSFET', 'BJT', 'amplifier', 'op-amp', 'diode',
        'semiconductor device', 'feedback amplifier', 'oscillator',
        'active filter', 'differential amplifier',
        'טרנזיסטור',
        'מגבר', 'מוליך למחצה',
        'אלקטרוניקה',
        'מעגל אנלוגי',
    ],
    'optics_photonics': [
        'optics', 'photonics', 'laser', 'optical fiber', 'LED',
        'photodetector', 'diffraction', 'interference', 'holography',
        'אופטיקה', 'פוטוניקה',
        'לייזר', 'סיב אופטי',
    ],
    'bioelectronics': [
        'bioelectronics', 'biosignal', 'EEG', 'ECG', 'EMG',
        'medical instrumentation', 'neural recording', 'biopotential',
        'ביואלקטרוניקה',
        'אותות ביולוגיים',
    ],
    'quantum_engineering': [
        'quantum computing', 'qubit', 'quantum mechanics', 'superposition',
        'entanglement', 'quantum dot', 'spin qubit', 'quantum gate',
        'קוונטי', 'קיוביט',
        'סופרפוזיציה',
    ],
    'energy_power': [
        'power electronics', 'converter', 'inverter', 'electric motor',
        'renewable energy', 'solar energy', 'wind energy', 'power system',
        'buck converter', 'boost converter',
        'אלקטרוניקה של כוח',
        'מנוע חשמלי', 'ממיר',
    ],
    'computer_systems': [
        'computer architecture', 'instruction set', 'pipeline processor',
        'cache memory', 'operating system', 'embedded system',
        'microprocessor', 'memory hierarchy', 'RISC', 'interrupt',
        'ארכיטקטורת מחשב',
        'מערכות מוטמעות',
        'מערכות הפעלה',
    ],
    'mechanical_design': [
        'mechanism design', 'kinematics', 'dynamics of machines', 'CAD',
        'SolidWorks', 'CATIA', 'gear', 'bearing', 'linkage', 'cam',
        'machine element',
        'תכנון מכני',
        'מנגנון', 'קינמטיקה',
        'אלמנט מכני', 'מסבים',
    ],
    'strength_analysis': [
        'stress analysis', 'strain', 'mechanics of materials', 'elasticity',
        'plasticity', 'fatigue', 'fracture mechanics', 'creep', 'yield',
        'מכניקה של חומרים',
        'אלסטיות', 'פלסטיות',
        'מכניקת שבר', 'מאמץ',
    ],
    'finite_elements': [
        'finite element', 'FEM', 'FEA', 'mesh generation', 'Galerkin',
        'stiffness matrix', 'variational formulation',
        'אלמנטים סופיים',
        'מטריצת קשיחות',
    ],
    'heat_transfer': [
        'heat transfer', 'conduction', 'convection', 'radiation heat',
        'thermal conductivity', 'heat exchanger', 'Fourier law', 'Newton cooling',
        'מעבר חום', 'הולכה',
        'הסעה', 'מחליף חום',
        'מוליכות תרמית',
    ],
    'thermal_systems': [
        'thermodynamics', 'entropy', 'enthalpy', 'Carnot', 'heat engine',
        'refrigeration cycle', 'gas turbine', 'Rankine cycle', 'compressor',
        'תרמודינמיקה',
        'אנטרופיה', 'אנטלפיה',
        'מנוע חום', 'מחזור קרנו',
    ],
    'fluids': [
        'fluid mechanics', 'viscosity', 'turbulence', 'laminar flow',
        'Navier-Stokes', 'Reynolds number', 'Bernoulli', 'boundary layer',
        'compressible flow', 'aerodynamics',
        'מכניקת זורמים',
        'צמיגות', 'זרימה למינרית',
        'מספר ריינולדס', 'ברנולי',
    ],
    'control_systems': [
        'feedback control', 'PID controller', 'transfer function', 'root locus',
        'Bode diagram', 'Nyquist', 'state space', 'stability analysis',
        'controller design', 'closed loop',
        'בקרה', 'משוב',
        'פונקציית העברה',
        'יציבות', 'מרחב מצב',
    ],
    'manufacturing': [
        'machining', 'CNC', 'cutting tool', 'material removal', 'casting',
        'forging', 'welding', 'surface roughness', 'tolerance', 'process planning',
        'עיבוד שבבי', 'ריתוך',
        'יציקה', 'כלי חיתוך',
        'תכנון תהליך',
    ],
    'materials': [
        'microstructure', 'phase diagram', 'crystal structure', 'metallurgy',
        'polymer', 'composite material', 'ceramics', 'diffusion', 'heat treatment',
        'alloy', 'mechanical properties',
        'מיקרו-מבנה',
        'דיאגרמת פאזות',
        'מתכות', 'פולימרים',
        'חומר מרוכב', 'קרמיקה',
        'טיפול חום', 'סגסוגת',
    ],
    'biomechanics': [
        'biomechanics', 'biological tissue', 'bone mechanics', 'muscle',
        'cartilage', 'prosthetic', 'implant', 'gait analysis', 'orthopedic',
        'ביומכניקה',
        'עצם', 'רקמה ביולוגית',
        'תותב', 'שתל',
    ],
    'energy': [
        'renewable energy', 'solar energy', 'wind energy', 'energy conversion',
        'sustainability', 'energy storage', 'fuel cell', 'photovoltaic',
        'אנרגיה מתחדשת',
        'אנרגיה סולרית',
        'אנרגיית רוח',
        'המרת אנרגיה', 'תא דלק',
    ],
    'robotics': [
        'robotic arm', 'degrees of freedom', 'robot trajectory', 'workspace',
        'kinematics of robot', 'robot dynamics', 'automation',
        'רובוטיקה',
        'זרוע רובוטית',
        'דרגות חופש',
        'רובוט תעשייתי', 'אוטומציה',
    ],
}

PROGRAM_CAPABILITIES = {
    'electrical_engineering_2027': [
        'signal_processing', 'vlsi', 'electromagnetics', 'communications',
        'ml_ai', 'circuits_electronics', 'optics_photonics', 'bioelectronics',
        'quantum_engineering', 'energy_power', 'computer_systems',
    ],
    'mechanical_engineering_2027': [
        'strength_analysis', 'finite_elements', 'mechanical_design',
        'heat_transfer', 'thermal_systems', 'fluids', 'control_systems',
        'manufacturing', 'materials', 'biomechanics', 'energy', 'robotics',
    ],
}

_BOILERPLATE_HOURS_RE = re.compile(r'שעות:.*?משקל:\s*[\d.]+', re.DOTALL)
_BOILERPLATE_REMAINING_RE = re.compile(r'[\s\d\'"״׳.:]')


def is_boilerplate_only(summary):
    cleaned = _BOILERPLATE_HOURS_RE.sub('', summary)
    cleaned = _BOILERPLATE_REMAINING_RE.sub('', cleaned)
    return len(cleaned) <= 3


def sha256_hex(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def build_snapshot(course, program_id):
    summary = course.get('syllabus_summary_he') or ''
    topics_arr = course.get('syllabus_ai_topics') or course.get('syllabus_topics_he') or []
    topics = ' '.join(topics_arr) if isinstance(topics_arr, list) else str(topics_arr)

    has_summary = bool(summary.strip()) and not is_boilerplate_only(summary)
    if not has_summary:
        normalized = ''
    else:
        parts = [p for p in [summary, topics] if p]
        normalized = ' \n '.join(parts)
        normalized = re.sub(r'[ \t]+', ' ', normalized)
        normalized = re.sub(r' *\n *', ' \n ', normalized)
        normalized = normalized.strip()

    source_url = course.get('syllabus_source_url') or course.get('syllabus_url')
    year_match = re.search(r'year=(\d{4})', source_url) if source_url else None

    return {
        'courseId': course.get('course_id', ''),
        'normalizedContent': normalized,
        'contentHash': sha256_hex(normalized),
        'hasContent': bool(normalized),
        'sourceUrl': source_url if normalized else None,
        'sourceYear': int(year_match.group(1)) if year_match and normalized else None,
        'retrievedAt': course.get('syllabus_last_fetched_at') if normalized else None,
    }


def find_evidence_spans(text, keywords):
    spans = []
    seen = set()
    for kw in keywords:
        idx = text.find(kw)
        if idx == -1:
            idx = text.lower().find(kw.lower())
            if idx == -1:
                continue
        excerpt = text[idx:idx + len(kw)]
        if excerpt in seen:
            continue
        seen.add(excerpt)
        spans.append({'excerpt': excerpt, 'section': None,
                      'startOffset': idx, 'endOffset': idx + len(kw)})
    return spans


def extract_capability(snapshot, capability):
    text = snapshot['normalizedContent']
    if not text:
        return None
    keywords = CAPABILITY_KEYWORDS.get(capability, [])
    spans = find_evidence_spans(text, keywords)
    if not spans:
        return None
    if len(spans) >= 2:
        level, strength, conf = 'derived', 0.6, 0.6
    else:
        level, strength, conf = 'estimated', 0.3, 0.3
    return {
        'courseId': snapshot['courseId'],
        'capability': capability,
        'claim': 'keyword match: ' + ', '.join(s['excerpt'] for s in spans[:3]),
        'strength': strength,
        'sourceType': 'official_syllabus',
        'sourceUrl': snapshot['sourceUrl'],
        'sourceAuthority': 'tau_official_syllabus',
        'sourceYear': snapshot['sourceYear'],
        'extractedEvidence': ' ... '.join(s['excerpt'] for s in spans[:3]),
        'inferenceLevel': level,
        'confidence': conf,
        'termCount': len(spans),
        'retrievedAt': snapshot['retrievedAt'],
        'evidenceSpans': spans[:5],
    }


def build_profile(course, snapshot, capabilities, program_id):
    evidence_list = [ev for cap in capabilities
                     for ev in [extract_capability(snapshot, cap)] if ev]
    has_derived = any(ev['inferenceLevel'] == 'derived' for ev in evidence_list)
    has_estimated = any(ev['inferenceLevel'] == 'estimated' for ev in evidence_list)
    if has_derived:
        confidence_label = 'medium'
    elif has_estimated:
        confidence_label = 'low'
    else:
        confidence_label = None
    profile = {
        'courseId': snapshot['courseId'],
        'snapshotHash': snapshot['contentHash'],
        'schemaVersion': SCHEMA_VERSION,
        'ontologyVersion': ONTOLOGY_VERSION,
        'extractorVersion': EXTRACTOR_VERSION,
        'extractorName': EXTRACTOR_NAME,
        'extractorKind': EXTRACTOR_KIND,
        'evaluatedCapabilities': list(capabilities),
        'evidence': evidence_list,
        'quarantined': [],
        'createdAt': GENERATED_AT,
    }
    if confidence_label:
        profile['extractorConfidenceLabel'] = confidence_label
    return profile


def run_program(prog):
    program_id = prog['id']
    capabilities = prog['capabilities']
    board_path = prog['board']
    profile_path = prog['profile']

    print(f'\n=== {program_id} ===')
    with open(board_path) as f:
        board = json.load(f)

    courses = board.get('metadata', {}).get('program_repository_courses', [])
    print(f'  Board courses: {len(courses)}')

    existing_cache = json.load(open(profile_path)) if profile_path.exists() else {'profiles': {}}
    existing_profiles = existing_cache.get('profiles', {})
    protected_ids = {cid for cid, p in existing_profiles.items()
                     if p.get('extractorName') == 'captured-review-v1'}
    print(f'  Protected (captured-review-v1): {len(protected_ids)}')

    new_profiles = {}
    stats = {'total': len(courses), 'no_content': 0, 'processed': 0,
             'with_evidence': 0, 'protected_kept': 0}

    for course in courses:
        cid = course.get('course_id', '')
        if not cid:
            continue
        if cid in protected_ids:
            new_profiles[cid] = existing_profiles[cid]
            stats['protected_kept'] += 1
            continue
        snapshot = build_snapshot(course, program_id)
        if not snapshot['hasContent']:
            stats['no_content'] += 1
            new_profiles[cid] = {
                'courseId': cid, 'snapshotHash': snapshot['contentHash'],
                'schemaVersion': SCHEMA_VERSION, 'ontologyVersion': ONTOLOGY_VERSION,
                'extractorVersion': EXTRACTOR_VERSION, 'extractorName': EXTRACTOR_NAME,
                'extractorKind': EXTRACTOR_KIND, 'evaluatedCapabilities': list(capabilities),
                'evidence': [], 'quarantined': [], 'createdAt': GENERATED_AT,
            }
            continue
        profile = build_profile(course, snapshot, capabilities, program_id)
        new_profiles[cid] = profile
        stats['processed'] += 1
        if profile['evidence']:
            stats['with_evidence'] += 1

    cache = {
        'programOrCatalog': program_id,
        'schemaVersion': SCHEMA_VERSION,
        'ontologyVersion': ONTOLOGY_VERSION,
        'extractorVersion': EXTRACTOR_VERSION,
        'generatedAt': GENERATED_AT,
        'profiles': new_profiles,
    }
    with open(profile_path, 'w') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f'  Wrote {len(new_profiles)} profiles to {profile_path.name}')
    return stats


def main():
    programs = [
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
    all_stats = {}
    for prog in programs:
        all_stats[prog['id']] = run_program(prog)

    print('\n\n========== FOUR-TIER COVERAGE REPORT ==========')
    print('  T1 — Raw syllabus:     courses with any substantive syllabus_summary_he')
    print('  T2 — Keyword-derived:  deterministic-v1 profiles with >= 1 evidence item')
    print('  T3 — Hand-reviewed:    profiles from captured-review-v1')
    print('  T4 — Planner-consumed: T2 + T3 (profiles with evidence.strength > 0)')

    for program_id, stats in all_stats.items():
        t1 = stats['processed']
        t2 = stats['with_evidence']
        t3 = stats['protected_kept']
        t4 = t2 + t3
        total = stats['total']
        print(f'\n  {program_id}:')
        print(f'    T1 raw syllabus:      {t1:3d}/{total}  ({t1/total*100:.0f}%)')
        print(f'    T2 keyword-derived:   {t2:3d}/{total}  ({t2/total*100:.0f}%)')
        print(f'    T3 hand-reviewed:     {t3:3d}/{total}  ({t3/total*100:.0f}%)')
        print(f'    T4 planner-consumed:  {t4:3d}/{total}  ({t4/total*100:.0f}%)')
        print(f'    No syllabus content:  {stats["no_content"]:3d}/{total}  ({stats["no_content"]/total*100:.0f}%)')


if __name__ == '__main__':
    main()
