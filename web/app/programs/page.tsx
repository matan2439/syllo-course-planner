import Link from 'next/link'
import {
  getProgram,
  listProgramFamilies,
  programQuery,
  type ProgramFamilyVM,
} from '../../lib/programs'
import ProductShell from '../components/ProductShell'
import { Badge, Card } from '../components/ui'

export const metadata = { title: 'בחירת תוכנית — מתכנן לימודים' }

function ProgramFamilyCard({
  family,
  currentId,
  index,
}: {
  family: ProgramFamilyVM
  currentId: string
  index: number
}) {
  const isCurrent =
    family.defaultProgram.id === currentId ||
    family.archivePrograms.some((p) => p.id === currentId)

  return (
    <div className={`rise ${index > 0 ? `rise-${Math.min(index, 3)}` : ''}`}>
      <Link
        href={`/plan${programQuery(family.defaultProgram.id)}`}
        className="group block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
      >
        <Card className="px-5 py-5 transition-[transform,box-shadow,border-color] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:border-purple-500/40 group-hover:shadow-[var(--shadow-premium)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold tracking-tight">
                {family.name}
              </h2>
              {family.track && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {family.track}
                </p>
              )}
            </div>
            {isCurrent ? (
              <Badge variant="success">תוכנית נוכחית</Badge>
            ) : (
              <Badge>{family.defaultProgram.year}</Badge>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
            {family.description}
          </p>
          <p className="mt-3 text-sm font-medium text-[var(--purple)]">
            המשך לתכנון ←
          </p>
        </Card>
      </Link>

      {family.archivePrograms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          {family.archivePrograms.map((p) => (
            <Link
              key={p.id}
              href={`/plan${programQuery(p.id)}`}
              className="text-xs text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
            >
              גרסה קודמת · {p.year}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Next-native replacement candidate for the static planner's program modal.
// Families and versions mirror the canonical registry (see lib/programs.ts).
export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const currentId = getProgram(programParam).id
  const families = listProgramFamilies()

  return (
    <ProductShell
      title="בחירת תוכנית"
      subtitle="איזו תוכנית מתכננים?"
      width="narrow"
      programId={currentId}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {families.map((f, i) => (
          <ProgramFamilyCard
            key={f.id}
            family={f}
            currentId={currentId}
            index={i}
          />
        ))}
      </div>
    </ProductShell>
  )
}
