import hashlib
import json
from pathlib import Path

import pytest

from app.degrees.prerequisite_facts import load_prerequisite_facts, apply_prerequisite_facts


CID = '0512-4100'
URL = 'https://ims.tau.ac.il/tal/kr/Drishot_L.aspx?kurs=05124100&kv=01&sem=20261'
HTML = ('<span class="listtdbbld">שנה"ל תשפ"ז (2026/2027)</span>'
        '<span class="listtd">קורס: <b>שם (0512-4100)</b></span>'
        '<table class="tableblds"><tr><th class="listth">קורסי קדם נדרשים</th></tr>'
        '<tr><td><table class="listtds"><tr><td>0512-3632</td><td>קורס א</td></tr>'
        '<tr><td><b>או</b></td></tr><tr><td>0512-2532</td><td>קורס ב</td></tr></table></td></tr></table>')


def snapshot(tmp_path):
    detail = tmp_path / 'data/raw_html/course_details/course_05124100_2026.html'
    detail.parent.mkdir(parents=True)
    detail_html = f'<a href="{URL}">requirements</a>'
    detail.write_text(detail_html, encoding='utf-8')
    record = {'course_id': CID, 'source_url': URL, 'semester': '20261', 'group': '01',
              'response': {'html': HTML, 'sha256': hashlib.sha256(HTML.encode()).hexdigest(),
                           'source_url': URL, 'final_url': URL, 'fetched_at': '2026-11-07T00:00:00Z'}}
    data = {'schema_version': 1, 'program_id': 'electrical_engineering_2027', 'source_year': 2026,
            'courses': {CID: {'course_id': CID, 'course_details': [
                {'path': detail.relative_to(tmp_path).as_posix(), 'sha256': hashlib.sha256(detail.read_bytes()).hexdigest(),
                 'html': detail.read_bytes().decode('utf-8')}
            ], 'records': [record],
                              'consensus': {'prerequisites': {'all_of': []}}}}}
    path = tmp_path / 'snapshot.json'
    return path, data


def load(path, data, root):
    path.write_text(json.dumps(data), encoding='utf-8')
    return load_prerequisite_facts(path, program_id='electrical_engineering_2027', source_year=2026, root=root)


def test_reparses_html_instead_of_trusting_consensus_and_keeps_missing_corequisites_unknown(tmp_path):
    path, data = snapshot(tmp_path)
    facts = load(path, data, tmp_path)
    assert facts[CID]['prerequisites'] == {'any_of': [{'course_id': '0512-3632'}, {'course_id': '0512-2532'}]}
    assert facts[CID]['corequisites'] is None
    assert facts[CID]['provenance'][0]['identity_verified'] is True
    board = {'semesters': [{'courses': [{'course_id': CID}, {'course_id': 'UNKNOWN'}]}]}
    apply_prerequisite_facts(board, facts)
    assert board['semesters'][0]['courses'][0]['prerequisite_expression'] == facts[CID]['prerequisites']
    assert board['semesters'][0]['courses'][1]['prerequisite_expression'] is None


@pytest.mark.parametrize('mutation', ['hash', 'redirect', 'semester', 'missing_record'])
def test_unverifiable_record_cannot_produce_known_requirements(tmp_path, mutation):
    path, data = snapshot(tmp_path)
    record = data['courses'][CID]['records'][0]
    if mutation == 'hash':
        record['response']['sha256'] = 'changed'
    elif mutation == 'redirect':
        record['response']['final_url'] = URL.replace('kv=01', 'kv=02')
    elif mutation == 'semester':
        record['semester'] = '20251'
    else:
        data['courses'][CID]['records'].append({'source_url': URL.replace('kv=01', 'kv=02')})
        with pytest.raises(ValueError, match='group inventory changed'):
            load(path, data, tmp_path)
        return
    assert load(path, data, tmp_path)[CID]['prerequisites'] is None


def test_other_program_snapshot_cannot_be_applied(tmp_path):
    path, data = snapshot(tmp_path)
    data['program_id'] = 'mechanical_engineering_2027'
    with pytest.raises(ValueError, match='identity'):
        load(path, data, tmp_path)


def test_changed_detail_cache_requires_recollection(tmp_path):
    path, data = snapshot(tmp_path)
    detail = tmp_path / 'data/raw_html/course_details/course_05124100_2026.html'
    detail.parent.mkdir(parents=True, exist_ok=True)
    detail.write_text('new groups', encoding='utf-8')
    data['courses'][CID]['course_details'] = [{'path': detail.relative_to(tmp_path).as_posix(), 'sha256': 'old'}]
    with pytest.raises(ValueError, match='collect requirements again'):
        load(path, data, tmp_path)


def test_absent_snapshot_preserves_legacy_boards(tmp_path):
    assert load_prerequisite_facts(tmp_path / 'absent', program_id='p', source_year=2026, root=tmp_path) is None
    board = {'semesters': [{'courses': [{'course_id': CID}]}]}
    apply_prerequisite_facts(board, None)
    assert 'prerequisite_expression' not in board['semesters'][0]['courses'][0]


def test_removing_a_group_cannot_make_conflicting_requirements_pass(tmp_path):
    path, data = snapshot(tmp_path)
    data['courses'][CID]['records'] = []
    with pytest.raises(ValueError, match='group inventory changed'):
        load(path, data, tmp_path)


def test_captured_detail_inventory_can_be_replayed_without_gitignored_cache(tmp_path):
    path, data = snapshot(tmp_path)
    detail = tmp_path / data['courses'][CID]['course_details'][0]['path']
    detail.unlink()
    assert load(path, data, tmp_path)[CID]['prerequisites'] is not None
