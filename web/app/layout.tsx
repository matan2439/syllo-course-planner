import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'מתכנן לימודים — אוניברסיטת תל אביב',
  description: 'תכנון מערכת לימודים באוניברסיטת תל אביב',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-gray-50 antialiased">{children}</body>
    </html>
  )
}
