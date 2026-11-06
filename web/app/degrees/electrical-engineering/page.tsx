import { notFound, redirect } from 'next/navigation'
import { isServableProgramId } from '../../../../shared/programs'

export const metadata = { title: 'הנדסת חשמל — Syllo' }
export const dynamic = 'force-dynamic'

export default async function ElectricalEngineeringPage() {
  if (!isServableProgramId('electrical_engineering_2027')) notFound()
  redirect('/planner?program=electrical_engineering_2027')
}
