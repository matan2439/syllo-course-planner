import { render, screen } from '@testing-library/react'
import BrandLogo from './BrandLogo'

test('exposes a theme-aware Syllo mark and a distinct wordmark', () => {
  render(<BrandLogo size={30} wordmark />)

  expect(screen.getByRole('img', { name: 'Syllo' })).toHaveAttribute('data-theme-aware', 'true')
  expect(screen.getByRole('img', { name: 'Syllo' }).querySelector('.syllo-brand-asset-light')).toHaveStyle({
    width: '60px',
    height: '30px',
  })
  expect(screen.getByTestId('syllo-wordmark')).toHaveTextContent('Syllo')
  expect(screen.getByTestId('syllo-wordmark')).toHaveClass('syllo-wordmark')
})
