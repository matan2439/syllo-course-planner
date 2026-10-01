/**
 * refund_policy.ts — the RefundPolicyEngine.
 *
 * TECHNICAL POLICY ≠ LEGAL POLICY. This engine decides how Syllo ACCOUNTS for
 * financial facts that Paddle (the Merchant of Record) has already decided:
 * an approved refund, a chargeback. It never issues, refuses or sizes a refund.
 *
 * `decideAdjustment` is deterministic, pure and versioned: the facts it saw, the
 * version and its output are persisted to billing_policy_decisions, so every
 * automated action can be explained later. Anything it cannot decide safely
 * becomes MANUAL_REVIEW_REQUIRED — it never guesses.
 *
 * `recommendRefundRequest` is the slot for a future, legally approved refund
 * policy (e.g. a proportional refund for service already delivered). Until
 * counsel and Paddle approve one, LEGAL_POLICY.status is 'unreviewed' and it
 * always answers MANUAL_REVIEW; the proportional figures are analysis only.
 */

export const POLICY_VERSION = 'syllo-technical-2026-09-v1';

export const POLICY_CONFIG = {
  /** Objective pattern threshold before an ACCOUNT is flagged for review (never restricted automatically). */
  refundAfterConsumptionReviewThreshold: 2,
} as const;

/** ⚠ REQUIRES LEGAL REVIEW before any value here changes. */
export const LEGAL_POLICY: { status: 'unreviewed' | 'approved'; version: string; jurisdictions: Record<string, never> } = {
  status: 'unreviewed',
  version: 'legal-none',
  jurisdictions: {},
};

export interface AdjustmentFacts {
  adjustment: {
    id: string;
    action: string;            // refund | chargeback | chargeback_warning | chargeback_reverse | credit | …
    type: string | null;       // full | partial
    status: string;            // pending_approval | approved | rejected | reversed
    amount: number | null;     // minor units
    currency: string | null;
  };
  payment: {
    id: string;
    amountTotal: number | null;
    currency: string | null;
    /** Σ approved refunds BEFORE this adjustment. */
    refundedBefore: number;
    disputeState: 'none' | 'warning' | 'chargeback' | 'reversed';
  };
  lot: { granted: number; consumed: number; reserved: number; revoked: number; unused: number };
  /** Credits already revoked from this lot for earlier refunds. */
  refundRevokedBefore: number;
  risk: { refundAfterConsumptionCount: number; chargebackCount: number };
}

export type PolicyDecision =
  | 'RECORD_ONLY'
  | 'FULL_REFUND_ACCOUNTING'
  | 'PARTIAL_REFUND_ACCOUNTING'
  | 'DISPUTE_PROCESSING'
  | 'MANUAL_REVIEW_REQUIRED';

export type PolicyAction =
  | { type: 'REVOKE_UNUSED_ENTITLEMENT'; kind: 'refund' | 'chargeback'; credits: number | null; close: boolean }
  | { type: 'RECORD_CONSUMED_SERVICE'; credits: number }
  | { type: 'MARK_CONSUMED_BEFORE_REFUND' }
  | { type: 'SET_DISPUTE_STATE'; state: 'warning' | 'chargeback' }
  | { type: 'RAISE_ALERT'; severity: 'review' | 'critical'; code: string }
  | { type: 'FLAG_ACCOUNT_REVIEW' };

export interface PolicyOutcome {
  policyVersion: string;
  decision: PolicyDecision;
  actions: PolicyAction[];
  reasons: string[];
  analysis: ConsumptionAnalysis;
}

export interface ConsumptionAnalysis {
  label: 'analysis_only';
  consumption_ratio: number;
  unused_ratio: number;
  /** Candidate money split of the ORIGINAL payment, minor units. Accounting support only. */
  candidate_consumed_value: number | null;
  candidate_unused_value: number | null;
}

