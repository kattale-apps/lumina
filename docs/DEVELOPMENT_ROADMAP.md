# Lumina Development Roadmap

**Status as of 2026-11-01:** Phase 0 is mostly complete (tooling items outstanding). Phase 1 is feature-complete and live on production. Phase 2 is feature-complete. Phases 3–6 are not started.

Legend: ✅ done and deployed · 🟡 partly done · ⬜ not started

## Phase 0 — Foundation — 🟡 mostly complete
Confirm business rules/roles; establish Next.js/TypeScript and Convex; add linting, formatting, environment validation and CI; define tenant-aware schema/auth conventions; create calculation domain package and test strategy.

- ✅ Business rules and roles documented (`apprules.md`, `docs/`)
- ✅ Next.js, TypeScript (strict) and Convex established; deployed on Vercel with Convex Cloud
- ✅ Tenant-aware schema and server-side role/tenant checks (`convex/lib/auth.ts`)
- ✅ Convex Auth (email and password), with profiles linked to auth users
- ✅ Test setup: Vitest with `convex-test`
- ⬜ Linting and formatting (no ESLint or Prettier configured)
- ⬜ CI (tests are run by hand; Vercel only builds)
- 🟡 Environment validation: the dashboard reports a missing Convex URL, but there is no startup check for the Convex-side variables (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`)
- ⬜ Solar calculation domain package (starts in Phase 3)

## Phase 1 — Identity, catalogue and inventory — ✅ feature-complete
Authentication, memberships and roles; company settings, currencies and warehouses; typed product categories/specifications; images/datasheets; costs, margin rules and price lists; stock ledger, balances/reservations and audit events.

**Exit:** Admin maintains products/stock; agents see only authorised catalogue/pricing.

| Item | Status | Where |
|---|---|---|
| Authentication, memberships, roles | ✅ | `/sign-in`, `/dashboard`, `convex/auth.ts` |
| Operator company provisioning | ✅ | `convex/admin.ts` (run from the Convex dashboard) |
| Company settings and currencies | ✅ | `/dashboard/settings` |
| Warehouses | ✅ | `/dashboard/warehouses` |
| Staff and role administration | ✅ | `/dashboard/staff` |
| Typed categories and specifications | ✅ | `/dashboard/catalogue` |
| Products with validated spec values | ✅ | `/dashboard/products` |
| Effective-dated costs | ✅ | product card (admins) |
| Margin rules (product, category, default) with floor margins | ✅ | `/dashboard/pricing` |
| Images and PDF datasheets | ✅ | product card |
| Stock ledger, balances, transfers | ✅ | `/dashboard/stock` |
| Reservations with expiry | ✅ | `/dashboard/stock` |
| Audit events for every change | ✅ | `auditEvents` table |
| Separate named price lists | ⬜ | List price is derived: cost plus margin |
| Exchange rates and currency conversion | ⬜ | Prices stay in the cost's own currency |
| Audit log viewer | ⬜ | Events are recorded but not yet displayed |

**Exit criteria check:** admins maintain products and stock ✅. Agents and other non-admin roles see only active products, list prices and availability; cost, margin, floor price, exact stock counts and the ledger are admin-only, and tests assert this ✅. Not yet verified by someone using the live site end to end.

**Known gaps and follow-ups**
- Discount and floor-price enforcement waits for quotations (Phase 4).
- No screen yet to fulfil a reservation; the server supports it.
- Abandoned file uploads can leave orphan files in storage; no cleanup job yet.
- A user in several companies always works in the first; there is no company switcher.
- Access is granted only to people who already registered; there are no invitation emails.
- Standard category specifications are starting definitions and need technician review.
- Production uses `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` set by hand on the Convex deployment.

## Phase 2 — Customer assessment — ✅ feature-complete (not yet used on the live site)
Customer/site CRM; appliance library/custom appliances; guided assessment; load profiles, schedules and assumptions; draft saving/history.

**Exit:** Agent creates reproducible assessment from interview inputs.

| Item | Status | Where |
|---|---|---|
| Customers with type, contact details and notes | ✅ | `/dashboard/customers` |
| Installation sites: grid availability, existing system, GPS only with consent | ✅ | customer page |
| Appliance library (starting estimates) and custom appliances | ✅ | `/dashboard/appliances`, assessment lines |
| Guided assessment: power and its source, power factor, starting power, duty factor with justification, AC/DC, critical flag, hourly schedule | ✅ | `/dashboard/assessments/[id]` |
| Load profile: daily energy, AC/DC and critical split, hourly demand, coincident peak, peak with surge | ✅ | `convex/lib/load.ts` (engine `load-1`) |
| Draft saving, append-only revisions, revision viewer, complete/reopen | ✅ | `assessmentRevisions` table |
| Agents see only their own customers and assessments; technicians read only; inventory admins no access | ✅ | tested |

**Exit criteria check:** each save stores the inputs, results and engine version as an immutable revision, so an assessment can be reproduced and compared. Stale saves are rejected. ✅ Not yet verified by someone using the live site end to end.

**Known gaps and follow-ups**
- Offline drafts and the sync queue are not built.
- No customer search, follow-ups or contact history yet.
- The schedule is typed as whole-hour windows such as `6-8, 18-23`; there is no visual schedule picker.
- Reassigning a customer to another agent is not possible.
- Technician review of an assessment waits for Phase 3/4.
- The standard appliance values are starting estimates and need technician review.
- An invalid or inaccessible customer/assessment link shows an error instead of a friendly page.

## Phase 3 — Solar sizing and compatibility — ⬜ not started
Unit-aware load/energy model; battery, PV and inverter sizing; product-specific compatibility; warnings and technician resolutions; candidate configurations with safe constraints; independent tests and documented formulas.

**Exit:** Results are reproducible and fail safely when critical specifications are missing.

*Groundwork in place:* category specs carry units and a compatibility-critical flag, and products report missing critical specs as "cannot validate".

## Phase 4 — Quotation and approval — ⬜ not started
Pricing and price snapshots; illustrative PDF/watermark; technician queue/checklist; amend/return/reject/approve; commercial exception approval; official issuance, immutable versions and audit; stock reservation lifecycle.

**Exit:** No path issues an official quotation without required approvals.

*Groundwork in place:* cost-plus-margin pricing with floor margins, and stock reservations with expiry.

## Phase 5 — Offline and Android — ⬜ not started
IndexedDB cache/outbox; idempotent sync/conflict resolution; stale stock/price indicators and server revalidation; PWA hardening; Capacitor Android packaging and release process.

**Exit:** Offline work is retained and reconciled; no offline draft becomes official automatically.

*Groundwork in place:* stock movements accept client idempotency keys.

## Phase 6 — Operations and financing — ⬜ not started
Agent pipeline/commissions; manager dashboards; installation/warranty tracking; installment calculator and repayment schedule; payment integrations after financing policy is defined.

## Definition of done
Role/tenant security tested; domain logic tested; mobile layouts/accessibility checked; errors and offline states explicit; audit requirements met; docs updated; no secrets or real customer data committed.

**Applied to Phase 1:** role/tenant security tested ✅ (78 automated tests); domain logic tested ✅ (money, spec validation, margin precedence, stock rules); errors explicit ✅; audit recorded ✅; docs updated ✅; no secrets committed ✅. Mobile layouts and accessibility are built in (labelled fields, visible focus, responsive cards) but **not yet checked on real devices or with a screen reader** 🟡.
