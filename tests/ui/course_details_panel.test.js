/**
 * Guards the Next-native read-only Course Details panel and its integration in
 * the repository surface (rendered inside ProductShell — the outer Next shell).
 *
 * Contract for this migration slice:
 *  - a self-contained, read-only modal exists in the Next layer;
 *  - it renders course fields and degrades gracefully when they are absent;
 *  - it is DECOUPLED from the legacy iframe: closing it cannot touch the
 *    canonical planner (it holds no iframe / contentWindow / board handles);
 *  - /planner keeps embedding the untouched legacy iframe;
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

test('/planner still embeds the untouched legacy iframe', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('LegacyPlannerFrame');
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('/planner/legacy');
});

test('the canonical legacy HTML was not modified by this slice', () => {
  const diff = execSync(
    'git diff --name-only HEAD -- app/web/semester_board_viewer.html',
    { cwd: ROOT }
  )
    .toString()
    .trim();
  expect(diff).toBe('');
});

test('no backend/api files were modified by this slice', () => {
  const diff = execSync('git diff --name-only HEAD -- api', { cwd: ROOT })
    .toString()
    .trim();
  expect(diff).toBe('');
});
