# Lumina Product Requirements

## Product summary
Lumina is a solar sales and system configuration platform. It guides agents through customer discovery, calculates energy requirements, proposes equipment from the company catalogue, checks stock and pricing, and generates quotations. Sales agents can immediately generate illustrative copies; official quotations require technician verification and, where configured, commercial approval.

## Goals
- Standardise customer energy assessments.
- Help non-engineer agents produce sensible preliminary system configurations.
- Display approved products, technical specifications, images, prices and stock.
- Reduce incompatible or undersized quotations.
- Produce branded, itemised quotations with clear status and revisions.
- Support field work with intermittent connectivity.
- Give managers control over margins, discounts, stock and approvals.

## Initial scope
One solar company, architected for future multi-company tenancy. Support off-grid, hybrid and grid-connected systems. Financing, payment collection, full installation management and public marketplace are later phases.

## Roles
- **Super administrator:** company settings, users, roles and audit access.
- **Inventory/pricing administrator:** catalogue, specifications, images, warehouses, stock, costs, margin rules and currencies.
- **Sales manager:** agents, pipeline, quotations and commercial exceptions.
- **Sales agent:** customers, sites, assessments, draft designs, illustrative quotations and review submissions.
- **Technician:** verifies technical sizing, assumptions, compatibility and installation requirements; may approve, amend, return or reject with reasons.

## Functional requirements

### Customer and site
Capture customer name, phone, optional email, customer type, site address/region and optional GPS with consent. Support residential, commercial, institutional, agricultural and industrial properties. Maintain multiple sites and assessment histories. Record grid availability and existing system details.

### Guided assessment
Capture appliances, quantity, rated power or measured power, operating hours/schedule, duty cycle where justified, power factor/apparent power where known, starting/surge requirements, criticality and AC/DC type. Allow custom appliances and distinguish estimate from measurement/nameplate data. Capture simultaneous loads, day/night profile, backup duration, autonomy days, critical circuits, system type, location and budget. Budget is a commercial constraint, not a substitute for technical sizing.

### System design
Calculate connected load, estimated energy, peak coincident demand and surge requirements. Recommend PV array, inverter, battery and balance-of-system equipment. Validate inverter voltage/current and MPPT limits, battery voltage/current/BMS, panel string limits, controller limits, protection and cabling where applicable. Show assumptions, warnings and limitations. Economy/recommended/premium options are allowed only if each meets technical constraints. Preserve design revisions.

### Catalogue and inventory
Admin-only create/update/archive. Categories include panels, inverters, batteries, charge controllers, mounting, protection, cables and installation accessories. Store brand, model, SKU, images, datasheets, warranty and typed specifications. Store compatibility constraints and effective-dated costs/prices. Support multiple warehouses and auditable stock movements. Distinguish on-hand, reserved and available quantities. Quotations do not deduct stock.

### Pricing
Cost-plus-margin with configurable rules by product/category/customer/channel. Support currency-specific price lists and recorded exchange-rate policy. Restrict cost/margin visibility. Enforce floor prices and discount authority server-side. Save price, currency and rate snapshots on each quotation revision.

### Quotation workflow
Generate an illustrative PDF marked unverified on every page. Submit design for technician review. Technician may approve, amend, return or reject with reason. Manager approval is required for configured commercial exceptions. Issue an official quotation only after required approvals. Include itemised equipment, quantities, price snapshots, taxes, labour, transport, warranty, validity and terms. Changes to approved design invalidate approval.

### Offline
Cache only permitted catalogue data with sync timestamps. Support offline customer assessment and draft designs. Offline outputs are illustrative only. Sync idempotently, surface conflicts and recheck catalogue version, price and stock before official issue.

### Reporting
Track assessments, quotations, conversion, review turnaround, sales by agent/product/region and stock movements. Restrict margin reporting.

## Non-functional requirements
Responsive, accessible mobile-first experience; strict tenant isolation; server-side authorisation; audit history for stock/spec/cost/price/approval changes; reliable offline queue; visible assumptions and units; secure customer data.

## First-release acceptance criteria
1. Admin creates a product with image, specs, cost, margin rule and stock.
2. Agent creates a customer and appliance assessment.
3. Sizing is reproducible with visible assumptions.
4. Missing/incompatible specifications cause warnings or blocked validation.
5. Agent generates illustrative PDF watermarked on every page.
6. Agent submits design to technician.
7. Technician approves, amends, returns or rejects with audit history.
8. Only an approved revision becomes an official quotation.
9. Design/price changes invalidate relevant approvals.
10. Offline drafts sync without duplication and never become official automatically.
