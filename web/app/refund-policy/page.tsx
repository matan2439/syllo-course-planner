import ProductShell from '../../features/shell/components/ProductShell'
import { LEGAL_VERSIONS, REFUND_POLICY_HE } from '../../../shared/billing/legal_versions'

export const metadata = { title: 'מדיניות החזרים — Syllo' }

// REQUIRES LEGAL REVIEW: the text is a versioned draft in shared/billing/legal_versions.ts.
export default function RefundPolicyPage() {
  return (
    <ProductShell title="מדיניות החזרים" subtitle={`גרסה: ${LEGAL_VERSIONS.refundPolicy}`} width="narrow">
      <div className="space-y-6 text-sm leading-relaxed">
        <p className="text-[var(--text-muted)]">
          קרדיטים של Syllo נרכשים בתשלום חד-פעמי דרך Paddle. העמוד מסביר איך מבקשים החזר ומה קורה אחרי שהבקשה נשלחת.
        </p>
        {REFUND_POLICY_HE.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-base font-bold">{section.title}</h2>
            <ul className="list-disc space-y-1.5 ps-5">
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </ProductShell>
  )
}
