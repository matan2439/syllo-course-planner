import Link from 'next/link'
import ProductShell from '../../features/shell/components/ProductShell'

export const metadata = { title: 'חבילות ומחירים — Syllo' }

// Owner-approved launch offers. Checkout entitlement remains server-authoritative.
const LAUNCH_OFFERS = [
  { name: 'תכנון ממוקד', uses: 10, price: '6.99' },
  { name: 'תכנון והעמקה', uses: 15, price: '9.99' },
  { name: 'תכנון רחב', uses: 20, price: '12.99' },
] as const

export default function PricingPage() {
  return (
    <ProductShell title="חבילות לשיחות עם עוזר הלימודים" subtitle="תכנון לימודים, בחינת אפשרויות ועדכון התוכנית שלכם" width="narrow">
      <div className="space-y-9">
        <section lang="en" dir="ltr" aria-labelledby="software-packages-heading" className="max-w-2xl space-y-3 text-sm leading-relaxed">
          <h2 id="software-packages-heading" className="text-lg font-bold">AI-use packages for Syllo academic planning software</h2>
          <p>Syllo is a browser-based digital product. The approved launch packages below cover 10, 15, or 20 AI responses delivered in the Syllo app: course-planning answers or study-plan proposals. One delivered response counts as one use; a conversation may consume several uses.</p>
          <p className="text-[var(--text-muted)]">Approved one-time base prices: USD $6.99 / $9.99 / $12.99. Purchases are not available yet. The final amount, currency, and applicable taxes will be shown before payment when paid access launches.</p>
          <Link href="/product" className="inline-block text-[var(--purple)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">See the software and how it works</Link>
        </section>
        <aside aria-label="סטטוס המחירים" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm leading-relaxed">
          <h2 className="font-bold">חבילות מאושרות לקראת פתיחת השירות לתשלום</h2>
          <p className="mt-2 text-[var(--text-muted)]">מחירי הבסיס והיקף השימוש של החבילות אושרו לקראת פתיחת השירות לתשלום. הרכישה עדיין אינה זמינה. הסכום הסופי, המטבע והמיסים הרלוונטיים יוצגו לפני אישור רכישה.</p>
        </aside>

        <section aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="mb-4 text-base font-bold">בחרו כמה מקום להשאיר לשאלות</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {LAUNCH_OFFERS.map((offer) => (
              <article key={offer.uses} className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <h3 className="font-bold">{offer.name}</h3>
                <p className="mt-5 text-3xl font-bold tracking-tight text-[var(--purple)]"><bdi dir="ltr">${offer.price}</bdi></p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">הערכת מחיר חד־פעמי ב־USD</p>
                <p className="mt-6 text-lg font-semibold">{offer.uses} תשובות AI</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">סיוע בבניית תוכנית לימודים, השוואת קורסים ושינויים בתכנון לפי ההעדפות שלכם.</p>
                <p className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">לא זמין לרכישה כרגע</p>
              </article>
            ))}
          </div>
        </section>

        <section className="max-w-2xl space-y-3 text-sm leading-relaxed" aria-labelledby="uses-heading">
          <h2 id="uses-heading" className="text-base font-bold">מה נחשב שימוש?</h2>
          <p>שימוש אחד הוא תשובה אחת של עוזר ה־AI שנמסרה לכם. זו יכולה להיות תשובה לשאלה או הצעה לתכנון. שיחה עם כמה תשובות צורכת כמה שימושים; החבילה אינה מבטיחה מספר מסוים של תוכניות מלאות.</p>
          <p className="text-[var(--text-muted)]">השימושים הם יחידות שירות של Syllo, ואינם טוקנים של OpenAI או של ספק מודל אחר. אין בעמוד הזה התחייבות למנוי או לחיוב מתחדש.</p>
        </section>

        <section className="max-w-2xl space-y-3 text-sm leading-relaxed" aria-labelledby="planning-heading">
          <h2 id="planning-heading" className="text-base font-bold">החלטות לימודים נשארות בידיים שלכם</h2>
          <p>העוזר מסייע בתכנון על בסיס המידע הזמין. הוא יכול לטעות, ואינו מחליף בדיקה מול הידיעון והגורמים המוסמכים באוניברסיטה. אין התחייבות לקבלה לקורס, לעמידה בדרישות התואר או לציון.</p>
          <p>מידע על ביטולים והחזרים מופיע ב<Link href="/refund-policy" className="text-[var(--purple)] underline underline-offset-4">מדיניות ההחזרים</Link>. שאלות על השירות? <Link href="/contact" className="text-[var(--purple)] underline underline-offset-4">צרו קשר</Link>.</p>
        </section>
      </div>
    </ProductShell>
  )
}
