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
