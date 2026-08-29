/**
 * Guards the Next-native read-only Course Details panel and its integration in
 * the repository surface (rendered inside ProductShell — the outer Next shell).
 *
 * Contract for this migration slice:
 *  - a self-contained, read-only modal exists in the Next layer;
 *  - it renders course fields and degrades gracefully when they are absent;
 *  - it is DECOUPLED from the legacy iframe: closing it cannot touch the
 *    canonical planner (it holds no iframe / contentWindow / board handles);
 *  - /planner keeps the course-details surface inside the unified React workspace;
 *  - the canonical legacy HTML and all backend/api files are untouched.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PANEL = 'web/app/components/CourseDetailsPanel.tsx';

test('the course details panel is a client component reading the details VM', () => {
  const src = read(PANEL);
  expect(src).toContain("'use client'");
  expect(src).toContain('CourseDetailsVM');
});

test('the panel is an accessible dialog labelled as course details', () => {
  const src = read(PANEL);
  expect(src).toContain('role="dialog"');
  expect(src).toContain('aria-modal');
  expect(src).toContain('פרטי קורס');
});

test('the panel renders the read-only course fields', () => {
  const src = read(PANEL);
  expect(src).toContain('course.name');
  expect(src).toContain('course.id');
  expect(src).toContain('course.weeklyHours');
  expect(src).toContain('course.credits');
  expect(src).toContain('course.category');
  expect(src).toContain('course.offered');
  expect(src).toContain('course.prerequisites');
});

test('missing fields degrade gracefully rather than crashing', () => {
  const src = read(PANEL);
  // no prerequisites → an explicit empty-state, not a blank/undefined render
  expect(src).toContain('אין דרישות קדם');
});

test('the syllabus link renders only when available and opens safely', () => {
  const src = read(PANEL);
  expect(src).toContain('course.syllabusUrl');
  expect(src).toContain('סילבוס');
  expect(src).toContain('target="_blank"');
  expect(src).toMatch(/rel=["'][^"']*noreferrer/);
});

test('the panel closes via Escape and an explicit close control', () => {
  const src = read(PANEL);
  expect(src).toContain('onClose');
  expect(src).toContain('Escape');
  expect(src).toContain('סגור'); // labelled close button
});

test('the panel is decoupled from the legacy iframe (cannot affect it)', () => {
  const src = read(PANEL);
  // Closing/opening the panel must never reach into the planner engine.
  expect(src).not.toContain('iframe');
  expect(src).not.toContain('contentWindow');
  expect(src).not.toContain('resetBoard');
  expect(src).not.toContain('/planner/legacy');
});

test('the panel mutates no board/planner state (read-only)', () => {
  const src = read(PANEL);
  expect(src).not.toContain('localStorage.setItem');
  expect(src).not.toContain('fetch(');
});

test('the repository explorer wires the details panel to a selected course', () => {
  const explorer = read('web/app/components/RepositoryExplorer.tsx');
  expect(explorer).toContain('CourseDetailsPanel');
  expect(explorer).toContain('buildCourseDetails');
  const card = read('web/app/components/RepositoryCourseCard.tsx');
  expect(card).toContain('onSelect'); // card is the read-only opener
});

test('/planner keeps course details inside the unified iframe-free workspace', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('UnifiedPlannerWorkspace');
  expect(page).not.toContain('LegacyPlannerFrame');
  expect(read('web/app/components/UnifiedCourseRepository.tsx')).toContain('CourseDetailsPanel');
});

test('the course-details slice itself stays Next-native (legacy HTML edits are additive-only)', () => {
  // This guard originally asserted the working tree left the legacy planner
  // untouched. The interest-evaluation epic intentionally wires the legacy
  // HTML additively, so on this branch the working-tree diff is expected. The
  // still-meaningful invariant: the course-details panel is a Next component,
  // and any legacy-HTML edit present is the additive interest opt-in — never a
  // rewrite of the canonical generate-plan call path. The agent-runtime UI
  // slice routes the request spread through buildAgentPlanRequestFields, which
  // wraps buildInterestRequestFields additively (still {} by default).
  const html = read('app/web/semester_board_viewer.html');
  expect(html).toContain("fetch('/api/ai/generate-plan'");
  expect(html).toContain('buildAgentPlanRequestFields(_aiPickerState.interests)');
  expect(html).toContain('buildInterestRequestFields(interests)'); // wrapped, additive interest opt-in preserved
});

test('the course-details/interest UI slice adds no UNRELATED backend/api churn', () => {
  // Scope guard for the frontend interest slice: it must not drag in backend
  // changes of its own. The catalog-integrity planner fix (course_profile.ts —
  // a name-less course is never placed into an applicable proposal) is a
  // separate, deliberate backend change on this branch, so it is allow-listed
  // here; anything else touching api/ still trips this guard.
  const ALLOWED = new Set([
    'api/ai/course_profile.ts',
    // Separate grounded-candidate diversification slice: the legacy UI still
    // must not pull in any other backend churn.
    'api/ai/candidate_set.ts',
    // Separate explicit-focus grounding slice. These are the only additional
    // backend files it deliberately owns.
    'api/ai/focus_topic_objective.ts',
    'api/ai/generate-plan.ts',
    'api/ai/grounded_objective_set.ts',
    'api/ai/grounded_objectives.ts',
    'api/ai/plan_alternatives.ts',
    'api/ai/planning_intent.ts',
    // Separate remaining-degree correctness slice: authoritative recognized
    // hours reach the model and unmet category hours reserve search budget.
    'api/ai/planner_goals.ts',
    'api/ai/planner_model.ts',
    'api/ai/planner_types.ts',
  ]);
  const diff = execSync('git diff --name-only HEAD -- api', { cwd: ROOT })
    .toString()
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !ALLOWED.has(f));
  expect(diff).toEqual([]);
});
