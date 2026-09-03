/**
 * Theme-aware brand mark. Asset convention:
 *   web/public/brand/logo-light.svg — shown on light backgrounds
 *   web/public/brand/logo-dark.svg  — shown on dark backgrounds
 * Switching is native <picture> + prefers-color-scheme: zero JS, no flash.
 */
export default function BrandLogo({ size = 28, wordmark = false }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet="/brand/logo-dark.svg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-light.svg" alt="Syllo" width={Math.round(size * 1.8)} height={size} />
      </picture>
      {wordmark && <span className="syllo-wordmark text-base font-semibold tracking-[0.16em]">Syllo</span>}
    </span>
  )
}
