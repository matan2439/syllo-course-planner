import { render, screen } from '@testing-library/react'
import ProductShell from './ProductShell'

jest.mock('./ShaderGradientBackground', () => ({
  __esModule: true,
  default: () => <div aria-hidden="true" />,
}))

describe('ProductShell responsive navigation', () => {
  test('wraps the header navigation so every control can remain inside a narrow viewport', () => {
    render(
      <ProductShell active="plan">
        <div>תוכן</div>
      </ProductShell>,
    )

    expect(screen.getByRole('banner')).toHaveClass('flex-wrap')
    expect(screen.getByRole('navigation')).toHaveClass('w-full', 'flex-wrap')
  })
})
