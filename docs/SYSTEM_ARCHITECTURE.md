# Solar Switch System Architecture

## Approach
Modular Next.js application with Convex backend/database and separately testable domain logic for solar calculations, compatibility, pricing and quotation transitions. Initial deployment is one company; records and authorization are tenant-aware for future multi-company support.

## Technology
- Next.js App Router, React, TypeScript.
- Tailwind CSS and accessible UI components.
- Convex queries, mutations, actions and schema.
- Convex-compatible authentication mapped to internal user, tenant and role.
- Convex file storage initially; object storage adapter if required.
- Vercel frontend and Convex backend.
- Capacitor Android wrapper after responsive PWA workflows stabilise.
- Server-side PDF generation from immutable quotation snapshots.
- IndexedDB drafts/outbox and explicit offline sync coordinator.

Avoid a second database unless a demonstrated reporting or integration need justifies it.

## Modules
1. Identity/tenancy: users, memberships, roles, permissions and audit.
2. CRM: customers, contacts, installation sites and follow-ups.
3. Assessment: appliance library, appliance records, load profiles, assumptions and versions.
4. Solar engine: unit-safe calculations, sizing, compatibility and warnings.
5. Catalogue/inventory: products, typed specs, datasheets, warehouses, movements and reservations.
6. Pricing: costs, margin rules, currencies, exchange rates, tax and discount approvals.
7. Quotations/approvals: immutable revisions, illustrative copies, technician reviews, commercial approvals and issuance.
8. Offline sync: local drafts, idempotency keys, conflict records and server revalidation.

## Data principles
- Every tenant-owned record has a tenant reference.
- Enforce tenant access in every backend function, never only in UI filtering.
- Use typed product-specific specifications, not generic wattage fields.
- Keep explicit units and immutable snapshots for assessments, designs, product specs, prices and quotations.
- Validate lifecycle transitions server-side.
- Use stock movements as ledger; derived balances for quick reads.
- Record actor, timestamp, action and relevant before/after values.
- Store currency on every monetary value. Avoid floating point money; use minor units or decimal-safe representation.
- Record exchange-rate source, timestamp, base/quote currencies and rate.

## Main entities
tenants, users, memberships, roles, customers, customerSites, appliances, assessments, assessmentAppliances, designs, designRevisions, products, productCategories, productSpecifications, compatibilityRules, productImages, warehouses, stockMovements, stockBalances, stockReservations, priceLists, costRecords, marginRules, exchangeRates, quotations, quotationRevisions, quotationItems, technicalReviews, commercialApprovals, auditEvents, offlineOperations.

## Security
Derive identity from authenticated context. Check membership and permission on every operation. Never trust client-supplied tenant, role, price, approval or stock balance. Restrict cost/margin. Technician approval is distinct from agent submission. Official issue requires server-validated approvals. Validate file types/sizes and restrict customer attachments.

## Offline
Cache only permitted data. Mark cached catalogue/price/stock with version and last-sync time. Keep offline assessments/designs as local drafts with stable client IDs. Sync via idempotent outbox. Server rechecks permissions, catalogue version, price and stock. Offline quotations remain illustrative. Conflicts require explicit resolution.

## Suggested source layout
```
src/
  app/
    (auth)/
    dashboard/
    customers/
    assessments/
    system-designer/
    products/
    inventory/
    quotations/
    technician/
    admin/
  components/
  features/
  domain/
    energy/
    solar-sizing/
    compatibility/
    pricing/
    quotations/
  lib/
convex/
  schema.ts
  auth/
  customers/
  assessments/
  products/
  inventory/
  pricing/
  designs/
  quotations/
  approvals/
  audit/
  sync/
docs/
```

Keep calculation modules independent of Convex and React for testing and safe reuse in previews.
