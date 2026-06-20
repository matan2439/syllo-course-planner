"""
Extract: (1) course names for 0542-4124 and 0542-4191 from raw HTML
         (2) prerequisite course IDs for 0542-4223 and 0542-4226 from syllabus HTML
Print results as JSON so the caller can pipe them to Supabase update.
"""
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent

def read_html(path):
    for enc in ['windows-1255', 'utf-8-sig', 'utf-8', 'iso-8859-8']:
        try:
            text = Path(path).read_text(encoding=enc)
            if any('א' <= ch <= 'ת' for ch in text):
                return text
        except Exception:
            pass
    return Path(path).read_bytes().decode('utf-8', errors='replace')


def extract_course_name_from_details(text):
    """Find Hebrew course name from TAU course_details HTML."""
    # TAU course page: the course name appears in a specific <td> structure
    # Pattern: row with label-like context near the course name
    patterns = [
        # table cell following "שם הקורס" or directly the name
        r'שם\s+הקורס[^<]{0,50}<[^>]+>\s*([א-ת][^\n<]{3,70})\s*<',
        # first long Hebrew text in a <td> that isn't a URL
        r'<td[^>]*>\s*([א-ת][א-ת\s\(\)\-\/,]{5,70})\s*</td>',
        # <span> containing multi-word Hebrew
        r'<span[^>]*>\s*([א-ת][א-ת\s\(\)\-\/,]{5,70})\s*</span>',
        # title tag of the page
        r'<title>[^|<\-]*?\|\s*([א-ת][^\|<]{5,70}?)\s*(?:\||<)',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.S)
        if m:
            cand = m.group(1).strip()
            # Reject if it's clearly a navigation/UI label
            BAD = ['ראשי', 'חיפוש', 'כניסה', 'מסלול', 'לימודים', 'הוראה', 'טל אביב']
            if any(b in cand for b in BAD):
                continue
            if 5 < len(cand) < 80:
                return cand
    return None


def extract_prereq_ids_from_syllabus(text, self_id):
    """
    Extract prerequisite course IDs from TAU syllabus HTML.
    Pattern: 9-digit numbers in parentheses like (054242260)
    """
    raw_ids = re.findall(r'\b(\d{9})\b', text)
    # Also find 8-digit with leading zero
    raw_ids += re.findall(r'\(0(\d{8})\)', text)

    result = []
    seen = set()
    for raw in raw_ids:
        if len(raw) == 9 and raw.startswith('0'):
            cid = f'{raw[:4]}-{raw[4:]}'
        elif len(raw) == 8:
            cid = f'0{raw[:3]}-{raw[3:]}'
        else:
            continue
        if cid == self_id or cid in seen:
            continue
        # Sanity: must look like a TAU course ID
        if not re.match(r'0[0-9]{3}-[0-9]{4}', cid):
            continue
        seen.add(cid)
        result.append(cid)
    return result


results = {}

# ── 1. Course names for unnamed not-offered courses ───────────────────────────
for cid, fname in [('0542-4124', 'course_05424124_2025.html'),
                    ('0542-4191', 'course_05424191_2025.html')]:
    path = BASE / 'data/raw_html/course_details' / fname
    if path.exists():
        txt = read_html(str(path))
        name = extract_course_name_from_details(txt)
        results[cid] = {'name_he': name, 'source': 'course_details'}
    else:
        results[cid] = {'name_he': None, 'source': 'file_missing'}

# ── 2. Prerequisite IDs for 0542-4223 and 0542-4226 ─────────────────────────
for cid, sfname in [('0542-4223', 'syllabus_05424223.html'),
                     ('0542-4226', 'syllabus_05424226.html')]:
    path = BASE / 'data/raw_html/syllabus' / sfname
    if path.exists():
        txt = read_html(str(path))
        prereqs = extract_prereq_ids_from_syllabus(txt, cid)
        results[cid] = {'prerequisite_course_ids': prereqs, 'source': 'syllabus'}
    else:
        results[cid] = {'prerequisite_course_ids': [], 'source': 'file_missing'}

print(json.dumps(results, ensure_ascii=False, indent=2))
