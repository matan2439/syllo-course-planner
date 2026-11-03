import Link from 'next/link'
import ProductShell from '../../features/shell/components/ProductShell'
import { PUBLIC_SITE } from '../../lib/public-site'
import { LEGAL_VERSIONS } from '../../../shared/billing/legal_versions'

export const metadata = { title: 'תנאי שימוש — Syllo' }

// Initial supplier-terms draft. Review before launch; does not alter refund rights.
export default function TermsPage() {
  return (
    <ProductShell title="תנאי שימוש" subtitle={`טיוטה לעיון — ${LEGAL_VERSIONS.supplierTerms}`} width="narrow">
      <div className="max-w-2xl space-y-7 text-sm leading-relaxed">
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="font-bold">תנאים בהכנה לקראת פתיחת השירות לתשלום</h2>
          <p className="mt-2 text-[var(--text-muted)]">זהו נוסח טיוטה שטרם הושלם ואושר משפטית. הוא אינו אישור לפתיחת מכירות. לפני השקת השירות בתשלום יפורסם הנוסח המאושר.</p>
        </aside>
        <section className="space-y-2">
          <h2 className="text-base font-bold">מי מפעיל את השירות</h2>
          <p>Syllo מופעל על ידי {PUBLIC_SITE.operatorName}, {PUBLIC_SITE.operatorType}, ישראל. מדובר בכלי עצמאי לתכנון לימודים, ללא זיקה רשמית לאוניברסיטת תל אביב.</p>
          <p>לפניות: <a href={`mailto:${PUBLIC_SITE.supportEmail}`} className="text-[var(--purple)] underline underline-offset-4"><bdi>{PUBLIC_SITE.supportEmail}</bdi></a>.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">מה השירות מספק</h2>
          <p>השירות מסייע בבחירת קורסים ובבניית לוח סמסטרים. עוזר ה־AI יכול להציע אפשרויות ולענות על שאלות בהתאם למידע ולהעדפות שתמסרו.</p>
          <p>מידע ותשובות AI עשויים להיות חלקיים או שגויים. יש לבדוק תנאי קבלה, דרישות תואר, זמינות קורסים ומועדי רישום מול המקורות הרשמיים. השירות אינו ייעוץ אקדמי רשמי ואינו מבטיח תוצאה לימודית.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">חשבון ושימוש בשירות</h2>
          <p>שמרו על פרטי הגישה לחשבון ואל תשתפו סיסמאות. השתמשו בשירות לצורכי תכנון לימודים ובאופן חוקי; אין לעקוף מגבלות שימוש, לפגוע במערכת או לנסות לגשת למידע של אחרים.</p>
          <p>מסרו רק מידע הנחוץ לתכנון. אל תשלחו לעוזר סיסמאות, פרטי תשלום או מסמכים אישיים שאינם נדרשים לשירות.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">חבילות, תשלומים והחזרים</h2>
          <p>החבילות ב<Link href="/pricing" className="text-[var(--purple)] underline underline-offset-4">עמוד המחירים</Link> הן הצעות בפיתוח. רכישות, אם וכאשר השירות ייפתח לתשלום, יעובדו דרך Paddle כמשווק הרשמי (Merchant of Record). פרטי ההצעה יוצגו לפני אישור התשלום.</p>
          <p>תהליך בקשת ההחזר מתואר ב<Link href="/refund-policy" className="text-[var(--purple)] underline underline-offset-4">מדיניות ההחזרים הקיימת</Link>. עמוד זה אינו מוסיף מגבלה על זכויות ביטול או החזר ואינו משנה את המדיניות. זכויות לפי הדין החל ותנאי Paddle נשמרות.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">פרטיות ויצירת קשר</h2>
          <p>המידע שנשמר והשימוש בו מתוארים ב<Link href="/privacy" className="text-[var(--purple)] underline underline-offset-4">מדיניות הפרטיות</Link>. לשאלות על החשבון, השירות או פרטיות אפשר לפנות דרך <Link href="/contact" className="text-[var(--purple)] underline underline-offset-4">עמוד יצירת הקשר</Link>.</p>
        </section>
      </div>
    </ProductShell>
  )
}
