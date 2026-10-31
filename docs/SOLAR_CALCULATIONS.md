# Solar Calculations and Technical Validation

## Safety boundary
This document defines calculation concepts, not a certified electrical design. Final sizing requires qualified technical review, applicable local electrical requirements, manufacturer documentation and site-specific conditions. Example values are never product specifications.

The engine is deterministic, versioned and unit-aware. Every result records inputs, assumptions, engine version and source data.

## Inputs
For every appliance capture quantity; rated or measured power (W); operating hours and schedule; justified duty cycle; power factor/apparent power where known; starting/surge demand and duration; criticality; AC/DC type; and confidence/source (nameplate, measurement or estimate).

Also capture system type, location and solar-resource source, seasonal/shading assumptions, backup hours/days, critical-load circuits, battery chemistry and manufacturer DoD, system losses, temperature derating, and grid/generator charging or export requirements.

## Energy and load
For appliance i, a basic estimate is:

`E_i (Wh/day) = quantity_i × power_i (W) × operating_hours_i (h/day) × duty_factor_i`

`E_daily = sum(E_i)`

Use a duty factor only where rated input does not represent continuous consumption and a defensible estimate exists. Do not apply it when operating hours already capture cycling.

Build time-of-day profiles for simultaneous demand. Do not size inverter capacity from daily kWh alone. Calculate connected load, coincident maximum demand, critical load, AC/DC energy separately, and starting/surge demand with duration constraints. Account for power factor and conversion efficiency where relevant.

## Battery
A preliminary relationship is:

`Nominal battery energy (Wh) = required delivered energy (Wh) / (usable_fraction × discharge_path_efficiency)`

Calculate backup against the critical-load profile, not automatically daily consumption multiplied by days. Consider chemistry, permitted DoD, temperature, ageing reserve, current/power limits, inverter cut-off, parallel-string restrictions and warranty. Convert Wh to Ah only at a defined DC bus voltage: `Ah = Wh / V`.

Validate battery voltage against inverter range, discharge/charge current and power, parallel configuration, BMS protocol, temperature limits, cables and protection.

## PV array
A preliminary relationship is:

`PV array power (Wp) = daily energy to be supplied (Wh/day) / (peak_sun_hours × performance_ratio)`

Include daytime loads and battery recharge, accounting for other charging sources. Justify performance ratio using site, orientation, temperature, shading, wiring, conversion and soiling. Use conservative seasonal solar resource, not a generic national assumption.

Round module count up and re-run string constraints. Validate cold open-circuit voltage, hot operating voltage within MPPT range, string current, short-circuit current, parallel-string limits, module/inverter specifications, mounting, orientation and shading.

## Inverter and conversion equipment
Select using simultaneous active load, apparent power/power factor, starting current and surge duration, temperature/altitude derating, continuous and short-duration ratings, phase/voltage/frequency, grid functions, battery capability, PV input limits and approved communications. No universal oversizing multiplier replaces load/surge analysis.

## Controller and balance of system
Validate PV voltage/current/power and battery charging profile. Include suitable DC/AC isolators, overcurrent and surge protection, earthing/bonding, cables, connectors, mounting and installation materials under applicable engineering rules. Flag unknown site/protection needs for technician/site survey.

## System types
- **Off-grid:** size generation/storage against load, autonomy and seasonal resource; include backup charging strategy where specified.
- **Hybrid:** separate grid-supported and backed-up circuits; model transfer, grid charging, export limits and backup output using actual inverter data.
- **Grid-connected:** account for grid rules, export permission/limits, anti-islanding and protection. A battery-free system must not be described as outage backup.

## Compatibility
Use product-category schemas and rules for voltage ranges, PV voltage/current/power, MPPT windows, battery chemistry/BMS, charge/discharge current, phase/frequency, manufacturer-approved pairings, warranty and environmental constraints.

Missing critical specifications produce `unknown` or `requires_review`, never an implicit pass. States: `compatible`, `incompatible`, `requires_review`.

## Audit record
Store assessment revision, engine version, inputs/units, assumptions/source references, outputs, product specification revisions, compatibility results, warnings/blockers, unresolved inputs, timestamp and actor. Display that sizing is indicative until technician review.
