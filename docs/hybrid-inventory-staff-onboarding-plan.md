# Lumina Hybrid Inventory & Staff Onboarding Implementation Plan

Branch: `feat/hybrid-inventory-staff-onboarding`

## Confirmed product decisions

- Architecture: Hybrid (Option C).
- Lumina's own inventory remains first-class.
- Independent supplier companies can contribute their own catalogue items and stock.
- Agents see a consolidated, permission-filtered catalogue.
- Supplier ownership, warehouse, cost, currency, availability and fulfilment source remain traceable.
- Quotations retain immutable product, supplier and price snapshots.
- Only the existing super administrator is a super administrator.
- That super administrator can invite/manage staff in the operational roles, but cannot create or promote another super administrator.
- First-login credential requested: `solar123`; it must be temporary and force a password change before any operational access.

## Delivery sequence

### Phase 1 — Access and staff onboarding
1. Replace the current "user must register first" workflow with a pending invitation record.
2. Invitation captures full name, email, phone, job title and one assignable role.
3. Create/activate the account through a controlled invitation acceptance flow.
4. Set the requested initial credential only as a temporary credential; never store or log it in plaintext.
5. Add a `mustChangePassword` gate to authenticated application access and force password change before dashboard access.
6. Track invitation states: pending, accepted, expired, revoked; staff states: active, suspended, departed.
7. Enforce all role restrictions in Convex mutations, not only in the interface.

Security note: a shared default password is weaker than a single-use activation link. If retained, `solar123` must be temporary, rate-limited, never exposed after provisioning, and unusable after the mandatory reset.

### Phase 2 — Supplier company model
1. Add supplier-company records owned/managed by the Lumina tenant.
2. Store supplier identity, contacts, status, onboarding state and commercial terms.
3. Add supplier-specific membership/permissions for supplier users where needed.
4. Preserve tenant boundaries: supplier data is visible only through the Lumina tenant's explicit relationship.

### Phase 3 — Consolidated catalogue
1. Keep Lumina-owned products as the default source.
2. Associate supplier-provided products with a supplier company and supplier SKU.
3. Map supplier categories/specifications to Lumina's canonical product categories/spec fields.
4. Detect duplicate products by brand/model/specification while preserving distinct supplier offers.
5. Add supplier offer status, lead time, minimum order quantity and availability timestamp.
6. Add source filters and supplier attribution to catalogue search.

### Phase 4 — Inventory and pricing
1. Make stock ownership explicit at the supplier-company and warehouse level.
2. Keep the stock ledger append-only and supplier-scoped.
3. Prevent one supplier's users from adjusting another supplier's stock.
4. Keep supplier cost, Lumina margin and customer selling price separate.
5. Apply the configured margin rules without exposing protected cost/floor data to sales agents.
6. Support multiple currencies with explicit exchange-rate/effective-date handling where cross-currency aggregation is enabled.

### Phase 5 — Quotations and fulfilment
1. Snapshot supplier company, supplier offer, SKU, warehouse/source, currency, cost basis and customer-facing price on each quotation revision.
2. Revalidate supplier offer and available quantity during technician/commercial approval and official issue.
3. Reserve stock against the correct supplier and warehouse.
4. Support split fulfilment across suppliers only when explicitly allowed and shown as separate quote lines.
5. Preserve old quotation snapshots when supplier data or prices change.

### Phase 6 — Interfaces and reporting
1. Staff dashboard: invite, pending, active, suspended, departed; role and audit history.
2. Supplier dashboard: add/edit supplier companies, contacts, product feeds and stock.
3. Product catalogue: consolidated list with supplier/source filters and stock visibility.
4. Stock dashboard: supplier and warehouse filters, stock ledger and reservations.
5. Reports: supplier fill rate, stock accuracy, margin, quote conversion and fulfilment performance.

## Initial implementation completed on this branch

- Created this feature branch from `main`.
- Hardened `convex/staff.ts`: staff grant and role-change mutations now accept only operational roles; the existing super-admin membership is protected from modification through staff-management actions.

## Required engineering checks before release

- Convex schema/type generation and TypeScript build.
- Existing tenant-scoped records remain valid during migration.
- No supplier data leaks across tenants or supplier permissions.
- No staff mutation can create, promote, suspend or replace the sole super administrator.
- Invitation expiry/replay, duplicate email, suspended user and first-login password reset tests.
- Quotation snapshot and supplier stock reservation tests.
- Offline sync conflict tests for supplier stock updates.
