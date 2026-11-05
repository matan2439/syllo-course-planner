import { notFound } from 'next/navigation'
import Explorer from '../../../features/degrees/ElectricalEngineeringExplorer'
import ProductShell from '../../../features/shell/components/ProductShell'

export const metadata = { title: 'הנדסת חשמל — Syllo' }
export const dynamic = 'force-dynamic'

export default async function ElectricalEngineeringPage(props: {
  searchParams: Promise<{ window?: string; track?: string }>
}) {
  if (process.env.ENABLE_EE_EXPLORER !== '1') notFound()
  return <ProductShell width="full" title="הנדסת חשמל" subtitle="אוניברסיטת תל אביב · תצוגת בטא">
    <Explorer {...props} />
  </ProductShell>
}
