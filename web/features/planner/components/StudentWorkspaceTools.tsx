'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ExamOverview from '../../schedule/components/ExamOverview';
import { semesterTitleHe } from '../../../lib/planner/board-vm';
import { programWorkspaceSchema, type ProgramWorkspace, type SavedPlan, type SavedWeeklySchedule } from '../../../../shared/planner/student-workspace';
import { useLocale } from '../../locale/LocaleProvider';
import BiddingPanel from '../../bidding/BiddingPanel';
import SavedPlansPanel from './SavedPlansPanel';
import { captureSavedPlan, type BoardSnapshot } from '../lib/saved-plans';
import { loadStudentWorkspace, saveStudentWorkspace, restoreStudentPlan, fetchBiddingHistory, shareBiddingResults, WorkspaceError } from '../lib/student-workspace-client';
import { uuidv4 } from '../../../lib/ai-session-token';
import type { SavedCourseSearch } from '../../../../shared/planner/catalog-searches';
import { MAX_COURSE_NOTES, type CourseNote } from '../../../../shared/planner/course-notes';
import type { CourseNotesLibrary } from '../../courses/components/CourseNotesSection';
import type { BiddingRoundSnapshot, BiddingRoundTransition } from '../../../../shared/planner/bidding-rounds';

export interface CourseSearchLibrary { searches: readonly SavedCourseSearch[]; ready: boolean; change: (searches: SavedCourseSearch[]) => void }
const EMPTY_SEARCHES: readonly SavedCourseSearch[] = [];
const EMPTY_NOTES: readonly CourseNote[] = [];
const withRounds = (plan: SavedPlan, rounds: BiddingRoundSnapshot[] | undefined): SavedPlan => rounds ? { ...plan, biddingRounds: JSON.parse(JSON.stringify(rounds)) } : plan;

// Ignore object and course ordering when deciding whether a restored combination
// has reached both live surfaces. Version changes alone are not course edits.
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const placements = (semesters: SavedPlan['semesters']) => semesters.map((semester) => ({ ...semester, courseIds: [...semester.courseIds].sort() })).sort((a, b) => a.semesterId.localeCompare(b.semesterId));
const sameBoard = (plan: Pick<SavedPlan, 'semesters'>, snapshot: BoardSnapshot) => stable(placements(plan.semesters)) === stable(placements(snapshot.semesters));
const matches = (plan: Pick<SavedPlan, 'semesters' | 'weeklySchedule'>, snapshot: BoardSnapshot, weekly: SavedWeeklySchedule) =>
  sameBoard(plan, snapshot) && stable(plan.weeklySchedule) === stable(weekly);

