export type BrandLogoVariant = 'mark' | 'wordmark'

const assets = {
  mark: {
    light: '/brand/syllo-mark-light.png',
    dark: '/brand/syllo-mark-dark.png',
    width: 920,
    height: 568,
  },
  wordmark: {
    light: '/brand/syllo-wordmark-light.png',
    dark: '/brand/syllo-wordmark-dark.png',
    width: 1210,
    height: 600,
  },
} as const

/** Theme-aware Syllo mark or wordmark, cropped directly from the supplied artwork. */
export default function BrandLogo({
  size = 28,
  variant = 'mark',
}: {
  size?: number | string
  variant?: BrandLogoVariant
}) {
  const asset = assets[variant]
  const height = typeof size === 'number' ? `${size}px` : size

  return (
    <span
      role="img"
      aria-label="Syllo"
      data-theme-aware="true"
      className={`syllo-brand-mark syllo-brand-${variant} syllo-brand-hover`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.light}
        alt=""
        aria-hidden="true"
        width={asset.width}
        height={asset.height}
        style={{ width: 'auto', height }}
        className="syllo-brand-asset syllo-brand-asset-light"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.dark}
        alt=""
        aria-hidden="true"
        width={asset.width}
        height={asset.height}
        style={{ width: 'auto', height }}
        className="syllo-brand-asset syllo-brand-asset-dark"
      />
    </span>
  )
}
