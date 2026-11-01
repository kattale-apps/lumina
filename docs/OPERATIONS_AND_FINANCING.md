# Operations and financing (Phase 6)

## Flow
An **officially issued** quotation is answered by the selling agent (or a manager):

- **Accepted** — records a deal outcome, keeps the held goods for 60 days (the hourly expiry job skips accepted quotations), accrues the agent's commission and opens an **installation job**.
- **Declined** — needs a reason, releases the held goods.

An outcome is recorded once and cannot be changed. A quotation past its validity date cannot be accepted: issue a new one.

## Commissions
- One company-wide rate, in `Overview` (managers). It is a percentage of the accepted revision's **subtotal before tax**. Default 0: nothing accrues until a rate is set.
- Each commission stores the rate and base it was earned at; later rate changes never alter it.
- States: accrued → approved → paid (reference required), or cancelled with a reason while unpaid.
- Managers decide; **nobody can approve, pay or cancel their own commission**. Agents see only their own.
- Cancelling an installation does **not** touch the commission. A manager decides that separately.

## Installations and warranties
- Jobs: waiting → scheduled (manager picks a technician and date) → in progress → completed. Cancelling (manager, with reason) is possible until completion and releases the held goods.
- Only the assigned technician, or a manager, can start and complete a job.
- **Completing** posts a stock *issue* movement for every held unit (the goods leave stock, with the quotation number as reference), marks the holds fulfilled, and starts one warranty record per product line that has a warranty, running from the completion date for the quoted months.
- Warranties show as in warranty / ending within 60 days / expired.

## Instalment illustration
On an issued quotation: deposit, term (1–60 months), yearly rate and method (flat or reducing balance) produce a repayment table in whole minor units; the last instalment absorbs rounding so principal repaid equals the amount financed. It is **arithmetic for a conversation**: nothing is stored, no lending terms exist in Lumina, and it must not be presented as a credit offer.

## Manager overview
Accepted/declined counts, win rate, accepted value, unanswered issued value, per-agent results, pipeline by status, installations by status, warranties ending soon and commission totals. Money is grouped **per currency** and never added across currencies. Win rate is accepted ÷ (accepted + declined) in the chosen period.

## Not built (needs a business decision first)
- **Payments and financing products.** No payment provider, collection, reconciliation, credit assessment, interest policy, or legal terms exist. The calculator is deliberately not connected to anything.
- Commission tiers, per-product rates, splits between agents, clawbacks after a cancelled installation.
- Customer-facing warranty claims, service visits, or reminders (warranties are recorded and flagged only).
- Installation checklists, photos, commissioning records, or sign-off by the customer.
- Pagination: the overview and lists read all of a company's records and are intended for hundreds, not tens of thousands, of rows.
