/**
 * Theme-aware brand mark. Asset convention:
 *   web/public/brand/logo-light.svg — shown on light backgrounds
 *   web/public/brand/logo-dark.svg  — shown on dark backgrounds
 * Switching is native <picture> + prefers-color-scheme: zero JS, no flash.
 */
export default function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/brand/logo-dark.svg" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-light.svg"
        alt="מתכנן לימודים"
        width={size}
        height={size}
      />
    </picture>
  )
}
