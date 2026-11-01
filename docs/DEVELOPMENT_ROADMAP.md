# Lumina Development Roadmap

**Status as of 2026-11-01:** Phase 0 is mostly complete (tooling items outstanding). Phase 1 is feature-complete and live on production. Phases 2, 3 and 4 are live, and Phase 5 is built but untested on devices. Phase 6 is not started.

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

## Phase 3 — Solar sizing and compatibility — ✅ feature-complete (not yet used on the live site)
Unit-aware load/energy model; battery, PV and inverter sizing; product-specific compatibility; warnings and technician resolutions; candidate configurations with safe constraints; independent tests and documented formulas.

**Exit:** Results are reproducible and fail safely when critical specifications are missing.

| Item | Status | Where |
|---|---|---|
| Sizing engine `size-1` (pure, deterministic) | ✅ | `convex/lib/sizing.ts` |
| Battery energy: off-grid by days of autonomy, hybrid/backup by worst window of the critical-load profile | ✅ | engine |
| PV array from daytime load plus night load through storage, peak sun hours and performance ratio | ✅ | engine |
| Inverter requirement from AC-only coincident peak, apparent power and start-up surge | ✅ | engine |
| Product compatibility: topology, power, surge, phase, battery bus voltage, series/parallel counts, discharge/charge current, BMS, string voltage window with cold/hot correction, string current, PV input power | ✅ | engine |
| Missing critical spec gives "requires_review"; a product that cannot be sized is rejected with the reason | ✅ | tested |
| Every run stores revision, assumptions, engine version, requirements, results and product spec snapshots | ✅ | `sizingRuns` |
| Technician resolutions with notes (once per check, technician/owner only) | ✅ | `sizingResolutions` |
| Sizing screen with assumptions form, run history, candidate checks and rejection reasons | ✅ | `/dashboard/assessments/[id]/sizing` |

**Exit criteria check:** the same inputs, assumptions and catalogue always produce the same result (tested with hand-calculated values), and stale runs are flagged when the assessment changes. ✅ Not yet verified by someone using the live site end to end.

**Known gaps and follow-ups**
- Cables, protection, earthing, mounting and standalone charge controllers are not in configurations; the screen says so.
- DC-only systems are blocked for technician design.
- The Vmp temperature coefficient is not catalogued, so the Voc coefficient stands in for it.
- Start-up surge duration of the loads is not captured, so any load with a surge needs a technician's confirmation.
- Candidates are ranked by item count; price, stock and warranty come with quotations (Phase 4).
- Peak sun hours are typed in by hand; there is no solar-resource data source yet.
- Multiple inverters in parallel and multiple MPPT string splits are not modelled.
- Default assumption values are starting points and need technician review.

## Phase 4 — Quotation and approval — ✅ feature-complete (not yet used on the live site)
Pricing and price snapshots; illustrative PDF/watermark; technician queue/checklist; amend/return/reject/approve; commercial exception approval; official issuance, immutable versions and audit; stock reservation lifecycle.

**Exit:** No path issues an official quotation without required approvals.

| Item | Status | Where |
|---|---|---|
| Quotation created from a sizing configuration, priced from current cost and margin rule | ✅ | `convex/quotations.ts` |
| Immutable revisions with price, currency and product-specification snapshots; totals in exact minor units | ✅ | `quotationRevisions` |
| Agent discounts up to the floor price; floor and cost never sent to the browser | ✅ | tested |
| Service lines (installation, transport), tax rate and validity days | ✅ | quotation page |
| Illustrative PDF with "UNVERIFIED — FOR ILLUSTRATION ONLY" on every page | ✅ | `convex/lib/quotePdf.ts`, tested |
| Server-validated state machine; any revision voids earlier approvals | ✅ | `convex/lib/quote.ts` |
| Technician queue, 10-point checklist, approve / return / reject with reason | ✅ | `/dashboard/quotations` |
| Technician approval blocked while sizing is stale or has unresolved review checks | ✅ | tested |
| Commercial approval by a manager for below-floor prices and special terms | ✅ | tested |
| Nobody reviews or approves their own quotation | ✅ | tested |
| Official issue re-checks approvals for that exact revision, prices, currency and stock | ✅ | `issueQuotation` |
| Official number, stock reserved until validity ends, official PDF stored once | ✅ | tested |
| Expiry (hourly job) and withdrawal release stock | ✅ | `convex/crons.ts` |
| Audit event for every step | ✅ | `auditEvents` |

