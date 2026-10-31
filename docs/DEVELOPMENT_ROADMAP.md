# Lumina Development Roadmap

## Phase 0 — Foundation
Confirm business rules/roles; establish Next.js/TypeScript and Convex; add linting, formatting, environment validation and CI; define tenant-aware schema/auth conventions; create calculation domain package and test strategy.

## Phase 1 — Identity, catalogue and inventory
Authentication, memberships and roles; company settings, currencies and warehouses; typed product categories/specifications; images/datasheets; costs, margin rules and price lists; stock ledger, balances/reservations and audit events.

**Exit:** Admin maintains products/stock; agents see only authorised catalogue/pricing.

## Phase 2 — Customer assessment
Customer/site CRM; appliance library/custom appliances; guided assessment; load profiles, schedules and assumptions; draft saving/history.

**Exit:** Agent creates reproducible assessment from interview inputs.

## Phase 3 — Solar sizing and compatibility
Unit-aware load/energy model; battery, PV and inverter sizing; product-specific compatibility; warnings and technician resolutions; candidate configurations with safe constraints; independent tests and documented formulas.

**Exit:** Results are reproducible and fail safely when critical specifications are missing.

## Phase 4 — Quotation and approval
Pricing and price snapshots; illustrative PDF/watermark; technician queue/checklist; amend/return/reject/approve; commercial exception approval; official issuance, immutable versions and audit; stock reservation lifecycle.

**Exit:** No path issues an official quotation without required approvals.

## Phase 5 — Offline and Android
IndexedDB cache/outbox; idempotent sync/conflict resolution; stale stock/price indicators and server revalidation; PWA hardening; Capacitor Android packaging and release process.

**Exit:** Offline work is retained and reconciled; no offline draft becomes official automatically.

## Phase 6 — Operations and financing
Agent pipeline/commissions; manager dashboards; installation/warranty tracking; installment calculator and repayment schedule; payment integrations after financing policy is defined.

## Definition of done
Role/tenant security tested; domain logic tested; mobile layouts/accessibility checked; errors and offline states explicit; audit requirements met; docs updated; no secrets or real customer data committed.
