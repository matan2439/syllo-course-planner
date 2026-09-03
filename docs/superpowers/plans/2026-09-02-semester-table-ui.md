# Semester Table Planner UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-grid planner with a compact RTL semester table beside a categorized draggable course repository while preserving authoritative manual edits.

**Architecture:** `NativePlannerJourney` remains the owner of committed board state and server mutations. Repository cards become typed drag sources; semester columns distinguish repository-add from board-move payloads and dispatch both through the existing edit-board API. `UnifiedPlannerWorkspace` supplies the responsive desktop split and mobile view switch without duplicating planner state.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Jest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-02-semester-table-conversational-agent-production-design.md`

## Global Constraints

- Keep `/planner` as the canonical purple React/Next route.
- Manual add/remove/move commits only after authoritative server success.
- Preserve keyboard equivalents for every drag operation.
- Keep Mechanical Engineering 2027 as the visible release program.
- Keep Electrical Engineering hidden until its separate source/model gate passes.
- Do not modify catalog JSON, Supabase, Production data, `main`, or `stash@{0}`.
- Tests and browser fixtures must not call an LLM or paid provider.
- Preserve unrelated `tests/test_tau_curriculum_document.py`, `.agents/`, `.codex/`, `.tmp/`, and `skills-lock.json`.

---

### Task 1: Typed drag payloads

**Files:**
- Create: `web/lib/planner/drag-payload.ts`
- Create: `web/lib/planner/drag-payload.test.ts`

**Interfaces:**
- Produces: `REPOSITORY_COURSE_MIME`, `BOARD_COURSE_MIME`, `writeRepositoryDrag`, `writeBoardDrag`, and `readPlannerDrag`.
- `readPlannerDrag(dataTransfer)` returns `{ kind: 'repository' | 'board'; courseId: string; allowedSemesterIds?: string[] } | null`.

- [x] **Step 1: Write the failing payload round-trip tests**

```ts
test('repository payload remains distinguishable from a board move', () => {
  const transfer = fakeDataTransfer()
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  expect(readPlannerDrag(transfer)).toEqual({
    kind: 'repository', courseId: '0542-4120',
    allowedSemesterIds: ['year_3_semester_a'],
  })
})