**Exit criteria check:** official issue verifies the stored technical review and (where required) commercial approval for the current revision, not just the status field, and the state machine allows no other route. ✅ Not yet verified by someone using the live site end to end.

**Known gaps and follow-ups**
- In a company where one person is the only administrator and also the quotation owner, that person cannot approve their own work; a second reviewer is needed.
- Service lines have no floor price (no cost is held for them), so they are never flagged.
- Discount authority is "down to the floor price"; per-role or per-amount limits are not configurable.
- Tax is one rate per quotation; there are no tax categories or exchange-rate conversion, and a quotation must be in one currency.
- A reservation is made on official issue only; a "customer accepted" step and fulfilment screen do not exist yet.
- The official PDF is generated moments after issue, not inside the issue transaction, so the link can appear a few seconds late.
- Quotations cannot be marked superseded when a replacement is issued.
- The PDF is plain: no logo, terms template or customer address.

## Phase 5 — Offline and Android — ✅ built, not yet tested on devices
IndexedDB cache/outbox; idempotent sync/conflict resolution; stale stock/price indicators and server revalidation; PWA hardening; Capacitor Android packaging and release process.

**Exit:** Offline work is retained and reconciled; no offline draft becomes official automatically.

Details, security notes and limits are in `docs/OFFLINE_AND_ANDROID.md`.

| Item | Status | Where |
|---|---|---|
| Field work screen usable offline: customers, sites, assessments, appliance library | ✅ | `/dashboard/field` |
| IndexedDB device store with ordered outbox; one coalesced unsent save per assessment | ✅ | `src/lib/offline/store.ts` |
| Idempotent push: every change has an id the server remembers; replays are safe | ✅ | `convex/sync.ts`, tested |
| Dependent changes (site → customer → assessment) resolved by device ids | ✅ | tested |
| Conflicts held on the server and resolved by a person ("use mine" / "keep server's") | ✅ | tested |
| Rejected changes stay visible with a reason; discarding removes dependants | ✅ | tested |
| Offline work can only create or save drafts; completing, sizing and quoting are online-only | ✅ | tested |
| Cached catalogue prices with download time and 24-hour stale warning; revalidated at issue | ✅ | field page |
| Different user on a device cannot see or send another's work; sign-out clears the device | ✅ | tested |
| PWA: manifest, icons, service worker for the app shell, offline fallback page | ✅ | `public/` |
| Capacitor Android project and release process | 🟡 generated, never built or run | `android/`, `docs/ANDROID_RELEASE.md` |

**Exit criteria check:** unsent work is kept in IndexedDB until the server confirms it, retried safely, and any clash with newer server data is held for an explicit decision. No path from the offline queue completes an assessment or issues a quotation. 🟡 Verified with automated tests against the real server functions; **not yet verified on a real phone or in a real browser offline**, including the service worker and the Android build.

**Known gaps and follow-ups**
- Quotations, sizing and assessment completion are online-only.
- Sync runs only while the app is open; there is no background sync.
- Offline sign-in is not possible: the device must have been signed in and synced once, and the cached copy is open to anyone holding the unlocked device until sign-out.
- A conflict cannot be merged line by line; the person picks one whole version.
- Offline customers are created without email or notes, and sites without GPS.
- The service worker has not been exercised across browser updates, and iOS Safari may evict stored data after long inactivity.
- The Android application id (`com.lumina.solar`), launcher icons and signing key still need to be decided before publishing.
- Development dependencies report npm audit findings (test tooling); `npm audit --omit=dev` reports two (one moderate, one high) in the production tree that have not been investigated.

## Phase 6 — Operations and financing — ⬜ not started
Agent pipeline/commissions; manager dashboards; installation/warranty tracking; installment calculator and repayment schedule; payment integrations after financing policy is defined.

## Definition of done
Role/tenant security tested; domain logic tested; mobile layouts/accessibility checked; errors and offline states explicit; audit requirements met; docs updated; no secrets or real customer data committed.

**Applied to Phase 1:** role/tenant security tested ✅ (78 automated tests); domain logic tested ✅ (money, spec validation, margin precedence, stock rules); errors explicit ✅; audit recorded ✅; docs updated ✅; no secrets committed ✅. Mobile layouts and accessibility are built in (labelled fields, visible focus, responsive cards) but **not yet checked on real devices or with a screen reader** 🟡.
