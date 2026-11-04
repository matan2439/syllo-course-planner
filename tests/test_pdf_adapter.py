"""PDF evidence adapter: linked regulations PDFs -> rule_text items. Hermetic (no network).

Fixture PDFs are generated here: a simple font whose ToUnicode CMap maps bytes 0x80..0x9A to the
Hebrew letters, so pypdf extracts real Hebrew. Like real Word/Acrobat output, glyph runs are drawn
in visual order (pypdf turns those back into logical order); ``logical_stream=True`` draws them in
logical order instead, which pypdf then returns reversed - the case the adapter must restore.
"""
import hashlib
from datetime import datetime, timezone

import pytest
import requests
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.degrees import evidence as ev
from app.degrees.adapters import pdf, tau
from app.degrees.evidence import EvidenceFetchError, EvidenceItem, text_id
from app.degrees.registry import get_program

TERMS_URL = "https://engineering.tau.ac.il/files/yedion/Terms_BA.pdf"
ARCHIVE_URL = "https://www.tau.ac.il/tochniot/pdf/2023/heb/054211010000.pdf"
DOC = hashlib.sha1(TERMS_URL.encode()).hexdigest()[:12]
TITLE = "תקנון הלימודים לתואר ראשון"

CMAP = b"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /HebFixture def
1 begincodespacerange
<00> <FF>
endcodespacerange
2 beginbfrange
<20> <7E> <0020>
<80> <9A> <05D0>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end"""

PAGES = [
    [
        "לוח זמנים",
        "הלימודים נמשכים שמונה סמסטרים",
        "למעט הנדסה מכנית.",
        "",
        "א. התלמיד ירשם לקורסים בזמן.",
        "ב. שעה אקדמית היא חמישים דקות.",
    ],
    [
        "7",
        "",
        "פטור מקורסים",
        "הפטורים יינתנו לתלמידים שלמדו בעבר.",
    ],
]


def _encode(text: str) -> bytes:
    return bytes(ord(c) - 0x05D0 + 0x80 if "א" <= c <= "ת" else ord(c) for c in text)


def _visual(line: str) -> str:
    """Visual (left-to-right drawing) order of a pure-RTL line (fixture text has no Latin runs)."""
    return line[::-1]


def make_pdf(pages: list[list[str]], logical_stream: bool = False) -> bytes:
    w = PdfWriter()
    for lines in pages:
        page = w.add_blank_page(612, 792)
        cmap = DecodedStreamObject()
        cmap.set_data(CMAP)
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/HebFixture"), NameObject("/ToUnicode"): w._add_object(cmap),
        })
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
        shown = [(line if logical_stream else _visual(line)) or " " for line in lines]
        ops = b" ".join(b"(" + _encode(s).replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
                        + b") Tj T*" for s in shown)
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 72 750 Td 14 TL " + ops + b" ET")
        page[NameObject("/Contents")] = w._add_object(content)
    import io

    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def blank_pdf() -> bytes:
    import io

    w = PdfWriter()
    w.add_blank_page(612, 792)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def _link(url, data):
    return EvidenceItem(id=f"tau:x:body:terms:{text_id(url)}", source_url=tau.GRAPHQL_URL,
                        fetched_at=datetime.now(timezone.utc), from_cache=True, kind="policy_text",
                        path=[], raw_text=data.get("Title") or data.get("shana"), data=dict(data, url=url))


class FakeResponse:
    def __init__(self, status, content=b""):
        self.status_code, self.content = status, content


@pytest.fixture
def program():
    return get_program("mechanical_engineering_2027")


@pytest.fixture
def env(tmp_path, monkeypatch):
    state = {
        "links": [
            _link(TERMS_URL, {"Title": TITLE}),
            _link(ARCHIVE_URL, {"shana": "תשפ\"ג - 2023"}),  # prev_newsletters archive: skipped
            _link("https://engineering.tau.ac.il/yedion/2019-20", {"shana": "2019"}),
        ],
        "pdf": make_pdf(PAGES),
        "gets": [],
        "response": None,
    }
    monkeypatch.setattr(pdf, "PDF_DIR", tmp_path / "pdf")
    monkeypatch.setattr(tau, "tochniot_evidence", lambda p, live, offline: list(state["links"]))

    def fake_get(url, timeout=None, **kw):
        state["gets"].append(url)
        if state["response"] is not None:
            r = state["response"]
            if isinstance(r, Exception):
                raise r
            return r
        return FakeResponse(200, state["pdf"])

    monkeypatch.setattr(pdf.requests, "get", fake_get)
    return state


def _by_text(items):
    return {i.raw_text: i for i in items}


def test_items_ids_paths_pages(program, env):
    items = pdf.pdf_evidence(program, live=False, offline=False)
    assert env["gets"] == [TERMS_URL]  # archive pdf and html links never fetched
    texts = _by_text(items)
    assert set(texts) == {
        "הלימודים נמשכים שמונה סמסטרים למעט הנדסה מכנית.",
        "א. התלמיד ירשם לקורסים בזמן.",
        "ב. שעה אקדמית היא חמישים דקות.",
        "הפטורים יינתנו לתלמידים שלמדו בעבר.",
    }
    first = texts["הלימודים נמשכים שמונה סמסטרים למעט הנדסה מכנית."]
    assert first.id == f"pdf:{DOC}:{text_id(first.raw_text)}"
    assert first.kind == "rule_text" and first.source_url == TERMS_URL
    assert first.path == [TITLE, "לוח זמנים"] and first.data == {"page": 1}
    exempt = texts["הפטורים יינתנו לתלמידים שלמדו בעבר."]
    assert exempt.path == [TITLE, "פטור מקורסים"] and exempt.data == {"page": 2}
    assert not any(ARCHIVE_URL in i.source_url for i in items)


def test_ids_stable_across_runs_and_programs(program, env):
    a = pdf.pdf_evidence(program, live=False, offline=False)
    b = pdf.pdf_evidence(program, live=False, offline=True)  # second run: from cache, no fetch
    assert env["gets"] == [TERMS_URL]
    assert [i.id for i in a] == [i.id for i in b]
    assert all(i.from_cache for i in b)
    other = program.model_copy(update={"id": "other_program_2027", "base": "other_program"})
    assert [i.id for i in pdf.pdf_evidence(other, live=False, offline=True)] == [i.id for i in a]


def test_reworded_paragraph_changes_exactly_one_id(program, env):
    before = {i.id for i in pdf.pdf_evidence(program, live=True, offline=False)}
    pages = [list(p) for p in PAGES]
    pages[0][5] = "ב. שעה אקדמית היא ארבעים וחמש דקות."
    env["pdf"] = make_pdf(pages)
    after = {i.id for i in pdf.pdf_evidence(program, live=True, offline=False)}
    assert len(before - after) == 1 and len(after - before) == 1


def test_visual_order_text_is_restored(program, env):
    env["pdf"] = make_pdf(PAGES, logical_stream=True)
    raw = pdf.extract_pages(env["pdf"])
    assert "םינמז חול" in raw[0]  # pypdf really returns this one reversed
    texts = _by_text(pdf.pdf_evidence(program, live=True, offline=False))
    assert "הלימודים נמשכים שמונה סמסטרים למעט הנדסה מכנית." in texts
    assert texts["הפטורים יינתנו לתלמידים שלמדו בעבר."].path == [TITLE, "פטור מקורסים"]


def test_logical_order_text_is_left_alone():
    lines = pdf.page_lines("הלימודים נמשכים שמונה סמסטרים ארבע שנים\nשעה אקדמית היא 50 דקות")
    assert lines[0] == "הלימודים נמשכים שמונה סמסטרים ארבע שנים"


def test_no_text_layer_gives_no_items_and_warns(program, env, caplog):
    env["pdf"] = blank_pdf()
    with caplog.at_level("WARNING"):
        assert pdf.pdf_evidence(program, live=False, offline=False) == []
    assert "no text layer" in caplog.text and TERMS_URL in caplog.text


@pytest.mark.parametrize("response", [FakeResponse(500), FakeResponse(200, b"<html>not a pdf</html>"),
                                      requests.ConnectionError("down")])
def test_live_download_failure_raises(program, env, tmp_path, response):
    (tmp_path / "pdf").mkdir()
    (tmp_path / "pdf" / f"{DOC}.pdf").write_bytes(env["pdf"])  # stale cache must not be used live
    env["response"] = response
    with pytest.raises(EvidenceFetchError):
        pdf.pdf_evidence(program, live=True, offline=False)


def test_offline_without_cache_raises(program, env):
    with pytest.raises(EvidenceFetchError):
        pdf.pdf_evidence(program, live=False, offline=True)
    assert env["gets"] == []


def test_live_refetches_and_marks_fresh(program, env, tmp_path):
    pdf.pdf_evidence(program, live=False, offline=False)
    items = pdf.pdf_evidence(program, live=True, offline=False)
    assert env["gets"] == [TERMS_URL, TERMS_URL]
    assert items and not any(i.from_cache for i in items)


def test_registered_as_tau_pdf():
    assert ev.ADAPTERS["tau_pdf"] is pdf.pdf_evidence


def test_paragraph_heuristics():
    lines = [
        "פטור מקורסים",                      # heading: short, unterminated, first in block
        "הנדסאים זכאים לפטור על פי הרשימות המתפרסמות בכל אחת ממגמות",
        "הלימוד",                            # wrapped tail, previous line unterminated: not a heading
        "תלמיד שעבר מגמה זכאי לפטור.",
        "רשאים להבחן",                       # heading after a terminated line, mid-block
        "תלמיד העומד להבחן חייב לענות על תנאים אלה:",
        "א. הוא רשום כתלמיד.",
        "ב. הוא רשום לקורס",
        "בו עליו להבחן.",
    ]
    paras = pdf.split_paragraphs([lines])
    assert paras == [
        ("פטור מקורסים", "הנדסאים זכאים לפטור על פי הרשימות המתפרסמות בכל אחת ממגמות הלימוד "
                         "תלמיד שעבר מגמה זכאי לפטור.", 1),
        ("רשאים להבחן", "תלמיד העומד להבחן חייב לענות על תנאים אלה:", 1),
        ("רשאים להבחן", "א. הוא רשום כתלמיד.", 1),
        ("רשאים להבחן", "ב. הוא רשום לקורס בו עליו להבחן.", 1),
    ]


def test_bare_url_line_is_not_a_heading():
    paras = pdf.split_paragraphs([["ניתן לקבל הסבר באתר, בכתובת:", "http://www.ims.tau.ac.il/bidding"]])
    assert paras == [("", "ניתן לקבל הסבר באתר, בכתובת: http://www.ims.tau.ac.il/bidding", 1)]
