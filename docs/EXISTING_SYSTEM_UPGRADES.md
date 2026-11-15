# Upgrade checks for existing systems

For customers who already have solar and want more from it. Staff use `/dashboard/upgrades`; the public use `/estimate/upgrade` (open whenever the public power check is switched on).

## Inputs
The existing system is described by nameplate ratings typed in by hand: system type and battery bank voltage, inverter, separate charge controller, panels and batteries. Only the figures needed to start are required. A rating left empty is never assumed: the affected check becomes "needs a technician".

The owner's goals are any of: longer backup, more solar, more power at once, cheaper or better parts. Optional targets: backup hours and load, daily solar energy, peak load.

## What the engine works out (`convex/lib/upgrade.ts`, engine `upgrade-1`)
Deterministic, pure and unit-tested, using the same assumptions as the public power check (4 sun hours, 75% performance ratio, 15 °C and 65 °C cell temperatures).

- **The system today**: array size and daily yield, nominal and usable battery energy, backup hours, and whether the array is within the solar charger's limits.
- **Batteries**: the bank voltage every string must make; how much more usable storage the target needs; catalogue batteries that can be added (same chemistry only) or replace the bank. Checks cover discharge current against the inverter, charge current against the existing charger, lithium charge profile and BMS, and mixing new with old.
- **Panels**: the string voltage window and remaining power on the existing controller or inverter; how many catalogue panels fit and in what strings; whether new strings match the old ones. If the existing charger is full, panels are offered together with a replacement controller or inverter.
- **Inverter**: replacements that meet the peak load, keep the existing bank voltage and accept the existing array.
- **Charge controller**: replacements sized to the target array and the existing strings.

Usable energy of an existing bank assumes 80% depth of discharge for lithium and 50% for lead-acid when no datasheet is to hand; 12.8, 25.6 and 51.2 V lithium blocks are treated as 12, 24 and 48 V class.

## Prices
Staff see today's list price for each option, with "Lowest cost", "Most efficient" and "Longest cycle life" tags where options can be compared. The public never see prices. Cost and floor prices never leave the server.

## From report to quotation
1. An agent runs a check and saves it to a customer and site as an **upgrade study**. Studies are append-only: to change a figure, run a new check.
2. The report can be downloaded as a PDF. Every page carries the unverified banner.
3. The agent chooses one option per part of the system and creates a quotation. It follows the normal workflow in `QUOTATION_WORKFLOW.md`.
4. A technician who does not own the study must record that the ratings were verified against the real equipment. Until then a quotation built on the study cannot be approved or issued.

A public request arrives in Quote requests marked "Wants to upgrade an existing system". Converting it creates the customer, site and upgrade study.

## Limits
- The check needs a connection; it is not available offline.
- It covers the four main component types. Cables, protection and mounting changes are for the technician.
- Site-specific sun hours are not yet used for upgrade studies.
