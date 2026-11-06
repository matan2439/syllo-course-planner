import { notFound } from 'next/navigation'
import Explorer from '../../../features/degrees/ElectricalEngineeringExplorer'

export const metadata = { title: 'הנדסת חשמל — תצוגת בדיקה — Syllo' }
export const dynamic = 'force-dynamic'

export default async function DegreePreview(props: { searchParams: Promise<{ window?: string; track?: string }> }) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV !== 'development') notFound()
  return <Explorer {...props} />
}
