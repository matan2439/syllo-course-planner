import BrandLogo from '../features/shell/components/BrandLogo'
import ShaderGradientBackground from '../features/shell/components/ShaderGradientBackground'
import LandingCtas from '../features/shell/components/LandingCtas'
import ThemeToggle from '../features/shell/components/ThemeToggle'

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
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
          <h1 className="sr-only">Syllo — תכנון לימודים חכם</h1>
          <div className="rise">
            <BrandLogo variant="wordmark" size="clamp(6.5rem, 15vw, 11rem)" />
          </div>

          <p className="rise rise-1 mt-4 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            תכנון לימודים פשוט, ברור ומותאם לך.
          </p>

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

        <footer className="px-6 py-5 text-center text-xs text-[var(--text-muted)] opacity-70">
          אוניברסיטת תל אביב
        </footer>
      </div>
    </>
  )
}
