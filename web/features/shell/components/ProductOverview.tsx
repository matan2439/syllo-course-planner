import Link from 'next/link'
import { PUBLIC_SITE } from '../../../lib/public-site'

const LINK_STYLE = 'text-[var(--purple)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]'

export default function ProductOverview() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <section lang="en" dir="ltr" aria-labelledby="digital-product-heading" className="max-w-2xl space-y-4 text-sm leading-relaxed">
        <h2 id="digital-product-heading" className="text-2xl font-bold sm:text-3xl">Your degree plan, organized in your browser.</h2>
        <p className="text-base">Syllo is a digital software product for students planning courses and semesters at Tel Aviv University. Open the web app, choose a supported degree program, and work with your course repository, semester board, degree requirements, and AI assistant.</p>
        <p className="text-[var(--text-muted)]">The interface is primarily in Hebrew. Syllo is independently operated by {PUBLIC_SITE.operatorName}, a sole trader in Israel, and has no official affiliation with the university.</p>
        <div className="flex flex-wrap gap-4 pt-2">
          <Link href="/programs" className="rounded-full bg-[var(--purple-strong)] px-6 py-3 font-semibold text-white hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">Open the software</Link>
          <Link href="/pricing" className={`${LINK_STYLE} self-center`}>View proposed packages and pricing</Link>
        </div>
      </section>

      <section lang="en" dir="ltr" aria-labelledby="workspace-heading" className="space-y-4">
        <h2 id="workspace-heading" className="text-lg font-bold">What you use inside Syllo</h2>
        <dl className="grid gap-x-8 gap-y-6 border-y border-[var(--border)] py-6 sm:grid-cols-2">
          <div className="space-y-2">
            <dt className="font-bold">Semester planning board</dt>
            <dd className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">Organize selected courses by semester and review your planned study load.</dd>
          </div>
          <div className="space-y-2">
            <dt className="font-bold">Course repository</dt>
            <dd className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">Browse courses for supported programs and inspect course details while building your plan.</dd>
          </div>
          <div className="space-y-2">
            <dt className="font-bold">Degree requirements</dt>
            <dd className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">Review requirements and progress using the program data available in Syllo.</dd>
          </div>
          <div className="space-y-2">
            <dt className="font-bold">AI planning assistant</dt>
            <dd className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">Ask planning questions, describe preferences, and review suggested changes before applying a proposal.</dd>
          </div>
        </dl>
      </section>

      <section lang="en" dir="ltr" aria-labelledby="workflow-heading" className="max-w-2xl space-y-4 text-sm leading-relaxed">
        <h2 id="workflow-heading" className="text-lg font-bold">How it works</h2>
        <ol className="list-decimal space-y-3 ps-5">
          <li>Choose a degree program from the <Link href="/programs" className={LINK_STYLE}>program picker</Link>. Each supported program opens its planning workspace.</li>
          <li>Browse the course repository, arrange your semester board, and check the available requirements.</li>
          <li>Use the assistant to explore a question or proposed plan. Review its output and choose whether to apply changes. AI features may require sign-in and an available usage balance.</li>
        </ol>
        <p className="text-[var(--text-muted)]">AI responses can be incomplete or incorrect. Verify course availability and degree requirements with official university sources before making academic decisions.</p>
      </section>

      <section lang="en" dir="ltr" aria-labelledby="purchase-heading" className="max-w-2xl space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm leading-relaxed">
        <h2 id="purchase-heading" className="text-lg font-bold">The planned paid product</h2>
        <p>We plan to offer one-time packages of 10, 15, or 20 AI responses for use within Syllo. Each use delivers a course-planning answer or study-plan proposal digitally in the application. Syllo tracks the remaining usage balance in your account.</p>
        <p className="text-[var(--text-muted)]">Paid packages are not available for purchase yet. The amounts on the <Link href="/pricing" className={LINK_STYLE}>pricing page</Link> are estimates awaiting final approval. One use means one delivered AI response; a multi-response conversation consumes multiple uses.</p>
        <nav aria-label="Product terms and support" className="flex flex-wrap gap-x-5 gap-y-3">
          <Link href="/terms" className={LINK_STYLE}>Terms &amp; Conditions</Link>
          <Link href="/privacy" className={LINK_STYLE}>Privacy Policy</Link>
          <Link href="/refund-policy" className={LINK_STYLE}>Refund Policy</Link>
          <Link href="/contact" className={LINK_STYLE}>Customer support</Link>
        </nav>
      </section>

      <section aria-labelledby="hebrew-product-heading" className="max-w-2xl space-y-3 text-sm leading-relaxed">
        <h2 id="hebrew-product-heading" className="text-lg font-bold">מה מקבלים ב־Syllo?</h2>
        <p>Syllo הוא מוצר תוכנה דיגיטלי לשימוש בדפדפן. בוחרים תוכנית לימודים, מעיינים במאגר הקורסים, מארגנים לוח סמסטרים ובודקים את דרישות התואר הזמינות. עוזר ה־AI מסייע בבחינת שאלות והצעות לתכנון.</p>
        <p>חבילות השימוש המוצעות יאפשרו לקבל תשובות והצעות של עוזר ה־AI בתוך היישום. החבילות והמחירים עדיין בפיתוח ואינם זמינים לרכישה. כל תשובה שנמסרה נחשבת שימוש אחד; שיחה יכולה לכלול כמה שימושים.</p>
        <Link href="/programs" className={`${LINK_STYLE} inline-block`}>פתחו את התוכנה ובחרו תוכנית לימודים</Link>
      </section>
    </div>
  )
}
