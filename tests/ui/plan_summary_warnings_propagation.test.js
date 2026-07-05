/**
 * plan_summary_warnings_propagation.test.js
 *
 * Live-confirmed production bug (master 90711e4): the deterministic planner
 * correctly computes material caveats into proposal.warnings_he — e.g.
 * no-final-exam שער-רוח courses flagged "מידע חסר / דורש אישור — …אינו מאומת
 * כתואם …'בלי בחינה סופית'", panel-vs-chat hard-avoid conflict notes, the
 * "לא נמצאו קורסי שער רוח עם סוג הסיום שביקשת" note — but the LLM-accepted
 * SUCCESS path's message builder (postPlanChangeSummary, the third message
 * constructor after activateTentativeDraft and the deterministic-replacement
 * rescue, both fixed earlier this session) builds its text ONLY from the
 * placement diff and never reads warnings_he. So on the live success path the
 * user sees "עדכנתי את המערכת: נוספו …" with the caveats silently dropped —
 * confirmed live: _aiPlanLastProposal.warnings_he held them, the chat message
 * did not.
 *
 * These tests pin the invariant at the exact root-cause function so the fix is
 * deterministic and the regression cannot return through this path.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  h = h.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert  = () => {};
  window.fetch  = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return dom;
}

function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe('success-path summary surfaces proposal warnings (postPlanChangeSummary)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('postPlanChangeSummary conveys the no-final-exam שער-רוח caveat — collapsed to one counted line (Part B), not the per-course wall', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      // Three different שער-רוח courses each flagged "מידע חסר" — the OLD builder
      // appended all three verbatim (a wall); the concise format collapses them.
      const warns = [
        'תולדות האנושות - 3,000 השנים הראשונות: מידע חסר / דורש אישור — לא ידוע אם יש בחינה סופית, לכן אינו מאומת כתואם את ההעדפה "בלי בחינה סופית".',
        'מהי תרבות ? בין מערב למזרח: מידע חסר / דורש אישור — לא ידוע אם יש בחינה סופית.',
        'מיינדפולנס ובודהיזם: מידע חסר / דורש אישור — לא ידוע אם יש בחינה סופית.',
      ];
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0609-1005'] }], warnings_he: warns };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0609-1005'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const joined = msgs.join('\\n');
      return JSON.stringify({ joined, perCourseLines: (joined.match(/מידע חסר/g) || []).length });
    })()`));
    // The caveat is conveyed (the user is told some שער-רוח courses have unknown exam status)…
    expect(r.joined).toContain('שער רוח');
    expect(r.joined).toContain('סוג סיום לא ידוע');
    expect(r.joined).toContain('אישור');
    // …but collapsed: the three per-course "מידע חסר" lines are NOT dumped verbatim
    // (the course name may still appear once as an ADDED course under "מה השתנה" —
    // that is the placement diff, not the warning wall).
    expect(r.perCourseLines).toBe(0);
  });

  test('postPlanChangeSummary surfaces a panel-vs-chat hard-avoid conflict note carried on the final proposal', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      const warn = 'תרמודינמיקה (2) (0542-4120) נמצא ברשימת הקורסים להימנע מהם בהעדפות התכנון, ולכן לא שובץ למרות הבקשה.';
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [warn] };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).toContain('להימנע');
    expect(r.joined).toContain('תרמודינמיקה (2)');
  });

  test('regression: a clean proposal with no warnings produces no spurious warning lines', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [] };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).toContain('נוספו');
    expect(r.joined).not.toContain('מידע חסר');
  });
});
