import earlyBoard from '../../../data/boards/electrical_engineering_years_1_2_2027.json'
import lateBoard from '../../../data/boards/electrical_engineering_2027.json'
import spec from '../../../data/degrees/tau/electrical_engineering/2027/spec.json'

export default async function ElectricalEngineeringExplorer({ searchParams }: {
  searchParams: Promise<{ window?: string; track?: string }>
}) {
  const query = await searchParams
  const early = query.window === 'early'
  const board = early ? earlyBoard : lateBoard
  const tracks = spec.categories.filter(category => category.group === 'track')
  const selectedTrack = tracks.find(track => track.category_id === query.track)
  const courses = board.metadata.program_repository_courses.filter(course =>
    !selectedTrack || selectedTrack.course_ids.includes(course.course_id))
  const coreRule = spec.course_rules.find(rule => rule.rule_id === 'core-four-distinct-tracks')
  const coreByTrack = (coreRule?.params as { category_members?: Record<string, string[]> })?.category_members ?? {}
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
    <section aria-label="דרישות התואר" className="rounded-xl border p-4">
      <h2 className="text-xl font-bold">דרישות התואר</h2>
      <p>לפחות {lateBoard.metadata.program_requirements_categories.group_minimums.track} קורסי מסלול לאורך התואר. קורס שמשויך למספר מסלולים נספר פעם אחת; מעבדות מתקדמות נספרות בנפרד.</p>
      <p>דרישות הליבה ממסלולים שונים ויתר התנאים המיוחדים עדיין דורשים השלמת תמיכה במתכנן.</p>
    </section>
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
      <nav aria-label="מסלולי התמחות" className="flex flex-wrap gap-3">
        <a href={`?window=${early ? 'early' : 'late'}`} aria-current={!selectedTrack ? 'page' : undefined}>כל המסלולים</a>
        {tracks.map(track => <a key={track.category_id}
          href={`?window=${early ? 'early' : 'late'}&track=${track.category_id}`}
          aria-current={selectedTrack?.category_id === track.category_id ? 'page' : undefined}>
          {track.name_he}
        </a>)}
      </nav>
      <p>שיוך למסלולים וקורסי ליבה מוצגים לפי המקורות. אימות שילוב הליבות ממסלולים שונים עדיין בפיתוח.</p>
      <div className="overflow-x-auto"><table className="w-full text-right">
        <thead><tr><th>מספר קורס</th><th>שם</th><th>שעות שבועיות</th><th>מסלולים וליבה</th></tr></thead>
        <tbody>{courses.map(course => <tr key={course.course_id} className="border-b">
          <td dir="ltr" className="p-2">{course.course_id}</td><td className="p-2">{course.name_he}</td><td className="p-2">{course.weekly_hours ?? '—'}</td>
          <td className="p-2">{tracks.filter(track => track.course_ids.includes(course.course_id)).map(track =>
            `${track.name_he}${coreByTrack[track.category_id]?.includes(course.course_id) ? ' (ליבה)' : ''}`).join(' · ') || '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>
}
