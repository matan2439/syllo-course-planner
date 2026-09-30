/**
 * case_draft.ts — a suggested customer reply for a billing case (billing_alerts row).
 *
 * Deterministic templates filled ONLY from the factual case record (payment,
 * credits, adjustments). No LLM, no legal conclusions, and nothing is ever sent:
 * the flow is AUTO-GENERATE DRAFT → ADMIN REVIEWS → ADMIN SENDS (outside Syllo).
 * Refund / dispute wording is a placeholder until the approved templates exist.
 */
import type { EvidencePackage } from './evidence';

export const DRAFT_TEMPLATE_VERSION = 'draft-v1-unreviewed';

type Kind = 'refund' | 'dispute' | 'payment' | 'general';

export function caseKind(code: string): Kind {
  if (code.startsWith('chargeback')) return 'dispute';
  if (code.startsWith('refund') || code === 'adjustment_needs_review') return 'refund';
  if (['user_mapping_failed', 'unknown_price', 'completed_payment_without_grant', 'transaction_needs_review'].includes(code)) return 'payment';
  return 'general';
}

const money = (amount: number | null, currency: string | null) =>
  amount == null ? '-' : `${(amount / 100).toFixed(2)} ${currency ?? ''}`.trim();

export function draftReply(alert: { id: string | number; code: string }, e: EvidencePackage | null): string {
  const kind = caseKind(alert.code);
  const ref = `Syllo case #${alert.id}`;
  const facts = e ? [
    `Purchase: ${e.purchase.package_id} · ${money(e.purchase.amount_total, e.purchase.currency)} · Paddle ${e.purchase.paddle_transaction_id ?? '-'}`,
    `Date: ${e.purchase.purchased_at ?? '-'} · status: ${e.purchase.status}`,
    `Credits: ${e.credits.purchased} purchased · ${e.credits.consumed} used · ${e.credits.unused} unused · ${e.credits.revoked} revoked`,
  ] : ['(no purchase linked to this case)'];
  const factsHe = e ? [
    `רכישה: ${e.purchase.package_id} · ${money(e.purchase.amount_total, e.purchase.currency)} · מזהה Paddle ${e.purchase.paddle_transaction_id ?? '-'}`,
    `תאריך: ${e.purchase.purchased_at ?? '-'} · מצב: ${e.purchase.status}`,
    `קרדיטים: ${e.credits.purchased} נרכשו · ${e.credits.consumed} נוצלו · ${e.credits.unused} לא נוצלו · ${e.credits.revoked} בוטלו`,
  ] : ['(אין רכישה מקושרת לפנייה זו)'];

  const body: Record<Kind, [string, string]> = {
    refund: [
      'בהמשך לבקשת ההחזר שלך, אלה הנתונים שמופיעים אצלנו. ההחזר הכספי עצמו מבוצע על ידי Paddle, ספק התשלומים שלנו.',
      'Regarding your refund request, these are the details on our records. The refund itself is processed by Paddle, our payment provider.',
    ],
    dispute: [
      'קיבלנו הודעה על מחלוקת בחיוב. אלה נתוני הרכישה והשימוש שמופיעים אצלנו.',
      'We were notified of a payment dispute. These are the purchase and usage details on our records.',
    ],
    payment: [
      'בדקנו את התשלום שלך. אלה הנתונים שמופיעים אצלנו, ואנחנו מטפלים בהשלמת הזיכוי.',
      'We reviewed your payment. These are the details on our records, and we are completing the credit grant.',
    ],
    general: [
      'תודה על פנייתך. אלה הנתונים שמופיעים אצלנו.',
      'Thank you for reaching out. These are the details on our records.',
    ],
  };
  const legal = kind === 'refund' || kind === 'dispute'
    ? ['', '[REQUIRES LEGAL REVIEW — placeholder wording; do not send until the approved template exists]']
    : [];
  return [
    `[DRAFT ${DRAFT_TEMPLATE_VERSION} · ${ref} · review before sending]`,
    ...legal,
    '',
    'שלום,', body[kind][0], ...factsHe, '', 'צוות Syllo',
    '',
    '---',
    '',
    'Hello,', body[kind][1], ...facts, '', 'The Syllo team',
  ].join('\n');
}
