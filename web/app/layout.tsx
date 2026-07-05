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
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Seed the shell theme from the same tau_theme the legacy planner
            owns, before paint, so an explicit choice made inside /planner
            survives reload and the shell never desyncs from the iframe.
            No stored choice → the CSS media query follows the OS. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tau_theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
