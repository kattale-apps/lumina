# Lumina Application Rules

## Mobile-first usability
- Design for agents using phones outdoors with intermittent connectivity.
- Use clear labels, strong contrast, large touch targets, guided steps and plain language.
- Use responsive cards instead of dense mobile tables.
- Preserve form progress; show sync state and data freshness.
- Support keyboard access and accessible labels.

## Technical correctness
- Solar calculations must be deterministic, unit-aware, documented and independently testable.
- Distinguish power (W/kW), energy (Wh/kWh), apparent power (VA), voltage (V), current (A), and surge demand.
- Use actual manufacturer specifications. Missing critical specifications mean "cannot validate", not assumed compatibility.
- Show assumptions, warnings and unresolved inputs.
- AI may explain results but cannot invent electrical ratings, compatibility or technical approval.
- An authorised technician must verify a design before an official quotation is issued.

## Quotation integrity
- Every preliminary quotation page must say "UNVERIFIED — FOR ILLUSTRATION ONLY".
- State that technical suitability, stock, final pricing and terms remain subject to verification.
- A sales agent cannot approve their own design.
- Official issuance requires approval of the current design revision and any required commercial approval.
- Material amendments invalidate prior approval. Preserve immutable revisions and approval history.

## Inventory and pricing
- Product catalogue, specifications, stock and base costs are administrator controlled.
- Quotation generation does not deduct stock.
- Use explicit stock reservations with expiry; deduct on actual issue/dispatch.
- Prevent negative stock unless an authorised backorder policy exists.
- Store currency and price basis explicitly. Never silently mix currencies.
- Record exchange-rate source, timestamp, rate and rounding policy.
- Enforce margin, floor-price and discount permissions server-side.

## Offline behaviour
- Offline actions remain local drafts until synchronised.
- Show last sync times for catalogue, prices and stock.
- Resolve conflicts explicitly; never silently overwrite newer server records.
- Use client-generated idempotency keys to prevent duplicate submissions.
- Only the server issues official quotation numbers and approvals.
- Offline quotes cannot become official automatically.

## Security and privacy
- Enforce role permissions and tenant boundaries in backend functions.
- Treat the browser as untrusted; validate permissions and business rules server-side.
- Restrict internal cost, margin and profitability data.
- Audit actor, timestamp, action and relevant before/after values.
- Protect customer contacts and installation location data.
- Never commit secrets or real customer data.

## Engineering discipline
- TypeScript strict mode.
- Keep solar domain logic separate from UI and database adapters.
- Validate all external/user inputs.
- Test calculations, compatibility, permissions, pricing, quotation transitions and offline reconciliation.
- Avoid unnecessary dependencies and document assumptions.
- Do not mark a feature complete without verification.

## Product baseline
One company initially, tenant-aware for future multi-company. Off-grid, hybrid and grid-connected. Admin-managed catalogue. Cost-plus-margin pricing. Mobile-first web and Android. Multi-currency with UGX default. Offline assessment and draft design with server revalidation before official use.
