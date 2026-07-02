import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'מתכנן לימודים — אוניברסיטת תל אביב',
  description: 'תכנון מערכת לימודים חכם עם עוזר AI — אוניברסיטת תל אביב',
  icons: { icon: '/brand/logo-light.svg' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1117' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
