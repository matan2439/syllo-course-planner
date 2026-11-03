import ProductShell from '../../features/shell/components/ProductShell'
import UniversityPicker from '../../features/shell/components/UniversityPicker'
import { UNIVERSITIES } from '../../lib/universities'

export const metadata = { title: 'בחירת מוסד לימודים — Syllo' }

export default function UniversitiesPage() {
  return (
    <ProductShell title="בחירת מוסד לימודים" subtitle="באיזו אוניברסיטה אתם לומדים?" width="narrow">
      <UniversityPicker universities={UNIVERSITIES} />
    </ProductShell>
  )
}
