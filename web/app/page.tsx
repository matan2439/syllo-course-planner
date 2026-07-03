import Link from 'next/link'
import BrandLogo from './components/BrandLogo'
import ShaderGradientBackground from './components/ShaderGradientBackground'

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
        <header className="flex items-center gap-3 px-6 py-5 sm:px-10">
          <BrandLogo size={30} />
          <span className="text-sm font-semibold tracking-tight">
            מתכנן לימודים
          </span>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
          <h1 className="rise max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            התואר שלך, מתוכנן חכם
          </h1>

          <p className="rise rise-1 mt-4 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            עוזר AI שבונה איתך את לוח הסמסטרים — אוניברסיטת תל אביב
          </p>

          <div className="rise rise-2 mt-9 flex flex-col items-center gap-4">
            <Link
              href="/planner"
              className="inline-block rounded-full bg-[var(--purple-strong)] px-8 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-premium)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
            >
              התחלת תכנון עם AI
            </Link>
            <Link
              href="/plan"
              className="text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
            >
              צפייה בתוכנית
            </Link>
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

        <footer className="px-6 py-5 text-center text-xs text-[var(--text-muted)] opacity-70">
          אוניברסיטת תל אביב
        </footer>
      </div>
    </>
  )
}
