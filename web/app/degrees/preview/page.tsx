import { notFound } from 'next/navigation'
import earlyBoard from '../../../../data/boards/electrical_engineering_years_1_2_2027.json'
import lateBoard from '../../../../data/boards/electrical_engineering_2027.json'

export const metadata = { title: 'הנדסת חשמל — תצוגת בדיקה — Syllo' }
export const dynamic = 'force-dynamic'

export default async function DegreePreview({ searchParams }: {
  searchParams: Promise<{ window?: string }>
}) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV !== 'development') notFound()
  const early = (await searchParams).window === 'early'
  const board = early ? earlyBoard : lateBoard
  const courses = board.metadata.program_repository_courses
  return <main dir="rtl" lang="he" className="mx-auto max-w-7xl space-y-8 p-6">
    <header className="space-y-3">
      <p>Syllo · אוניברסיטת תל אביב · תשפ״ז</p>
      <h1 className="text-3xl font-bold">הנדסת חשמל — תוכנית חד־חוגית</h1>
      <p role="status" className="rounded border border-amber-500 p-4">תצוגת בדיקה של טיוטה. כללי המסלולים, הליבה והפטורים עדיין בבדיקה. התוכנית אינה מאושרת לתכנון או לרישום.</p>
      <nav aria-label="שנות הלימוד" className="flex gap-6">
        <a href="?window=early" aria-current={early ? 'page' : undefined}>שנים א׳–ב׳</a>
        <a href="?window=late" aria-current={!early ? 'page' : undefined}>שנים ג׳–ד׳</a>
      </nav>
    </header>
    <section aria-label="קורסי החובה" className="grid gap-4 md:grid-cols-2">
      {board.semesters.map(semester => <article key={semester.semester_id} className="rounded-xl border p-4">
        <h2 className="mb-3 text-xl font-bold">{semester.display_name}</h2>
        <ul className="space-y-2">{semester.courses.map(course => <li key={course.course_id}>
          <span dir="ltr">{course.course_id}</span> · {course.name_he} · {course.weekly_hours ?? '—'} ש״ש
        </li>)}</ul>
      </article>)}
    </section>
    <section className="space-y-3">
      <h2 className="text-2xl font-bold">מאגר קורסים ({courses.length})</h2>
      <p>שיוך קורס למספר מסלולים וסימון קורסי ליבה עדיין דורשים השלמה בתצוגת המתכנן.</p>
      <div className="overflow-x-auto"><table className="w-full text-right">
        <thead><tr><th>מספר קורס</th><th>שם</th><th>שעות שבועיות</th></tr></thead>
        <tbody>{courses.map(course => <tr key={course.course_id} className="border-b">
          <td dir="ltr" className="p-2">{course.course_id}</td><td className="p-2">{course.name_he}</td><td className="p-2">{course.weekly_hours ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>
}