/** Mounted per account + board window. It never caches a prior account's plans. */
export default function StudentWorkspaceTools({ programId, snapshot, weeklySchedule, onRestored, onWeeklyHydrated, prepareRestore, onSearchLibrary, onNotesLibrary, biddingTarget }: {
  programId: string; snapshot: BoardSnapshot | null; weeklySchedule: SavedWeeklySchedule;
  onRestored: (weekly: SavedWeeklySchedule) => void;
  onWeeklyHydrated?: (weekly: SavedWeeklySchedule) => void;
  prepareRestore?: () => Promise<void>;
  onSearchLibrary?: (library: CourseSearchLibrary | null) => void;
  onNotesLibrary?: (library: CourseNotesLibrary | null) => void;
  /** The workspace's bidding tab: the planner renders there (it owns the bidding data here). */
  biddingTarget?: HTMLElement | null;
}) {
  const { t, dir } = useLocale();
  const [data, setData] = useState<ProgramWorkspace>(() => programWorkspaceSchema.parse({}));
  const [loaded, setLoaded] = useState(false);
  const [hydrationReady, setHydrationReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const ref = useRef({ revision: 0, data, loaded: false });
  const live = useRef(true);
  const initialized = useRef(false);
  const hydrated = useRef(false);
  const operating = useRef(false);
  const conflicted = useRef(false);
  const pending = useRef<{ plan: SavedPlan; deleteId?: string; initial: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const retryRestore = useRef<{ id: string; key: string; version: string | null } | null>(null);
  const failedRestore = useRef<{ plan: SavedPlan; initial: boolean } | null>(null);
  const fail = useCallback((err: unknown) => {
    if (!live.current) return;
    const isConflict = err instanceof WorkspaceError && err.code === 'WORKSPACE_VERSION_CONFLICT';
    conflicted.current = isConflict;
    setFailed(true); setConflict(isConflict);
    setMessage(isConflict
      ? t('התוכניות השתנו במכשיר אחר. שמרו עותק של השינויים ורעננו לפני ניסיון נוסף.', 'Plans changed on another device. Keep a copy of your changes and reload before retrying.')
      : err instanceof WorkspaceError && err.code === 'SIGN_IN_REQUIRED'
        ? t('יש להתחבר לחשבון כדי לשתף תוצאות.', 'Sign in to share results.')
        : err instanceof WorkspaceError && err.code === 'PLAN_INVALID'
          ? t('החלופה אינה עומדת בכללים העדכניים. הלוח הפעיל נשמר; עדכנו את החלופה ונסו שוב.', 'This alternative fails current rules. Your active board was preserved; update the alternative and retry.')
          : t('הפעולה לא הושלמה. בדקו את החיבור ונסו שוב; השינויים האחרונים עדיין מוצגים כאן.', 'The operation did not finish. Check your connection and retry; your latest changes remain visible here.'));
  }, [t]);

  const load = useCallback(async () => {
    try {
      const result = await loadStudentWorkspace(programId);
      if (!live.current) return;
      initialized.current = false; hydrated.current = false; setHydrationReady(false); pending.current = null; operating.current = false; conflicted.current = false;
      ref.current = { ...result, loaded: true }; setData(result.data); setLoaded(true); setBusy(false); setFailed(false); setConflict(false); setMessage('');
    } catch (err) { fail(err); }
  }, [programId, fail]);
  useEffect(() => {
    live.current = true; void load();
    return () => { live.current = false; clearTimeout(timer.current); };
    // Locale copy changes must not reload over an edited draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  const save = useCallback(() => {
    clearTimeout(timer.current); timer.current = undefined;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!live.current || !ref.current.loaded || conflicted.current) return;
      const payload = ref.current.data;
      setBusy(true);
      try {
        const result = await saveStudentWorkspace(programId, ref.current.revision, payload);
        if (!live.current) return;
        ref.current.revision = result.revision;
        setFailed(false);
        if (ref.current.data === payload) setMessage(t('נשמר אוטומטית', 'Saved automatically'));
      } catch (err) { fail(err); throw err; }
      finally { if (live.current && !operating.current) setBusy(false); }
    });
    void queue.current.catch(() => {});
  }, [programId, fail, t]);
  const mutate = useCallback((next: ProgramWorkspace, immediate = true) => {
    if (!live.current || !ref.current.loaded || conflicted.current) return;
    ref.current.data = next; setData(next); setFailed(false); setMessage(t('שומר…', 'Saving…'));
    clearTimeout(timer.current);
    if (immediate) save(); else timer.current = setTimeout(save, 750);
  }, [save, t]);
  const changeSearches = useCallback((courseSearches: SavedCourseSearch[]) => {
    mutate({ ...ref.current.data, courseSearches });
  }, [mutate]);
  const searches = data.courseSearches ?? EMPTY_SEARCHES;
  useEffect(() => {
    onSearchLibrary?.({ searches, ready: loaded && !conflict, change: changeSearches });
  }, [searches, loaded, conflict, changeSearches, onSearchLibrary]);
  useEffect(() => () => onSearchLibrary?.(null), [onSearchLibrary]);
  const notes = data.courseNotes ?? EMPTY_NOTES;
  const saveNote = useCallback<CourseNotesLibrary['save']>((input) => {
    const current = ref.current.data.courseNotes ?? [];
    const now = Date.now();
    const existing = input.id ? current.find((note) => note.id === input.id) : undefined;
    if (!existing && current.length >= MAX_COURSE_NOTES) return;
    const { id: _id, ...fields } = input;
    const note: CourseNote = { ...fields, id: existing?.id ?? `note_${uuidv4()}`, visibility: 'private', createdAt: existing?.createdAt ?? now, updatedAt: now };
    mutate({ ...ref.current.data, courseNotes: existing ? current.map((item) => item.id === note.id ? note : item) : [...current, note] });
  }, [mutate]);
  const removeNote = useCallback((id: string) => {
    mutate({ ...ref.current.data, courseNotes: (ref.current.data.courseNotes ?? []).filter((note) => note.id !== id) });
  }, [mutate]);
  useEffect(() => {
    onNotesLibrary?.({ notes, ready: loaded && !conflict, save: saveNote, remove: removeNote });
  }, [notes, loaded, conflict, saveNote, removeNote, onNotesLibrary]);
  useEffect(() => () => onNotesLibrary?.(null), [onNotesLibrary]);
  const replacePlan = (plan: SavedPlan) => mutate({ ...ref.current.data, plans: ref.current.data.plans.map((p) => p.id === plan.id ? { ...plan, name: plan.name.trim(), updatedAt: Date.now() } : p) });

  const restore = useCallback(async (plan: SavedPlan, initial = false, deleteId?: string) => {
    if (!snapshot || operating.current || conflicted.current) return;
    operating.current = true; setBusy(true);
    if (timer.current) save();
    const attempt = retryRestore.current?.id === plan.id ? retryRestore.current : { id: plan.id, key: `restore_${uuidv4()}`, version: snapshot.version };
    retryRestore.current = attempt;
    try {
      await queue.current;
      if (!live.current) return;
      await prepareRestore?.();
      if (!live.current) return;
      const restored = await restoreStudentPlan(programId, plan.id, attempt.version, attempt.key);
      if (!live.current) return;
      retryRestore.current = null; failedRestore.current = null;
      pending.current = { plan: { ...plan, semesters: restored.board?.semesters ?? plan.semesters, weeklySchedule: restored.weeklySchedule, bidding: restored.bidding ?? plan.bidding, biddingRounds: restored.biddingRounds ?? plan.biddingRounds }, initial, deleteId };
      // Persist the selected slot as soon as validation succeeds, while live
      // capture remains gated until the restored board and timetable arrive.
      mutate({ ...ref.current.data, activePlanId: plan.id, bidding: restored.bidding ?? ref.current.data.bidding, biddingRounds: restored.biddingRounds ?? plan.biddingRounds ?? [] });
      onRestored(restored.weeklySchedule);
      // The restore is complete only when BOTH parent props contain the target.
      // Keep editing and autosave paused while React remounts the live board.
      setMessage(t('טוען תוכנית…', 'Loading plan…')); setFailed(false);
    } catch (err) {
      if (err instanceof WorkspaceError) retryRestore.current = null;
      failedRestore.current = { plan, initial }; pending.current = null; operating.current = false;
      if (live.current) setBusy(false);
      fail(err);
    }
  }, [snapshot, save, prepareRestore, programId, onRestored, t, fail, mutate]);

  useEffect(() => {
    if (!loaded || !snapshot || conflicted.current) return;
    const switching = pending.current;
    if (switching) {
      if (switching.initial ? stable(switching.plan.weeklySchedule) !== stable(weeklySchedule) : !matches(switching.plan, snapshot, weeklySchedule)) return;
      pending.current = null; operating.current = false; hydrated.current = true; setHydrationReady(true); setBusy(false);
      const next = { ...ref.current.data, activePlanId: switching.plan.id,
        bidding: switching.plan.bidding ?? ref.current.data.bidding,
        biddingRounds: switching.plan.biddingRounds ?? [],
        plans: ref.current.data.plans.filter((plan) => plan.id !== switching.deleteId).map((plan) => switching.initial && plan.id === switching.plan.id && !matches(plan, snapshot, weeklySchedule)
          ? { ...withRounds(captureSavedPlan(plan.id, plan.name, snapshot, weeklySchedule, switching.plan.bidding ?? ref.current.data.bidding), switching.plan.biddingRounds), notes: plan.notes, createdAt: plan.createdAt } : plan) };
      if (stable(next) !== stable(ref.current.data)) mutate(next);
      else setMessage(t('נשמר אוטומטית', 'Saved automatically'));
      return;
    }
    if (!initialized.current) {
      initialized.current = true;
      const plans = ref.current.data.plans;
      if (!plans.length) {
        const plan = withRounds(captureSavedPlan(`plan_${uuidv4()}`, t('תוכנית 1', 'Plan 1'), snapshot, weeklySchedule, ref.current.data.bidding), ref.current.data.biddingRounds);
        hydrated.current = true; setHydrationReady(true);
        mutate({ ...ref.current.data, plans: [plan], activePlanId: plan.id });
        return;
      }
      const selected = plans.find((plan) => plan.id === ref.current.data.activePlanId);
      // A tab may close after the board commit but before the selected-slot
      // write finishes. Recognize its target without replacing the prior slot.
      const active = selected && sameBoard(selected, snapshot) ? selected
        : plans.find((plan) => matches(plan, snapshot, weeklySchedule)) ?? plans.find((plan) => sameBoard(plan, snapshot)) ?? selected;
      if (!active) {
        // Migrate a library created before numbered slots without replacing one
        // of the student's independent saved alternatives with the live board.
        hydrated.current = true; setHydrationReady(true);
        if (plans.length < 30) {
          const plan = withRounds(captureSavedPlan(`plan_${uuidv4()}`, t(`תוכנית ${plans.length + 1}`, `Plan ${plans.length + 1}`), snapshot, weeklySchedule, ref.current.data.bidding), ref.current.data.biddingRounds);
          mutate({ ...ref.current.data, plans: [...plans, plan], activePlanId: plan.id });
        }
        return;
      }
      if (stable(active.weeklySchedule) !== stable(weeklySchedule)) {
        // The committed board is authoritative on mount. Only hydrate the
        // slot's timetable here; switching numbered slots is an explicit RPC.
        pending.current = { plan: { ...active, semesters: snapshot.semesters }, initial: true };
        operating.current = true; setBusy(true);
        (onWeeklyHydrated ?? onRestored)(active.weeklySchedule);
        return;
      }
      hydrated.current = true; setHydrationReady(true);
      const bidding = active.bidding ?? ref.current.data.bidding;
      const biddingRounds = active.biddingRounds ?? [];
      if (ref.current.data.activePlanId !== active.id || stable(bidding) !== stable(ref.current.data.bidding) || stable(biddingRounds) !== stable(ref.current.data.biddingRounds ?? [])) {
        mutate({ ...ref.current.data, activePlanId: active.id, bidding, biddingRounds });
      }
    }
    if (!hydrated.current || operating.current) return;
    const active = ref.current.data.plans.find((plan) => plan.id === ref.current.data.activePlanId);
    if (!active || (matches(active, snapshot, weeklySchedule) && active.catalogVersion === snapshot.catalogVersion)) return;
    const captured = { ...withRounds(captureSavedPlan(active.id, active.name, snapshot, weeklySchedule, ref.current.data.bidding), ref.current.data.biddingRounds), notes: active.notes, createdAt: active.createdAt };
    mutate({ ...ref.current.data, plans: ref.current.data.plans.map((plan) => plan.id === active.id ? captured : plan) }, false);
  }, [loaded, snapshot, weeklySchedule, data, restore, mutate, t, onWeeklyHydrated, onRestored]);

  const ready = loaded && Boolean(snapshot) && hydrationReady && !conflict;
  const create = (name: string) => {
    if (!snapshot || !ready || operating.current || ref.current.data.plans.length >= 30) return;
    const plan = withRounds(captureSavedPlan(`plan_${uuidv4()}`, name, snapshot, weeklySchedule, ref.current.data.bidding), ref.current.data.biddingRounds);
    mutate({ ...ref.current.data, plans: [...ref.current.data.plans, plan], activePlanId: plan.id });
  };
  const saveRound = (snapshot: BiddingRoundSnapshot, nextDraft = ref.current.data.bidding) => {
    if (!ready || operating.current) return;
    const previous = ref.current.data.biddingRounds ?? [];
    if (previous.length >= 20 || previous.some((item) => item.id === snapshot.id)) return;
    const biddingRounds = [...previous, snapshot];
    mutate({ ...ref.current.data, bidding: nextDraft, biddingRounds,
      plans: ref.current.data.plans.map((plan) => plan.id === ref.current.data.activePlanId ? { ...plan, bidding: nextDraft, biddingRounds, updatedAt: Date.now() } : plan) });
  };
  return <div dir={dir} className="min-w-0 space-y-2">
    <SavedPlansPanel plans={data.plans} activePlanId={data.activePlanId} ready={ready} busy={busy} courseNames={snapshot?.courseNames ?? {}} courseHours={snapshot?.courseHours ?? {}}
      onCreate={create} onChange={replacePlan} onRestore={(plan) => void restore(plan)}
      onDuplicate={(plan) => create(`${plan.name.slice(0, 65)} ${t('(עותק)', '(copy)')}`)}
      onDelete={(plan) => { const next = ref.current.data.plans.find((item) => item.id !== plan.id); if (next) void restore(next, false, plan.id); }} />
    {biddingTarget && createPortal(<div dir={dir} className="space-y-4">
      <section aria-label={t('מבחנים בתוכנית', 'Exams in this plan')} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <h3 className="mb-2 text-sm font-semibold">{t('מועדי מבחנים', 'Exam dates')}</h3>
        <ExamOverview exams={weeklySchedule.exams ?? []} semesterId={null} minGapDays={weeklySchedule.examGapDays}
          courseName={(id) => snapshot?.courseNames[id] ?? id} semesterLabel={semesterTitleHe} />
      </section>
      <fieldset disabled={!ready || busy} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <BiddingPanel programId={programId} courseOptions={Object.entries(snapshot?.courseNames ?? {}).map(([id, name]) => ({ id, name }))}
          roundSnapshots={data.biddingRounds ?? []} onRoundSnapshot={(round) => saveRound(round)}
          onRoundTransition={({ snapshot: round, nextDraft }: BiddingRoundTransition) => saveRound(round, nextDraft)}
          draft={data.bidding} onChange={(bidding) => mutate({ ...ref.current.data, bidding,
            plans: ref.current.data.plans.map((plan) => plan.id === ref.current.data.activePlanId ? { ...plan, bidding, updatedAt: Date.now() } : plan) }, false)}
          loadHistory={(draft) => fetchBiddingHistory(programId, draft)} onShare={(draft, consent) => shareBiddingResults(programId, draft, consent)} />
      </fieldset>
    </div>, biddingTarget)}
    {(message || !loaded) && <p aria-live="polite" className={`text-xs ${failed ? 'text-red-600 dark:text-red-300' : 'text-[var(--text-muted)]'}`}>
      {message || t('טעינת תוכניות אישיות…', 'Loading personal plans…')}
      {failed && !conflict && <button type="button" className="ms-2 underline" onClick={() => { const retry = failedRestore.current; if (retry) void restore(retry.plan, retry.initial); else if (loaded) save(); else void load(); }}>{t('נסה שוב', 'Retry')}</button>}
      {conflict && <span className="ms-2 inline-flex flex-wrap gap-2">
        <button type="button" className="underline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(ref.current.data, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'syllo-unsaved-plans.json'; link.click(); URL.revokeObjectURL(url);
        }}>{t('הורד עותק של השינויים שלי', 'Download my changes')}</button>
        <button type="button" className="underline" onClick={() => void load()}>{t('החלף בגרסה השמורה בחשבון', 'Replace with the saved account version')}</button>
      </span>}
    </p>}
  </div>;
}
