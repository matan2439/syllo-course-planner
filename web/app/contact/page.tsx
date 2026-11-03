import Link from 'next/link'
import ProductShell from '../../features/shell/components/ProductShell'
import { PUBLIC_SITE } from '../../lib/public-site'

export const metadata = { title: 'יצירת קשר — Syllo' }

export default function ContactPage() {
  return (
    <ProductShell title="יצירת קשר" subtitle="שאלות על התכנון, החשבון או פרטיות" width="narrow">
      <div className="max-w-2xl space-y-8 text-sm leading-relaxed">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
          <h2 className="text-base font-bold">כתבו לנו</h2>
          <p className="mt-2 text-[var(--text-muted)]">אפשר לפנות באימייל לתמיכה ב־Syllo. כדי שנוכל לעזור, תארו את השאלה ואת העמוד שבו נתקלתם בבעיה.</p>
          <a href={`mailto:${PUBLIC_SITE.supportEmail}`} className="mt-5 inline-block break-all text-lg font-semibold text-[var(--purple)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"><bdi>{PUBLIC_SITE.supportEmail}</bdi></a>
          <p className="mt-5 text-xs text-[var(--text-muted)]">אל תשלחו סיסמאות, מספרי כרטיס אשראי או תעודות זהות.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">בקשות פרטיות ובירורי חיוב</h2>
          <p>לבקשת גישה למידע, תיקון או מחיקה, כתבו מה תרצו לבדוק וציינו את כתובת האימייל של החשבון הרלוונטי. מידע נוסף מופיע ב<Link href="/privacy" className="text-[var(--purple)] underline underline-offset-4">מדיניות הפרטיות</Link>.</p>
          <p>לבירור רכישה אפשר לציין את מזהה העסקה, ללא פרטי כרטיס. להנחיות לבקשת החזר עיינו ב<Link href="/refund-policy" className="text-[var(--purple)] underline underline-offset-4">מדיניות ההחזרים</Link>.</p>
        </section>
        <section className="space-y-2 border-t border-[var(--border)] pt-6">
          <h2 className="text-base font-bold">מפעיל השירות</h2>
          <p>{PUBLIC_SITE.operatorName} — {PUBLIC_SITE.operatorType}, ישראל.</p>
          <p className="text-[var(--text-muted)]">Syllo הוא כלי עצמאי לתכנון לימודים ואינו אתר רשמי של אוניברסיטת תל אביב.</p>
        </section>
      </div>
    </ProductShell>
  )
}
