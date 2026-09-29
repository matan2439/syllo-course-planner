# Israeli legal review checklist — Syllo Credits

**Technical policy ≠ legal policy.** The code records the facts a lawful policy needs: what was purchased, when, what was consumed and when, which terms were accepted, and what Paddle refunded. The code does **not** decide any of the questions below. Counsel must answer them before production. After that, the answers are configured in `LEGAL_POLICY` (`api/billing/refund_policy.ts`), the texts in `shared/billing/legal_versions.ts`, and the Paddle-side refund handling.

## Questions for counsel

1. **Characterization:** are Syllo Credits a *service*, *digital content*, a prepaid voucher/stored value, or another category under Israeli consumer law (including the Consumer Protection Law and the cancellation-of-transaction regulations)?
2. **Commencement:** does the first AI operation after purchase count as the start of the service? Does each operation count, or the package as a whole?
3. **Proportional consideration:** if the consumer cancels after service began, may Syllo/Paddle keep proportional consideration for service already provided?
4. **Calculation:** if yes, how should it be calculated? Per credit consumed (`consumed / purchased × price` is what the system computes today, as analysis only), by time, or by another basis? Can a cancellation fee also be deducted?
5. **AI output:** does receiving AI output that the consumer can copy or save affect the cancellation right?
6. **Exceptions:** do the statutory exceptions for information that can be downloaded, copied or reproduced apply to AI-generated planning output?
7. **Pre-purchase disclosures:** which disclosures must appear before purchase, in what form, and in what language? (The UI slot is `PURCHASE_DISCLOSURE_HE`, currently placeholder text marked REQUIRES LEGAL REVIEW.)
8. **Consent to immediate start:** is affirmative consent required before the service starts immediately? Does such consent change cancellation rights? (The slot `IMMEDIATE_SERVICE_CONSENT_VERSION` is off. Turning it on makes the checkbox mandatory and records its version.)
9. **Cancellation method:** which cancellation methods must be offered (e.g. email, a link on the site, phone)? Since Paddle is the Merchant of Record, who must receive the cancellation?
10. **Cancellation fees:** are they permitted for this product, and what is the cap?
11. **Refund deadline:** by when must the refund be paid after cancellation, and who carries that obligation (Paddle as MoR, or Syllo)?
12. **Repeat abuse:** may a documented pattern of refund-after-consumption justify refusing future purchases? What process and notice are required? (Today the system only flags accounts for review. Restriction is a manual admin action.)
13. **Records and retention:** which records must be kept, and for how long? This covers purchase, consumption, terms versions, and dispute evidence. Payments are kept after account deletion (`payments.user_id` is set to NULL, not deleted); counsel should confirm that this retention is lawful and set the period.

## Also review

- Supplier Terms, Refund Policy and Privacy Policy wording, aligned with Paddle's buyer terms.
- Whether the Hebrew customer-facing wording in the purchase history ("נוצלו", "זמינים", "בוטלו") is acceptable.
- The privacy notice for processing AI-usage metadata (token counts, model, timestamps) as service-delivery evidence.
