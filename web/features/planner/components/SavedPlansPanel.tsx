'use client';
import { useEffect, useState } from 'react';
import type { SavedPlan } from '../../../../shared/planner/student-workspace';
import { compareSavedPlans } from '../lib/saved-plans';
import { useLocale } from '../../locale/LocaleProvider';

const button = 'rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:border-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50';

export default function SavedPlansPanel({ plans, activePlanId, ready, busy, courseNames, courseHours, onCreate, onChange, onRestore, onDelete, onDuplicate }: {
  plans: SavedPlan[]; activePlanId?: string; ready: boolean; busy: boolean;
  courseNames: Record<string, string>; courseHours: Record<string, number>;
  onCreate: (name: string) => void; onChange: (plan: SavedPlan) => void;
  onRestore: (plan: SavedPlan) => void; onDelete: (plan: SavedPlan) => void;
  onDuplicate: (plan: SavedPlan) => void;
}) {
  const { t } = useLocale();
  const active = plans.find((plan) => plan.id === activePlanId);
  const [name, setName] = useState(active?.name ?? '');
  const [compared, setCompared] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState<'notes' | 'compare' | null>(null);
  useEffect(() => { setName(active?.name ?? ''); setDeleting(false); }, [active?.id, active?.name]);
  const rename = () => {
    if (active && name.trim() && name.trim() !== active.name) onChange({ ...active, name: name.trim() });
    else setName(active?.name ?? '');
  };
  const pair = compared.map((id) => plans.find((plan) => plan.id === id)).filter((p): p is SavedPlan => Boolean(p));
  const diff = pair.length === 2 ? compareSavedPlans(pair[0], pair[1]) : null;
  const names = (ids: string[]) => ids.map((id) => courseNames[id] ?? id).join(', ') || t('ללא', 'None');
  const peakLoad = active ? Math.max(0, ...active.semesters.map((semester) => semester.courseIds.reduce((sum, id) => sum + (courseHours[id] ?? 0), 0))) : 0;
  return <section data-tour="saved-plans" data-highlight-id="saved-plans" aria-label={t('התוכניות השמורות שלי', 'My saved plans')} className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t('בחירת תוכנית', 'Choose a plan')} className="flex max-w-full flex-wrap gap-1.5">
        {plans.map((plan, index) => <button key={plan.id} type="button" aria-label={t(`תוכנית ${index + 1}: ${plan.name}`, `Plan ${index + 1}: ${plan.name}`)} title={plan.name}
          aria-pressed={plan.id === activePlanId} disabled={busy || !ready} onClick={() => { if (plan.id !== activePlanId) onRestore(plan); }}
          className={`h-9 w-9 shrink-0 rounded-md border text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50 ${plan.id === activePlanId ? 'border-[var(--purple)] bg-[var(--purple)] text-white' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--purple)]'}`}>{index + 1}</button>)}
        <button type="button" aria-label={t('הוסף תוכנית', 'Add a plan')} title={t('עותק חדש של השילוב הנוכחי', 'New copy of the current combination')}
          className="h-9 w-9 shrink-0 rounded-md border border-dashed border-[var(--border)] text-lg text-[var(--text-muted)] hover:border-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50"
          disabled={!ready || busy || plans.length >= 30} onClick={() => onCreate(t(`תוכנית ${plans.length + 1}`, `Plan ${plans.length + 1}`))}>+</button>
      </div>
      {active && <form className="min-w-0 flex-1 sm:max-w-64" onSubmit={(event) => { event.preventDefault(); rename(); }}>
        <input aria-label={t('שם התוכנית הפעילה', 'Active plan name')} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} onBlur={rename}
          disabled={busy || !ready} className="w-full min-w-28 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium hover:border-[var(--border)] focus:border-[var(--purple)] focus:outline-none disabled:opacity-50" />
      </form>}
      {active && <details className="relative">
        <summary aria-label={t('פעולות לתוכנית', 'Plan actions')} className="cursor-pointer list-none rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--text-muted)] hover:border-[var(--purple)] [&::-webkit-details-marker]:hidden">⋯</summary>
        <div role="group" aria-label={t('פעולות לתוכנית', 'Plan actions')} className="absolute end-0 top-full z-30 mt-1 flex w-56 flex-col items-stretch gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-panel)] p-2 text-xs text-[var(--text-muted)] shadow-[var(--shadow-premium)]">
        <span title={t('עומס שיא ידוע', 'Known peak load')}>{new Set(active.semesters.flatMap((semester) => semester.courseIds)).size} {t('קורסים', 'courses')} · {peakLoad} {t('ש״ש שיא', 'peak h/week')}</span>
        <button type="button" className={button} aria-pressed={open === 'notes'} onClick={() => setOpen(open === 'notes' ? null : 'notes')}>{t('הערות', 'Notes')}</button>
        <button type="button" className={button} disabled={busy || !ready || plans.length >= 30} onClick={() => onDuplicate(active)}>{t('שכפל', 'Duplicate')}</button>
        {plans.length > 1 && <button type="button" className={button} aria-pressed={open === 'compare'} onClick={() => setOpen(open === 'compare' ? null : 'compare')}>{t('השווה', 'Compare')}</button>}
        <button type="button" className={button} aria-label={t('מחק תוכנית', 'Delete plan')} disabled={busy || !ready || plans.length <= 1} onClick={() => setDeleting(true)}>{t('מחק', 'Delete')}</button>
        </div>
      </details>}
    </div>
    {active && open === 'notes' && <label className="block space-y-1 text-xs text-[var(--text-muted)]"><span>{t('הערות לתוכנית', 'Plan notes')}</span><textarea key={active.id} defaultValue={active.notes} maxLength={2000} disabled={busy || !ready}
      className="block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm" onBlur={(event) => { if (event.target.value !== active.notes) onChange({ ...active, notes: event.target.value }); }} /></label>}
    {active && deleting && <div className="flex flex-wrap items-center gap-2 text-xs"><span>{t('למחוק את התוכנית?', 'Delete this plan?')}</span><button type="button" className={button} disabled={busy} onClick={() => { onDelete(active); setDeleting(false); }}>{t('אישור מחיקה', 'Confirm deletion')}</button><button type="button" className={button} onClick={() => setDeleting(false)}>{t('ביטול', 'Cancel')}</button></div>}
    {open === 'compare' && plans.length > 1 && <div className="text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap gap-3">{plans.map((plan, index) => <label key={plan.id} className="flex items-center gap-1"><input type="checkbox" checked={compared.includes(plan.id)} disabled={!compared.includes(plan.id) && compared.length >= 2} onChange={(event) => setCompared((old) => event.target.checked ? [...old, plan.id] : old.filter((id) => id !== plan.id))} />{index + 1}. {plan.name}</label>)}</div>
      {diff && <div className="mt-3 space-y-1"><p>{t('נוספו', 'Added')}: {names(diff.added)}</p><p>{t('הוסרו', 'Removed')}: {names(diff.removed)}</p><p>{t('הועברו בין סמסטרים', 'Moved between semesters')}: {names(diff.moved)}</p><p>{t('בחירות קבוצות ששונו', 'Changed group choices')}: {diff.changedGroups.length}</p></div>}
    </div>}
  </section>;
}
