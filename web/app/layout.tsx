import type { Metadata, Viewport } from 'next'
import './globals.css'
import ThemeAwareFavicon from './components/ThemeAwareFavicon'

export const metadata: Metadata = {
  title: 'מתכנן לימודים — אוניברסיטת תל אביב',
  description: 'תכנון מערכת לימודים חכם עם עוזר AI — אוניברסיטת תל אביב',
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
        <link
          id="syllo-favicon"
          rel="icon"
          type="image/png"
          sizes="920x568"
          href="/brand/syllo-mark-light.png"
        />
        {/* Seed the shell theme from the same tau_theme the legacy planner
            owns, before paint, so an explicit choice made inside /planner
            survives reload and the shell never desyncs from the iframe.
            No stored choice → the CSS media query follows the OS. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tau_theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;var d=document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var i=document.getElementById('syllo-favicon');if(i)i.href=d?'/brand/syllo-mark-dark.png':'/brand/syllo-mark-light.png'}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeAwareFavicon />
        {children}
      </body>
    </html>
  )
}
