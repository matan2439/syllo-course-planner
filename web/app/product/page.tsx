import ProductShell from '../../features/shell/components/ProductShell'
import ProductOverview from '../../features/shell/components/ProductOverview'

export const metadata = {
  title: 'המוצר / Academic planning software — Syllo',
  description: 'Explore Syllo, browser-based academic planning software for Tel Aviv University students, with a semester board, course repository, and AI assistant.',
}

export default function ProductPage() {
  return (
    <ProductShell title="Syllo — תוכנה דיגיטלית לתכנון לימודים" subtitle="קורסים, סמסטרים ועוזר AI במרחב אחד" width="narrow">
      <ProductOverview />
    </ProductShell>
  )
}
