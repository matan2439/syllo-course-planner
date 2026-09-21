import { render, screen } from '@testing-library/react'
import ProductShell from './ProductShell'

jest.mock('./ShaderGradientBackground', () => ({
  __esModule: true,
  default: () => <div aria-hidden="true" />,
}))

describe('ProductShell header', () => {
  test('wraps the header navigation so every control can remain inside a narrow viewport', () => {
    render(
      <ProductShell>
        <div>תוכן</div>
      </ProductShell>,
    )

    expect(screen.getByRole('banner')).toHaveClass('flex-wrap')
    expect(screen.getByRole('navigation')).toHaveClass('w-full', 'flex-wrap')
  })

  test('shows the current program as a chip that links to the program picker', () => {
    render(
      <ProductShell programId="mechanical_engineering_2025">
        <div>תוכן</div>
      </ProductShell>,
    )

    const chip = screen.getByRole('link', { name: /החלפת תוכנית/ })
    expect(chip).toHaveAttribute('href', '/programs?program=mechanical_engineering_2025')
    expect(chip).toHaveTextContent('הנדסה מכנית · 2025')
  })

  test('renders no chip without a program and renders the progress slot', () => {
    render(
      <ProductShell progress={<span>שעות 84/160</span>}>
        <div>תוכן</div>
      </ProductShell>,
    )

    expect(screen.queryByRole('link', { name: /החלפת תוכנית/ })).not.toBeInTheDocument()
    expect(screen.getByText('שעות 84/160')).toBeInTheDocument()
  })
})
