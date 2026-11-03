import Link from 'next/link'
import BrandLogo from '../features/shell/components/BrandLogo'
import ShaderGradientBackground from '../features/shell/components/ShaderGradientBackground'
import LandingCtas from '../features/shell/components/LandingCtas'
import ThemeToggle from '../features/shell/components/ThemeToggle'
import PublicSiteFooter from '../features/shell/components/PublicSiteFooter'

const FEATURES = [
  'עוזר AI שבונה תוכנית מלאה',
  'לוח סמסטרים אינטראקטיבי',
  'בדיקת דרישות התואר אוטומטית',
]

export default function Home() {
  return (
    <>
      <ShaderGradientBackground />

      <div className="flex min-h-screen flex-col">
        <header className="flex flex-wrap items-center gap-3 px-6 py-5 sm:px-10">
          <BrandLogo size={30} />
          <nav aria-label="מידע על המוצר" className="ms-auto flex flex-wrap items-center gap-4 text-sm">
            <Link href="/product" className="hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">איך Syllo עובד / Product</Link>
            <Link href="/pricing" className="hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">חבילות ומחירים / Pricing</Link>
          </nav>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
          <div className="rise">
            <BrandLogo variant="wordmark" size="clamp(6.5rem, 15vw, 11rem)" />
          </div>

          <h1 className="rise rise-1 mt-4 max-w-xl text-2xl font-bold sm:text-3xl">תוכנה לתכנון קורסים וסמסטרים</h1>
          <p className="rise rise-1 mt-3 max-w-xl text-base leading-relaxed">
            Syllo הוא יישום דיגיטלי שפועל בדפדפן: בוחרים תוכנית לימודים, מארגנים קורסים בלוח סמסטרים ונעזרים בעוזר AI לבחינת אפשרויות.
          </p>
          <div lang="en" dir="ltr" className="rise rise-1 mt-5 max-w-xl space-y-2">
            <p className="font-semibold">Browser-based academic planning software</p>
            <p className="text-sm leading-relaxed">Syllo is a digital software product for Tel Aviv University students. Organize courses into semesters, check degree requirements, and use an AI assistant to explore your study plan. Proposed one-time packages provide AI responses delivered inside the app.</p>
          </div>

          <div className="rise rise-2 mt-9 flex flex-col items-center gap-4">
            <LandingCtas />
          </div>

          <ul className="rise rise-3 mt-12 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-[var(--text-muted)]">
            {FEATURES.map((f, i) => (
              <li key={f} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="opacity-40">·</span>}
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </main>

        <PublicSiteFooter />
      </div>
    </>
  )
}
