/**
 * legal_versions.ts — WHICH texts a buyer accepted, by version id.
 *
 * ⚠ REQUIRES LEGAL REVIEW. Every id and text below is a technical placeholder.
 * Final wording (Supplier Terms, Refund Policy, Privacy Policy, the purchase
 * disclosure and any immediate-service consent) must be approved by counsel and
 * aligned with Paddle's buyer terms before production. Bump the version id
 * whenever the text changes: old purchases keep the version they accepted.
 *
 * Nothing here is a legal conclusion. In particular, whether an explicit
 * "start immediately" consent changes any withdrawal/refund right is a
 * jurisdiction-specific question (docs/billing/ISRAEL_LEGAL_REVIEW_CHECKLIST.md);
 * the slot exists so it can be captured if counsel requires it.
 */
export const LEGAL_VERSIONS = {
  supplierTerms: 'supplier-terms-DRAFT-2026-09',
  refundPolicy: 'refund-policy-DRAFT-2026-09',
  privacyPolicy: 'privacy-DRAFT-2026-09',
  purchaseDisclosure: 'purchase-disclosure-DRAFT-2026-09',
} as const

/** Set to a version id once counsel requires an explicit consent checkbox. */
export const IMMEDIATE_SERVICE_CONSENT_VERSION: string | null = null

/** REQUIRES LEGAL REVIEW — placeholder shown next to the Buy button (Hebrew UI). */
export const PURCHASE_DISCLOSURE_HE = [
  'קרדיטים של Syllo זמינים לשימוש מיד לאחר אישור התשלום, ושירותי ה-AI יכולים להתחיל מיד.',
  'קרדיטים שנוצלו משקפים שירות שכבר סופק.',
  'הרכישה מעובדת על ידי Paddle כמשווק הרשמי (Merchant of Record). זכויות ביטול והחזר כפופות לתנאי Paddle ולדין החל.',
] as const

/** REQUIRES LEGAL REVIEW — label for the optional explicit-consent checkbox. */
export const IMMEDIATE_SERVICE_CONSENT_HE = 'אני מבקש/ת שהשירות יתחיל מיד לאחר הרכישה.'

export interface AcceptedTerms {
  supplier_terms: string
  refund_policy: string
  privacy_policy: string
  purchase_disclosure: string
  immediate_service_consent: string | null
  accepted_at: string
}

/**
 * REQUIRES LEGAL REVIEW — the customer-facing refund policy page (/refund-policy),
 * version LEGAL_VERSIONS.refundPolicy. Describes the PROCESS only; which refunds
 * are granted is decided by counsel-approved policy (api/billing/refund_policy.ts
 * LEGAL_POLICY is 'unreviewed', so every request is reviewed manually).
 */
export const REFUND_POLICY_HE: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  {
    title: 'איך מבקשים החזר',
    items: [
      'מחוברים? פתחו את תפריט החשבון ← "קניית קרדיטים". תחת "הרכישות שלי" יש ליד כל רכישה כפתור "בקשת החזר".',
      'כתבו בקצרה למה אתם מבקשים החזר. הבקשה מגיעה לצוות Syllo, שבודק אותה ידנית וחוזר אליכם באימייל של החשבון.',
      'אפשר לראות את מצב הבקשה באותו מקום. בקשה נוספת על אותה רכישה מעדכנת את הבקשה הקיימת.',
    ],
  },
  {
    title: 'מי מבצע את ההחזר',
    items: [
      'התשלום מעובד על ידי Paddle, המשווק הרשמי (Merchant of Record). החזר שאושר מבוצע דרך Paddle לאמצעי התשלום המקורי, ו-Paddle שולחת אישור זיכוי (credit note).',
      'העברת הכסף לאמצעי התשלום עשויה להימשך כמה ימים, בהתאם לחברת האשראי או לאמצעי התשלום.',
      'זכויות ביטול והחזר כפופות לתנאי Paddle ולדין החל.',
    ],
  },
  {
    title: 'מה קורה לקרדיטים',
    items: [
      'שליחת בקשה לא משנה את היתרה: הקרדיטים נשארים זמינים עד שהחזר מאושר בפועל.',
      'לאחר החזר, קרדיטים שטרם נוצלו מהרכישה שהוחזרה מבוטלים בחשבון.',
      'קרדיטים שנוצלו משקפים שירות שכבר סופק; ההחלטה על החזר בגינם נבחנת בכל בקשה לגופה.',
    ],
  },
]
