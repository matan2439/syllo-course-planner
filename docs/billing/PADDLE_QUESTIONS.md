# Questions for Paddle (before production)

Send these to Paddle before going live. The code does not assume any of the answers. Every refund-sizing decision stays manual (`LEGAL_POLICY.status = 'unreviewed'` in `api/billing/refund_policy.ts`) until the answers and the legal review are in.

| # | Question | Where the answer plugs in |
|---|---|---|
| 1 | Are prepaid AI/Copilot credit packages (one-time, non-subscription, consumed per AI operation) an approved product for Syllo? | Go/no-go; product copy |
| 2 | Can an Israeli seller (sole proprietor / company registered in Israel) sell this model through Paddle? What does Israeli seller onboarding require (entity type, documents, verification steps, expected approval time)? | Account setup |
| 3 | For an Israeli consumer who starts using a digital service immediately after purchase, how does Paddle handle the 14-day statutory withdrawal/cancellation right? Who decides, and on what basis? | `LEGAL_POLICY`, the refund-policy text, the purchase disclosure |
| 4 | When Israeli law allows it, does Paddle support retaining payment for the proportional value of digital service already supplied, and refunding only the rest? | `recommendRefundRequest` (currently always MANUAL_REVIEW); the analysis fields `candidate_consumed_value` / `candidate_unused_value` already exist |
| 5 | Can a **partial refund** (`POST /adjustments`, `type: partial`) be used for the unused portion of a prepaid credit package? Is there a minimum amount, and is there a fee impact? | The partial-refund accounting already revokes ⌈credits × refunded / paid⌉ automatically |
| 6 | What evidence should Syllo keep to show that service was consumed? Is our evidence package enough (authenticated user id, Paddle ids, purchase time, terms versions, per-operation id/time/credits/model/tokens, event timeline)? | `api/billing/evidence.ts` fields |
| 7 | How does Paddle handle a buyer who repeatedly refunds after consuming? Does Paddle block buyers, and can Syllo ask it to? | Risk flags (`account_risk_indicators`) |
| 8 | How should Syllo report suspected refund abuse or fraud to Paddle (channel, format)? | The alerts runbook |
| 9 | For chargebacks: what evidence can Syllo submit, in what format, by when, and is there an API for it or only the dashboard/support? | Evidence export (JSON + text). Automatic submission is intentionally **not** built |
| 10 | Which webhook events should a one-time-purchase integration subscribe to? We handle `transaction.completed`, `transaction.payment_failed`, `transaction.canceled`, `adjustment.created`, `adjustment.updated`. Do we also need `transaction.paid`, `transaction.past_due`, or any dispute-specific event? | The Paddle notification destination settings; `process_event.ts` |
| 11 | Which payout methods and payout currencies are available to an Israeli seller (bank transfer in ILS/USD, Payoneer, …)? What are the payout schedule, the minimum payout, and any FX/conversion fees? | Finance setup; the admin console shows Paddle totals only, never net payouts |
| 12 | VAT: as Merchant of Record, does Paddle collect and remit Israeli VAT (and foreign VAT) on these credit packages? Which tax category should prepaid AI credits use? Are prices shown to Israeli buyers VAT-inclusive? What does Syllo itself still owe or report in Israel for the payouts it receives? | Product `tax_category`; price display; accountant review |
| 13 | Dispute events: which webhook events and adjustment `action` values signal a dispute lifecycle (chargeback warning, chargeback, chargeback reversal)? Are they delivered as `adjustment.created` / `adjustment.updated`, or as separate event types? | `refund_policy.ts` dispute handling; the notification destination event list |

Also confirm:
- Do the webhook IP allowlist and the signature tolerance window match Paddle's recommendations? We accept ±300 s because a cold start on Vercel can delay verification; Paddle's SDK defaults to 5 s. Is 300 s acceptable, or do you recommend a tighter bound?
- Retention: how long does Paddle keep transaction and adjustment data that Syllo can query later (reconciliation uses `GET /transactions/{id}` and `GET /adjustments?transaction_id=`)?
