import Link from 'next/link'
import { planOverview } from '../../lib/board'
import { programSubtitle, readBoardForProgram } from '../../lib/board-data'
import { getProgram, programQuery } from '../../lib/programs'
import { adaptRequirements } from '../../lib/requirements'
import ProductShell from '../components/ProductShell'
import RequirementsProgressPanel from '../components/RequirementsProgressPanel'
import { Badge, Card, EmptyState } from '../components/ui'

export const metadata = { title: 'תכנון — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

const SECTIONS = [
  {
    href: '/planner',
    title: 'תכנון עם AI',
    description: 'מספרים מה חשוב לכם — והעוזר בונה תוכנית',
    primary: true,
  },
  {
    href: '/board',
    title: 'לוח סמסטרים',
    description: 'התוכנית לפי סמסטרים, עם שעות ועומס',
    primary: false,
  },
  {
    href: '/repository',
    title: 'מאגר קורסים',
    description: 'חיפוש ועיון בכל קורסי התוכנית',
    primary: false,
  },
] as const

// Planner hub: calm status + the three planning surfaces. This shell is the
// bridge away from the static HTML — AI planning still opens the canonical
// /planner until that surface is migrated.
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  const raw = await readBoardForProgram(program)
  const query = programQuery(program.id)

  const overview = raw ? planOverview(raw) : null
  const requirements = raw ? adaptRequirements(raw) : null

  return (
    <ProductShell
      active="plan"
      title="תכנון"
      subtitle={programSubtitle(program)}
      width="narrow"
      programId={program.id}
    >
      <div className="rise mb-8 flex flex-wrap items-center gap-2">
        {overview && (
          <>
            <Badge variant="purple">
              {overview.plannedCourses} קורסים מתוכננים
            </Badge>
            <Badge>{overview.semesterCount} סמסטרים</Badge>
          </>
        )}
        <Link
          href="/programs"
          className="text-xs text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
        >
          החלפת תוכנית
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {SECTIONS.map((s, i) => (
          <Link
            key={s.href}
            href={`${s.href}${query}`}
            className={`rise group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)] ${
              i > 0 ? `rise-${Math.min(i, 3)}` : ''
            }`}
          >
            <Card
              className={`h-full px-5 py-5 transition-[transform,box-shadow,border-color] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-premium)] ${
                s.primary
                  ? 'border-purple-500/40 group-hover:border-purple-500/60'
                  : 'group-hover:border-purple-500/30'
              }`}
            >
              <h2
                className={`text-base font-bold tracking-tight ${
                  s.primary ? 'text-[var(--purple)]' : ''
                }`}
              >
                {s.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                {s.description}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="rise rise-3 mt-10">
        {requirements ? (
          <RequirementsProgressPanel requirements={requirements} />
        ) : (
          <EmptyState>
            נתוני התוכנית עדיין לא זמינים כאן
            <br />
            <Link
              href="/programs"
              className="mt-2 inline-block text-[var(--purple)] hover:underline"
            >
              בחירת תוכנית אחרת
            </Link>
          </EmptyState>
        )}
      </div>
    </ProductShell>
  )
}