test('malformed planner payload fails closed', () => {
  const transfer = fakeDataTransfer({ 'application/x-syllo-repository-course': '{' })
  expect(readPlannerDrag(transfer)).toBeNull()
})
```

- [x] **Step 2: Run RED**

Run: `cd web; npm test -- --runInBand lib/planner/drag-payload.test.ts`
Expected: FAIL because `drag-payload.ts` does not exist.

- [x] **Step 3: Implement strict JSON payload parsing**

```ts
export type PlannerDragPayload = {
  kind: 'repository' | 'board'
  courseId: string
  allowedSemesterIds?: string[]
}
```

Reject empty IDs, unknown kinds, non-array semester lists, and malformed JSON.

- [x] **Step 4: Run GREEN**

Run: `cd web; npm test -- --runInBand lib/planner/drag-payload.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/lib/planner/drag-payload.ts web/lib/planner/drag-payload.test.ts
git commit -m "feat(planner): add typed course drag payloads"
```

### Task 2: Draggable categorized repository with keyboard add

**Files:**
- Modify: `web/app/components/UnifiedCourseRepository.tsx`
- Modify: `web/app/components/UnifiedCourseRepository.test.tsx`
- Modify: `web/app/components/RepositoryCourseCard.tsx`

**Interfaces:**
- Consumes: Task 1 drag payload helpers.
- Changes `onRequestAdd` to `(courseId: string, semesterId?: string) => void`.
- Adds `semesterDestinations: Array<{ id: string; label: string }>`.

- [x] **Step 1: Write failing interaction tests**

Assert that a repository course has `draggable=true`, writes a repository payload,
keeps category/search filtering, and exposes a labelled “הוסף לסמסטר…” control
whose destination click calls `onRequestAdd(courseId, semesterId)`.

- [x] **Step 2: Run RED**

Run: `cd web; npm test -- --runInBand app/components/UnifiedCourseRepository.test.tsx`
Expected: FAIL because repository cards are not drag sources and the callback has no destination.

- [x] **Step 3: Implement compact repository rows**

Use `<details>` for category disclosure, a compact course row, factual badges,
`draggable={!onBoard}`, and Task 1 payload writing. Disable both drag and buttons
for courses already on the committed board. Keep the details panel.

- [x] **Step 4: Run GREEN and accessibility assertions**

Run: `cd web; npm test -- --runInBand app/components/UnifiedCourseRepository.test.tsx`
Expected: PASS with labelled search, details and add controls.

- [x] **Step 5: Commit**

```bash
git add web/app/components/UnifiedCourseRepository.tsx web/app/components/UnifiedCourseRepository.test.tsx web/app/components/RepositoryCourseCard.tsx
git commit -m "feat(planner): make repository courses draggable"
```

### Task 3: Semester-table add and move drop targets

**Files:**
- Modify: `web/app/components/SemesterColumn.tsx`
- Modify: `web/app/components/NativePlannerBoard.tsx`
- Modify: `web/app/components/CourseCard.tsx`
- Modify: `web/app/components/NativePlannerBoard.test.tsx`

**Interfaces:**
- Adds `onAddCourse(courseId, semesterId)` separately from `onMoveCourse`.
- Consumes Task 1 `readPlannerDrag` and board payload writing.

- [x] **Step 1: Write failing repository-drop and board-move tests**

```tsx
fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), {
  dataTransfer: repositoryTransfer('0542-4120'),
})
expect(onAddCourse).toHaveBeenCalledWith('0542-4120', 'year_3_semester_a')
expect(onMoveCourse).not.toHaveBeenCalled()
```

Add the inverse assertion for a board payload and a fail-closed assertion for a
semester outside `allowedSemesterIds`.

- [x] **Step 2: Run RED**

Run: `cd web; npm test -- --runInBand app/components/NativePlannerBoard.test.tsx`
Expected: FAIL because every drop is currently treated as a move.

- [x] **Step 3: Implement typed drop dispatch and continuous table styling**

Render board columns inside one bordered grid with shared header/background,
minimum column width `17rem`, horizontal overflow on the board container, and
full-height empty drop zones. Dispatch repository payloads to `onAddCourse` and
board payloads to `onMoveCourse` only.

- [x] **Step 4: Run GREEN**

Run: `cd web; npm test -- --runInBand app/components/NativePlannerBoard.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/app/components/SemesterColumn.tsx web/app/components/NativePlannerBoard.tsx web/app/components/CourseCard.tsx web/app/components/NativePlannerBoard.test.tsx
git commit -m "feat(planner): add authoritative semester drop targets"
```

### Task 4: Route drops through authoritative manual edits

**Files:**
- Modify: `web/app/components/NativePlannerJourney.tsx`
- Modify: `web/app/components/UnifiedPlannerWorkspace.tsx`
- Modify: `web/app/components/NativePlannerJourney.serverapply.test.tsx`
- Modify: `web/app/components/UnifiedPlannerWorkspace.test.tsx`

**Interfaces:**
- Repository button and drop requests both become the existing `add_course` edit command.
- Successful edits replace the committed board/version and stale current proposals.

- [x] **Step 1: Write failing direct-semester add test**

Request repository course `0542-4120` for `year_3_semester_a`; assert one
`editBoardFn` call with `operation:'add_course'`, the chosen semester and current
`expected_board_version`. Assert no local board change before the promise resolves.

- [x] **Step 2: Run RED**

Run: `cd web; npm test -- --runInBand app/components/NativePlannerJourney.serverapply.test.tsx app/components/UnifiedPlannerWorkspace.test.tsx`
Expected: FAIL because workspace requests do not carry a chosen semester and board drops cannot add.

- [x] **Step 3: Implement the direct destination path**

Extend `ManualAddIntent` with `preferredSemesterId?: string`; use it only when it
is present in the authoritative offered-semester set. Otherwise retain the
existing explicit semester chooser. Reuse the existing mutation pending/error,
version replacement and proposal-staleness path.

- [x] **Step 4: Run GREEN and existing manual-edit journey tests**

Run: `cd web; npm test -- --runInBand app/components/NativePlannerJourney.serverapply.test.tsx app/components/UnifiedPlannerWorkspace.test.tsx app/components/NativePlannerJourney.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/app/components/NativePlannerJourney.tsx web/app/components/UnifiedPlannerWorkspace.tsx web/app/components/NativePlannerJourney.serverapply.test.tsx web/app/components/UnifiedPlannerWorkspace.test.tsx
git commit -m "feat(planner): commit repository drops through server authority"
```

### Task 5: Responsive academic workbench layout

**Files:**
- Modify: `web/app/components/UnifiedPlannerWorkspace.tsx`
- Modify: `web/app/components/UnifiedPlannerWorkspace.test.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/app/planner/page.test.tsx`

**Interfaces:**
- Desktop: sticky repository rail + scrollable board + collapsible Agent region.
- Mobile: three accessible tabs `board`, `repository`, `agent` with roving focus.

- [x] **Step 1: Write failing structure and keyboard tests**

Assert three mobile tabs, RTL tab order, Arrow/Home/End navigation, one desktop
repository complementary region, one horizontally scrollable semester table,
and an Agent region that remains mounted against the same journey state.

- [x] **Step 2: Run RED**

Run: `cd web; npm test -- --runInBand app/components/UnifiedPlannerWorkspace.test.tsx app/planner/page.test.tsx`
Expected: FAIL because only two views exist and the board is a disconnected card grid.

- [x] **Step 3: Implement the workbench visual system**

Use CSS classes `planner-workbench`, `planner-semester-scroll`,
`planner-repository-rail`, and `planner-agent-drawer`. Keep the existing purple
tokens; add structural surface/header/drop-state tokens only. Do not add a daily
time axis or meeting-time facts.

- [x] **Step 4: Run GREEN**

Run: `cd web; npm test -- --runInBand app/components/UnifiedPlannerWorkspace.test.tsx app/planner/page.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/app/components/UnifiedPlannerWorkspace.tsx web/app/components/UnifiedPlannerWorkspace.test.tsx web/app/globals.css web/app/planner/page.test.tsx
git commit -m "feat(planner): reshape workspace as semester table"
```

### Task 6: UI regression gate

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`

- [x] **Step 1: Run focused and full web verification**

```bash
cd web
npm test -- --runInBand
npm run typecheck
npm run build
```

Expected: all commands exit 0 without unexpected warnings.

- [x] **Step 2: Run root planner API/manual-authority regressions**

```bash
npm test -- --runInBand tests/api/manual_board_edit_contract.test.ts tests/api/manual_board_edit_service.test.ts tests/api/manual_board_edit_endpoint.test.ts tests/api/server_apply_authority.test.ts
```

Expected: PASS.

- [x] **Step 3: Update progress with exact evidence and commit**

```bash
git add AUTONOMOUS_PROGRESS.md
git commit -m "docs: record semester table verification"
```
