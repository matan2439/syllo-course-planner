/**
 * Theme-aware brand lockup. The two supplied Syllo marks stay in the DOM so
 * explicit `data-theme` choices and the OS default can both select the right
 * contrast without a hydration-time flash or a second logo implementation.
 */
export default function BrandLogo({ size = 28, wordmark = false }: { size?: number; wordmark?: boolean }) {
  const markWidth = Math.round(size * 2)
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="img"
        aria-label="Syllo"
        data-theme-aware="true"
        className="syllo-brand-mark"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-light.svg"
          alt=""
          aria-hidden="true"
          width={markWidth}
          height={size}
          style={{ width: `${markWidth}px`, height: `${size}px` }}
          className="syllo-brand-asset syllo-brand-asset-light"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-dark.svg"
          alt=""
          aria-hidden="true"
          width={markWidth}
          height={size}
          style={{ width: `${markWidth}px`, height: `${size}px` }}
          className="syllo-brand-asset syllo-brand-asset-dark"
        />
      </span>
      {wordmark && <span data-testid="syllo-wordmark" aria-hidden="true" className="syllo-wordmark">Syllo</span>}
    </span>
  )
}