/** consumed / unused ratios of a purchased lot and a candidate proportional split. Never applied automatically. */
export function consumptionAnalysis(lot: AdjustmentFacts['lot'], amountTotal: number | null): ConsumptionAnalysis {
  const consumption = lot.granted > 0 ? lot.consumed / lot.granted : 0;
  const unused = lot.granted > 0 ? (lot.unused + lot.reserved) / lot.granted : 0;
  const consumedValue = amountTotal == null ? null : Math.round(amountTotal * consumption);
  return {
    label: 'analysis_only',
    consumption_ratio: round4(consumption),
    unused_ratio: round4(unused),
    candidate_consumed_value: consumedValue,
    candidate_unused_value: amountTotal == null || consumedValue == null ? null : amountTotal - consumedValue,
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Proportional refund for an admin-issued partial refund: amount_total × unused / granted,
 * in Paddle minor units (the currency's lowest denomination, so integer rounding is
 * the currency rule for 2- and 0-decimal currencies alike). Floored so the webhook's
 * ceil(granted × refunded / total) revocation never exceeds the unused credits, and
 * capped by what is still unrefunded. Reserved (in-flight) credits are not unused.
 */
export function proportionalRefund(input: { amountTotal: number | null; refundedAmount: number; granted: number; unused: number }): number {
  const { amountTotal, refundedAmount, granted, unused } = input;
  if (amountTotal == null || amountTotal <= 0 || granted <= 0 || unused <= 0) return 0;
  return Math.max(0, Math.min(Math.floor((amountTotal * unused) / granted), amountTotal - refundedAmount));
}

/** Admin-issued refunds: sandbox always; production only under an approved legal policy. Fails closed. */
export function adminRefundAllowed(environment: string | null, legal: { status: string } = LEGAL_POLICY): boolean {
  return environment === 'sandbox' || (environment === 'production' && legal.status === 'approved');
}

const manual = (reason: string, analysis: ConsumptionAnalysis): PolicyOutcome => ({
  policyVersion: POLICY_VERSION,
  decision: 'MANUAL_REVIEW_REQUIRED',
  actions: [{ type: 'RAISE_ALERT', severity: 'review', code: 'manual_review' }],
  reasons: [reason],
  analysis,
});

const recordOnly = (reason: string, analysis: ConsumptionAnalysis, extra: PolicyAction[] = []): PolicyOutcome => ({
  policyVersion: POLICY_VERSION, decision: 'RECORD_ONLY', actions: extra, reasons: [reason], analysis,
});

/** Accounting for one Paddle adjustment in one status. Deterministic. */
export function decideAdjustment(facts: AdjustmentFacts): PolicyOutcome {
  const { adjustment: adj, payment, lot } = facts;
  const analysis = consumptionAnalysis(lot, payment.amountTotal);
  const consumedOrHeld = lot.consumed;

  if (adj.currency && payment.currency && adj.currency !== payment.currency) {
    return manual('adjustment currency differs from the payment currency', analysis);
  }

  if (adj.action === 'refund') {
    if (adj.status === 'pending_approval') return recordOnly('refund requested, not confirmed: nothing changes', analysis);
    if (adj.status === 'rejected') return recordOnly('refund rejected by Paddle', analysis);
    if (adj.status !== 'approved') return manual(`refund in status "${adj.status}" (e.g. reversed) needs a human`, analysis);
    if (payment.amountTotal == null || payment.amountTotal <= 0 || adj.amount == null || adj.amount <= 0) {
      return manual('refund or payment amount missing', analysis);
    }
    const refundedAfter = payment.refundedBefore + adj.amount;
    if (refundedAfter > payment.amountTotal) return manual('refunds exceed the amount paid', analysis);

    const full = adj.type === 'full' || refundedAfter >= payment.amountTotal;
    const actions: PolicyAction[] = [];
    let excess: number;
    if (full) {
      actions.push({ type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'refund', credits: null, close: true });
      excess = consumedOrHeld;
    } else {
      // Proportional to the refunded share of the payment, cumulative across partials,
      // capped by what is still revocable (the SQL reports anything beyond as unrevocable).
      const target = Math.ceil((lot.granted * refundedAfter) / payment.amountTotal);
      const toRevoke = Math.max(0, target - facts.refundRevokedBefore);
      const revocable = lot.unused + lot.reserved;
      excess = Math.max(0, toRevoke - revocable);
      if (toRevoke > 0) actions.push({ type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'refund', credits: toRevoke, close: false });
    }
    const reasons = [full ? 'Paddle approved a full refund' : 'Paddle approved a partial refund'];
    if (excess > 0) {
      // Money came back for service already delivered: record it truthfully, no debt, no clawback.
      actions.push(
        { type: 'RECORD_CONSUMED_SERVICE', credits: consumedOrHeld },
        { type: 'MARK_CONSUMED_BEFORE_REFUND' },
        { type: 'RAISE_ALERT', severity: 'review', code: 'refund_after_consumption' },
      );
      reasons.push(`refund covers ${excess} credits of service already delivered`);
      if (facts.risk.refundAfterConsumptionCount + 1 >= POLICY_CONFIG.refundAfterConsumptionReviewThreshold) {
        actions.push({ type: 'FLAG_ACCOUNT_REVIEW' }, { type: 'RAISE_ALERT', severity: 'review', code: 'refund_after_consumption_pattern' });
        reasons.push('repeated refund-after-consumption pattern on this account');
      }
    }
    return {
      policyVersion: POLICY_VERSION,
      decision: full ? 'FULL_REFUND_ACCOUNTING' : 'PARTIAL_REFUND_ACCOUNTING',
      actions, reasons, analysis,
    };
  }

  if (adj.action === 'chargeback') {
    if (adj.status === 'rejected') return recordOnly('chargeback rejected', analysis);
    if (adj.status === 'reversed') return manual('chargeback reversed: restoring entitlement needs a human', analysis);
    const actions: PolicyAction[] = [
      { type: 'REVOKE_UNUSED_ENTITLEMENT', kind: 'chargeback', credits: null, close: true },
      { type: 'SET_DISPUTE_STATE', state: 'chargeback' },
      { type: 'RAISE_ALERT', severity: 'critical', code: 'chargeback' },
      { type: 'FLAG_ACCOUNT_REVIEW' },
    ];
    if (consumedOrHeld > 0) actions.push({ type: 'RECORD_CONSUMED_SERVICE', credits: consumedOrHeld });
    return { policyVersion: POLICY_VERSION, decision: 'DISPUTE_PROCESSING', actions, reasons: ['chargeback reported by Paddle'], analysis };
  }

  if (adj.action === 'chargeback_warning') {
    return {
      policyVersion: POLICY_VERSION,
      decision: 'DISPUTE_PROCESSING',
      actions: [{ type: 'SET_DISPUTE_STATE', state: 'warning' }, { type: 'RAISE_ALERT', severity: 'review', code: 'chargeback_warning' }],
      reasons: ['early dispute warning: evidence may be requested'],
      analysis,
    };
  }

  // chargeback_reverse, credit, credit_reverse and anything new: never guess.
  return manual(`adjustment action "${adj.action}" is not automated`, analysis);
}

// ── future refund-request policy (not automated) ────────────────────────────
export type RefundRecommendation =
  | 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NO_DISCRETIONARY_REFUND' | 'STATUTORY_REFUND_REQUIRED' | 'MANUAL_REVIEW';

export interface RefundRequestFacts {
  jurisdiction: string | null;
  purchasedAt: string;
  requestedAt: string;
  lot: AdjustmentFacts['lot'];
  amountTotal: number | null;
  paymentStatus: string;
  disputeState: string;
  risk: AdjustmentFacts['risk'];
}

/**
 * What Syllo would propose for a customer's refund REQUEST. With no approved
 * legal policy it always answers MANUAL_REVIEW — the refund itself is decided and
 * executed in Paddle — but it always returns the consumption analysis a reviewer
 * (or a future approved policy) needs.
 */
export function recommendRefundRequest(facts: RefundRequestFacts, legal = LEGAL_POLICY): {
  recommendation: RefundRecommendation; legalPolicyVersion: string; reasons: string[]; analysis: ConsumptionAnalysis;
} {
  const analysis = consumptionAnalysis(facts.lot, facts.amountTotal);
  const reasons = legal.status === 'approved'
    ? ['no approved rule matches these facts']
    : ['no legally approved refund policy is configured (LEGAL_POLICY.status = unreviewed)'];
  return { recommendation: 'MANUAL_REVIEW', legalPolicyVersion: legal.version, reasons, analysis };
}
