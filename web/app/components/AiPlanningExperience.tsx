'use client'

/**
 * Presentation-only AI planning entry (the Next replacement candidate for the
 * static planner's AI panel). No planner call is made from here yet — the
 * primary action demonstrates the loading choreography and lands on an honest
 * "not wired" result shell that hands off to the canonical assistant at
 * /planner. Preference labels reuse the canonical panel's language.
 */
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Card } from './ui'

// Same default/range as the canonical panel (MAX_HOURS=20, slider 14–30)
const DEFAULT_MAX_HOURS = 20

const LOADING_STAGES = ['בודק דרישות', 'מסדר סמסטרים', 'מאזן עומס', 'מכין טיוטה']

const RESULT_SECTIONS = [
  'סיכום התוכנית',
  'מה השתנה',
  'דרישות שכוסו',
  'קורסים שלא שובצו',
]

type Phase = 'idle' | 'building' | 'done' | 'error'

function AiPreferenceCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Card className="px-4 py-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </Card>
  )
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:border-purple-500/40 focus:outline-none'

function AiLoadingState({ stage }: { stage: number }) {
  return (
    <Card className="px-5 py-6 text-center" aria-busy>
      <p aria-live="polite" className="text-sm font-medium">
        {LOADING_STAGES[stage]}…
      </p>
      <div className="mt-3 flex justify-center gap-1.5">
        {LOADING_STAGES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              i <= stage ? 'bg-[var(--purple)]' : 'bg-black/10 dark:bg-white/15'
            }`}
          />
        ))}
      </div>
    </Card>
  )
}

function AiResultShell({
  plannerHref,
  onBack,
}: {
  plannerHref: string
  onBack: () => void
}) {
  return (
    <Card className="rise px-5 py-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">הטיוטה תופיע כאן</h2>
        <Badge>תצוגה מקדימה</Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        המסך הזה עדיין לא מחובר לעוזר. התכנון המלא — כולל שיחה, טיוטות ובדיקת
        חוקיות — זמין במתכנן.
      </p>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {RESULT_SECTIONS.map((s) => (
          <li key={s}>
            <Badge>{s}</Badge>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link
          href={plannerHref}
          className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
        >
          מעבר לעוזר המלא
        </Link>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
        >
          חזרה להעדפות
        </button>
      </div>
    </Card>
  )
}

function AiErrorState({
  boardHref,
  onRetry,
}: {
  boardHref: string
  onRetry: () => void
}) {
  return (
    <Card className="rise px-5 py-6">
      <h2 className="text-sm font-bold">לא הצלחנו לבנות תוכנית כרגע</h2>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
        >
          נסה שוב
        </button>
        <Link
          href={boardHref}
          className="text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)]"
        >
          אפשר להמשיך ידנית בלוח
        </Link>
      </div>
    </Card>
  )
}

export default function AiPlanningExperience({
  programQuerySuffix,
}: {
  programQuerySuffix: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [stage, setStage] = useState(0)
  const [maxHours, setMaxHours] = useState(DEFAULT_MAX_HOURS)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  const build = () => {
    setPhase('building')
    setStage(0)
    let i = 0
    timer.current = setInterval(() => {
      i += 1
      if (i >= LOADING_STAGES.length) {
        if (timer.current) clearInterval(timer.current)
        setPhase('done')
      } else {
        setStage(i)
      }
    }, 900)
  }

  const plannerHref = `/planner${programQuerySuffix}`
  const boardHref = `/board${programQuerySuffix}`

  if (phase === 'building') return <AiLoadingState stage={stage} />
  if (phase === 'done')
    return <AiResultShell plannerHref={plannerHref} onBack={() => setPhase('idle')} />
  if (phase === 'error')
    return <AiErrorState boardHref={boardHref} onRetry={build} />

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AiPreferenceCard title="מצב לימודים">
          <p className="text-sm text-[var(--text-muted)]">
            נלקח מ״הקורסים שלי״ במתכנן —{' '}
            <Link
              href={plannerHref}
              className="text-[var(--purple)] hover:underline"
            >
              עריכה
            </Link>
          </p>
        </AiPreferenceCard>

        <AiPreferenceCard title="עומס שבועי מקסימלי">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={14}
              max={30}
              step={1}
              value={maxHours}
              onChange={(e) => setMaxHours(Number(e.target.value))}
              aria-label="עומס שבועי מקסימלי רצוי"
              className="flex-1 accent-[var(--purple)]"
            />
            <span className="w-14 shrink-0 text-sm font-medium">
              {maxHours} ש״ש
            </span>
          </div>
        </AiPreferenceCard>

        <AiPreferenceCard title="קורסים שחשוב לי לקחת">
          <input
            type="text"
            dir="rtl"
            placeholder="שם, קוד קורס או נושא…"
            className={inputClass}
          />
        </AiPreferenceCard>

        <AiPreferenceCard title="קורסים להימנע מהם">
          <input
            type="text"
            dir="rtl"
            placeholder="שם, קוד קורס או נושא…"
            className={inputClass}
          />
        </AiPreferenceCard>
      </div>

      <AiPreferenceCard title="מה עוד חשוב לך?">
        <textarea
          rows={2}
          dir="rtl"
          placeholder="למשל: בלי מעבדות בסמסטר א׳, להעדיף קורסים עם עבודה במקום מבחן…"
          className={`${inputClass} resize-none`}
        />
      </AiPreferenceCard>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={build}
          className="rounded-full bg-[var(--purple-strong)] px-8 py-3 text-base font-semibold text-white shadow-[var(--shadow-premium)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
        >
          בנה תוכנית
        </button>
        <Link
          href={boardHref}
          className="text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
        >
          חזרה ללוח
        </Link>
      </div>
    </div>
  )
}
