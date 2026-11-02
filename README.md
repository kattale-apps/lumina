# Solar Switch

**Solar Sales, System Design & Quotation Management**

Solar Switch helps a solar company's sales agents assess customer energy needs, configure technically appropriate systems, check administrator-managed inventory and pricing, and generate quotations. Agents may issue clearly marked illustrative quotations immediately; official quotations require technician verification and any required commercial approval.

## Confirmed decisions
- Initial deployment: one solar company; tenant-aware design for future multi-company use.
- System types: off-grid, hybrid and grid-connected.
- Catalogue/inventory: administrator managed.
- Pricing: product cost plus configurable margins, with controlled overrides and approvals.
- Platforms: mobile-first web application with Android support.
- Currency: multi-currency; UGX initial default, configurable currency and exchange-rate policy.
- Offline: assessments and draft designs work offline; no offline stock/price commitment is official until synchronised and revalidated.
- Frontend: Next.js, React and TypeScript. Backend/database: Convex. Hosting target: Vercel.

## Core workflow
Customer assessment → deterministic solar sizing → compatible product selection → indicative pricing → illustrative quotation → technician review → commercial approval when required → official quotation.

## Essential safeguards
1. Illustrative quotations carry **UNVERIFIED — FOR ILLUSTRATION ONLY** on every page.
2. Only authorised technicians approve technical designs.
3. Only approved configurations become official quotations.
4. Commercial discounts outside agent authority require management approval.
5. Material design or pricing changes trigger revalidation.
6. Quotation generation does not itself deduct stock.
7. Price, stock, design and approval changes are auditable.
8. Solar sizing is deterministic. AI may explain results but must not invent specifications or make unverified engineering decisions.

## Project documents
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [System architecture](docs/SYSTEM_ARCHITECTURE.md)
- [Solar calculations and validation](docs/SOLAR_CALCULATIONS.md)
- [Quotation and approval workflow](docs/QUOTATION_WORKFLOW.md)
- [Development roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Phase 0 local setup](docs/PHASE_0_SETUP.md)
- [Application rules](apprules.md)

## Status
Planning and repository foundation. These documents do not constitute a certified electrical design.
