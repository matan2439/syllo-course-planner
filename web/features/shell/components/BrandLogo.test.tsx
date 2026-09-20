import { render, screen } from '@testing-library/react'
import BrandLogo from './BrandLogo'

test('renders the compact infinity mark at its intrinsic aspect ratio by default', () => {
  render(<BrandLogo size={30} />)

  const logo = screen.getByRole('img', { name: 'Syllo' })
  expect(logo).toHaveAttribute('data-theme-aware', 'true')

  const light = logo.querySelector('.syllo-brand-asset-light')
  const dark = logo.querySelector('.syllo-brand-asset-dark')
  expect(light).toHaveAttribute('src', '/brand/syllo-mark-light.png')
  expect(dark).toHaveAttribute('src', '/brand/syllo-mark-dark.png')
  expect(light).toHaveAttribute('width', '920')
  expect(light).toHaveAttribute('height', '568')
  expect(light).toHaveStyle({
    width: 'auto',
    height: '30px',
  })
  expect(logo).toHaveClass('syllo-brand-hover')
  expect(logo).not.toHaveClass('syllo-brand-float')
})

test('renders the Syllo wordmark without the infinity symbol when requested', () => {
  render(<BrandLogo variant="wordmark" size="clamp(5rem, 12vw, 10rem)" />)

  const logo = screen.getByRole('img', { name: 'Syllo' })
  const light = logo.querySelector('.syllo-brand-asset-light')
  const dark = logo.querySelector('.syllo-brand-asset-dark')

  expect(light).toHaveAttribute('src', '/brand/syllo-wordmark-light.png')
  expect(dark).toHaveAttribute('src', '/brand/syllo-wordmark-dark.png')
  expect(light).toHaveAttribute('width', '1210')
  expect(light).toHaveAttribute('height', '600')
  expect(light).toHaveStyle({ height: 'clamp(5rem, 12vw, 10rem)' })
})
