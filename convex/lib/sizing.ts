/**
 * Deterministic solar sizing and compatibility checks (engine `size-1`).
 *
 * Pure functions: the same assessment inputs, assumptions and product
 * specifications always give the same result. Formulas follow
 * docs/SOLAR_CALCULATIONS.md. Results are indicative until a technician
 * reviews them. A missing critical specification yields "requires_review",
 * never an implicit pass, and a product that lacks the data needed to size it
 * is rejected with the reason shown.
 */
import { computeLoad, type LoadLine } from "./load";

export const SIZING_ENGINE_VERSION = "size-1";

export type SystemType = "off_grid" | "hybrid" | "grid_tied" | "backup_only";

export type Assumptions = {
  // Conservative design-month peak sun hours for the site, and where the figure came from.
  peakSunHours: number;
  solarResourceSource: string;
  performanceRatio: number;
  // Used only when a battery does not publish a recommended depth of discharge.
  defaultDod: number;
  dischargeEfficiency: number;
  // Battery in-and-out efficiency applied to energy that passes through storage.
  roundTripEfficiency: number;
  inverterEfficiency: number;
  // Extra continuous inverter capacity over the calculated AC peak (1 = none).
  inverterHeadroom: number;
  minCellTempC: number;
  maxCellTempC: number;
  // Share of daily energy a grid-tied array should offset.
  gridTiedOffset: number;
};

export const DEFAULT_ASSUMPTIONS: Omit<Assumptions, "solarResourceSource"> = {
  peakSunHours: 4,
  performanceRatio: 0.75,
  defaultDod: 0.5,
  dischargeEfficiency: 0.95,
  roundTripEfficiency: 0.9,
  inverterEfficiency: 0.92,
  inverterHeadroom: 1.2,
  minCellTempC: 15,
  maxCellTempC: 65,
  gridTiedOffset: 1
};

/** Returns the first problem with an assumptions set, or null. */
export function validateAssumptions(a: Assumptions): string | null {
  const within = (n: number, lo: number, hi: number) => Number.isFinite(n) && n > lo && n <= hi;
  if (!within(a.peakSunHours, 0, 8)) return "Peak sun hours must be above 0 and at most 8.";
  if (!a.solarResourceSource.trim()) return "Say where the peak sun hours figure came from.";
  if (!within(a.performanceRatio, 0.3, 1)) return "Performance ratio must be between 0.3 and 1.";
  if (!within(a.defaultDod, 0, 1)) return "Depth of discharge must be above 0 and at most 1.";
  if (!within(a.dischargeEfficiency, 0.5, 1)) return "Discharge efficiency must be between 0.5 and 1.";
  if (!within(a.roundTripEfficiency, 0.5, 1)) return "Round-trip efficiency must be between 0.5 and 1.";
  if (!within(a.inverterEfficiency, 0.5, 1)) return "Inverter efficiency must be between 0.5 and 1.";
  if (!(Number.isFinite(a.inverterHeadroom) && a.inverterHeadroom >= 1 && a.inverterHeadroom <= 2)) {
    return "Inverter headroom must be between 1 and 2.";
  }
  if (!(Number.isFinite(a.minCellTempC) && a.minCellTempC >= -40 && a.minCellTempC <= 25)) {
    return "Minimum cell temperature must be between -40 and 25 °C.";
  }
  if (!(Number.isFinite(a.maxCellTempC) && a.maxCellTempC >= 25 && a.maxCellTempC <= 100)) {
    return "Maximum cell temperature must be between 25 and 100 °C.";
  }
  if (!within(a.gridTiedOffset, 0, 1)) return "Grid-tied offset must be above 0 and at most 1.";
  return null;
}

export type SizingInputs = {
  systemType: SystemType;
  backupHours?: number;
  autonomyDays?: number;
  lines: LoadLine[];
};

export type Requirements = {
  blockers: string[];
  warnings: string[];
  dailyEnergyWh: number;
  // Energy the battery must deliver, before depth-of-discharge and efficiency. Null when no battery.
  batteryDeliveredWh: number | null;
  // Daily energy the PV array must supply. Null when the array is not sized.
  pvEnergyWh: number | null;
  pvWp: number | null;
  acPeakW: number;
  acPeakVA: number;
  acSurgePeakW: number;
  requiredInverterW: number;
  requiredInverterVA: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Largest energy drawn over `hours` consecutive hours of a 24-hour profile, wrapping midnight. */
export function worstWindowWh(hourlyW: number[], hours: number) {
  const span = Math.min(24, Math.ceil(hours));
  let worst = 0;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < span; i++) sum += hourlyW[(start + i) % 24];
    worst = Math.max(worst, sum);
  }
  return worst;
}

export function computeRequirements(inputs: SizingInputs, a: Assumptions): Requirements {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const all = computeLoad(inputs.lines);
  const ac = computeLoad(inputs.lines.filter((l) => l.currentType === "ac"));

  if (inputs.lines.length === 0) blockers.push("The assessment has no appliances.");
  if (ac.connectedLoadW === 0 && inputs.lines.length > 0) {
    blockers.push("DC-only systems are not supported yet; a technician must design this one.");
  }

  let batteryDeliveredWh: number | null = null;
  const { systemType } = inputs;
  if (systemType === "off_grid") {
    if (!(inputs.autonomyDays && inputs.autonomyDays > 0)) {
      blockers.push("An off-grid system needs the days of autonomy.");
    } else {
      // Conservative: the battery alone could carry a full day's load for each day of autonomy.
      batteryDeliveredWh = all.dailyEnergyWh * inputs.autonomyDays;
    }
  } else if (systemType === "hybrid" || systemType === "backup_only") {
    if (!(inputs.backupHours && inputs.backupHours > 0)) {
      blockers.push("This system type needs the backup hours required.");
    } else {
      const useCritical = all.criticalEnergyWh > 0;
      if (!useCritical) {
        warnings.push("No loads are marked critical, so backup is sized for every load.");
      }
      const profile = useCritical ? all.hourlyCriticalW : all.hourlyDemandW;
      const dailyWh = useCritical ? all.criticalEnergyWh : all.dailyEnergyWh;
      const days = Math.floor(inputs.backupHours / 24);
      const rest = inputs.backupHours - days * 24;
      batteryDeliveredWh =
        days * dailyWh + (rest > 0 ? worstWindowWh(profile, rest) : 0);
    }
  } else {
    warnings.push("A grid-tied system without a battery gives no backup during an outage.");
  }

  let pvEnergyWh: number | null = null;
  if (systemType === "off_grid" || systemType === "hybrid") {
    // Daytime loads are served directly; night loads pass through the battery.
    pvEnergyWh = all.daytimeEnergyWh + all.nighttimeEnergyWh / a.roundTripEfficiency;
    if (systemType === "hybrid") {
      warnings.push("Hybrid PV is sized to supply the whole load; the grid is not credited.");
    }
  } else if (systemType === "grid_tied") {
    pvEnergyWh = all.dailyEnergyWh * a.gridTiedOffset;
  } else {
    warnings.push("Backup-only: the battery is assumed to charge from the grid, so PV is not sized.");
  }
  const pvWp = pvEnergyWh === null ? null : pvEnergyWh / (a.peakSunHours * a.performanceRatio);

  if (ac.criticalEnergyWh === 0 && all.criticalEnergyWh > 0) {
    warnings.push("All critical loads are DC.");
  }
  warnings.push(...all.warnings);

  return {
    blockers,
    warnings,
    dailyEnergyWh: all.dailyEnergyWh,
    batteryDeliveredWh: batteryDeliveredWh === null ? null : round2(batteryDeliveredWh),
    pvEnergyWh: pvEnergyWh === null ? null : round2(pvEnergyWh),
    pvWp: pvWp === null ? null : round2(pvWp),
    acPeakW: ac.coincidentPeakW,
    acPeakVA: ac.peakApparentVA ?? 0,
    acSurgePeakW: ac.peakWithSurgeW,
    requiredInverterW: round2(ac.coincidentPeakW * a.inverterHeadroom),
    requiredInverterVA: round2((ac.peakApparentVA ?? 0) * a.inverterHeadroom)
  };
}

// ---------------------------------------------------------------- compatibility

export type CatalogueItem = {
  id: string;
  sku: string;
  name: string;
  categoryKey: string;
  specSchemaVersion: number;
  specValues: Record<string, number | string | boolean>;
};

export type CheckState = "pass" | "fail" | "review";
export type Check = { id: string; label: string; state: CheckState; detail: string };
export type CompatibilityStatus = "compatible" | "incompatible" | "requires_review";

export type Candidate = {
  inverterId: string;
  batteryId: string | null;
  panelId: string | null;
  counts: {
    panels: number;
    panelsPerString: number;
    parallelStrings: number;
    arrayWp: number;
    batteries: number;
    batteriesInSeries: number;
    batteryStrings: number;
    batteryNominalWh: number;
  };
  checks: Check[];
  status: CompatibilityStatus;
};

export type Rejection = { inverterId: string; batteryId: string | null; panelId: string | null; reason: string };

const num = (item: CatalogueItem, key: string) => {
  const v = item.specValues[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const text = (item: CatalogueItem, key: string) => {
  const v = item.specValues[key];
  return typeof v === "string" ? v : undefined;
};
const missing = (item: CatalogueItem, keys: string[]) => keys.filter((k) => num(item, k) === undefined);
const missingCheck = (id: string, label: string, item: CatalogueItem, keys: string[]): Check => ({
  id,
  label,
  state: "review",
  detail: `${item.sku} has no ${keys.join(", ")} specification, so this cannot be validated.`
});

function statusOf(checks: Check[]): CompatibilityStatus {
  if (checks.some((c) => c.state === "fail")) return "incompatible";
  if (checks.some((c) => c.state === "review")) return "requires_review";
  return "compatible";
}

const TOPOLOGY_OK: Record<SystemType, string[]> = {
  off_grid: ["Off-grid", "Hybrid"],
  hybrid: ["Hybrid"],
  backup_only: ["Hybrid", "Off-grid"],
  grid_tied: ["Grid-connected", "Hybrid"]
};

/** Inverter checks that do not depend on the battery or panels. */
function inverterChecks(inv: CatalogueItem, req: Requirements, type: SystemType): Check[] {
  const checks: Check[] = [];

  const topology = text(inv, "topology");
  checks.push(
    topology === undefined
      ? { id: "topology", label: "Inverter type", state: "review", detail: `${inv.sku} has no type specified.` }
      : TOPOLOGY_OK[type].includes(topology)
        ? { id: "topology", label: "Inverter type", state: "pass", detail: `${topology} suits a ${type.replace("_", "-")} system.` }
        : { id: "topology", label: "Inverter type", state: "fail", detail: `A ${topology} inverter does not suit a ${type.replace("_", "-")} system.` }
  );

  const power = num(inv, "rated_output_power");
  checks.push(
    power === undefined
      ? missingCheck("inverter_power", "Continuous power", inv, ["rated_output_power"])
      : power >= req.requiredInverterW
        ? { id: "inverter_power", label: "Continuous power", state: "pass", detail: `${power} W covers the required ${req.requiredInverterW} W.` }
        : { id: "inverter_power", label: "Continuous power", state: "fail", detail: `${power} W is below the required ${req.requiredInverterW} W.` }
  );

  const va = num(inv, "rated_output_apparent");
  checks.push(
    va === undefined
      ? missingCheck("inverter_apparent", "Apparent power", inv, ["rated_output_apparent"])
      : va >= req.requiredInverterVA
        ? { id: "inverter_apparent", label: "Apparent power", state: "pass", detail: `${va} VA covers the required ${req.requiredInverterVA} VA.` }
        : { id: "inverter_apparent", label: "Apparent power", state: "fail", detail: `${va} VA is below the required ${req.requiredInverterVA} VA.` }
  );

  if (req.acSurgePeakW > req.acPeakW) {
    const surge = num(inv, "surge_power");
    const duration = num(inv, "surge_duration");
    if (surge === undefined) {
      checks.push(missingCheck("inverter_surge", "Start-up surge", inv, ["surge_power"]));
    } else if (surge < req.acSurgePeakW) {
      checks.push({ id: "inverter_surge", label: "Start-up surge", state: "fail", detail: `${surge} W surge is below the ${req.acSurgePeakW} W the loads can demand when starting.` });
    } else if (duration === undefined) {
      checks.push(missingCheck("inverter_surge", "Start-up surge", inv, ["surge_duration"]));
    } else {
      checks.push({ id: "inverter_surge", label: "Start-up surge", state: "review", detail: `${surge} W for ${duration} s covers the ${req.acSurgePeakW} W start-up peak; a technician must confirm the start-up duration of the motor loads.` });
    }
  }

  const phase = text(inv, "phase");
  checks.push(
    phase === "Single-phase"
      ? { id: "phase", label: "Phase", state: "pass", detail: "Single-phase output." }
      : { id: "phase", label: "Phase", state: "review", detail: phase ? `${phase} output: confirm the site supply and load phases.` : `${inv.sku} has no output phase specified.` }
  );
  return checks;
}

type Battery = {
  item: CatalogueItem;
  checks: Check[];
  counts: { batteries: number; batteriesInSeries: number; batteryStrings: number; batteryNominalWh: number };
};

function planBattery(
  inv: CatalogueItem,
  bat: CatalogueItem,
  req: Requirements,
  a: Assumptions
): Battery | string {
  const bus = num(inv, "battery_voltage");
  const nominalV = num(bat, "nominal_voltage");
  const ah = num(bat, "capacity_ah");
  if (bus === undefined) return `${inv.sku} has no battery voltage, so batteries cannot be configured.`;
  if (nominalV === undefined || ah === undefined) {
    return `${bat.sku} has no nominal voltage or capacity, so it cannot be sized.`;
  }
  const series = bus / nominalV;
  if (!Number.isInteger(series) || series < 1) {
    return `${bat.sku} (${nominalV} V) cannot make up the ${bus} V battery bus of ${inv.sku}.`;
  }

  const checks: Check[] = [
    { id: "battery_voltage", label: "Battery voltage", state: "pass", detail: `${series} × ${nominalV} V in series make the ${bus} V bus.` }
  ];

  const recDod = num(bat, "recommended_dod");
  const usable = recDod !== undefined ? Math.min(1, recDod / 100) : a.defaultDod;
  checks.push(
    recDod !== undefined
      ? { id: "battery_dod", label: "Depth of discharge", state: "pass", detail: `Sized to the manufacturer's ${recDod}%.` }
      : { id: "battery_dod", label: "Depth of discharge", state: "review", detail: `${bat.sku} has no recommended depth of discharge; ${usable * 100}% was assumed.` }
  );

  const nominalWh = (req.batteryDeliveredWh ?? 0) / (usable * a.dischargeEfficiency);
  const stringWh = bus * ah;
  const strings = Math.max(1, Math.ceil(nominalWh / stringWh - 1e-9));

  const maxDischarge = num(bat, "max_discharge_current");
  const neededA = req.requiredInverterW / (bus * a.inverterEfficiency);
  checks.push(
    maxDischarge === undefined
      ? missingCheck("battery_discharge", "Discharge current", bat, ["max_discharge_current"])
      : maxDischarge * strings >= neededA
        ? { id: "battery_discharge", label: "Discharge current", state: "pass", detail: `${round2(maxDischarge * strings)} A available for ${round2(neededA)} A needed.` }
        : { id: "battery_discharge", label: "Discharge current", state: "fail", detail: `${round2(maxDischarge * strings)} A available is below the ${round2(neededA)} A the inverter can draw.` }
  );

  const invCharge = num(inv, "max_charge_current");
  const batCharge = num(bat, "max_charge_current");
  if (invCharge === undefined || batCharge === undefined) {
    checks.push({ id: "battery_charge", label: "Charge current", state: "review", detail: "A charge current limit is missing for the inverter or battery, so the charge settings cannot be validated." });
  } else if (invCharge > batCharge * strings) {
    checks.push({ id: "battery_charge", label: "Charge current", state: "review", detail: `The inverter can charge at ${invCharge} A but the batteries accept ${batCharge * strings} A: the charge limit must be set lower.` });
  } else {
    checks.push({ id: "battery_charge", label: "Charge current", state: "pass", detail: `Inverter charge limit ${invCharge} A is within the batteries' ${batCharge * strings} A.` });
  }

  const chemistry = text(bat, "chemistry") ?? "";
  if (chemistry.startsWith("Lithium") || chemistry === "LiFePO4") {
    const bms = bat.specValues["has_bms"];
    checks.push(
      bms === true
        ? { id: "battery_bms", label: "Battery management", state: "pass", detail: "Built-in BMS." }
        : { id: "battery_bms", label: "Battery management", state: "review", detail: bms === false ? `${bat.sku} is lithium with no built-in BMS.` : `${bat.sku} is lithium and its BMS is not specified.` }
    );
  }

  return {
    item: bat,
    checks,
    counts: {
      batteries: series * strings,
      batteriesInSeries: series,
      batteryStrings: strings,
      batteryNominalWh: round2(series * strings * nominalV * ah)
    }
  };
}

type Array_ = {
  item: CatalogueItem;
  checks: Check[];
  counts: { panels: number; panelsPerString: number; parallelStrings: number; arrayWp: number };
};

function planArray(inv: CatalogueItem, panel: CatalogueItem, req: Requirements, a: Assumptions): Array_ | string {
  const wp = num(panel, "rated_power");
  if (wp === undefined || wp <= 0) return `${panel.sku} has no rated power, so it cannot be sized.`;
  const needed = missing(panel, ["voc", "vmp", "isc"]);
  const invNeeded = missing(inv, ["max_pv_voltage", "mppt_min_voltage", "mppt_max_voltage", "max_pv_current", "mppt_count"]);
  if (needed.length || invNeeded.length) {
    return `Cannot configure strings for ${panel.sku} on ${inv.sku}: missing ${[...needed.map((k) => `${panel.sku} ${k}`), ...invNeeded.map((k) => `${inv.sku} ${k}`)].join(", ")}.`;
  }
  const voc = num(panel, "voc")!;
  const vmp = num(panel, "vmp")!;
  const isc = num(panel, "isc")!;
  const maxPv = num(inv, "max_pv_voltage")!;
  const mpptMin = num(inv, "mppt_min_voltage")!;
  const mpptMax = num(inv, "mppt_max_voltage")!;
  const maxCurrent = num(inv, "max_pv_current")!;
  const mppts = num(inv, "mppt_count")!;

  const checks: Check[] = [];
  const coeffPct = num(panel, "voc_temp_coeff");
  const k = (coeffPct ?? -0.35) / 100;
  if (coeffPct === undefined) {
    checks.push({ id: "pv_temp", label: "Temperature coefficient", state: "review", detail: `${panel.sku} has no Voc temperature coefficient; -0.35 %/°C was assumed.` });
  }
  const vocCold = voc * (1 + k * (a.minCellTempC - 25));
  const vmpCold = vmp * (1 + k * (a.minCellTempC - 25));
  // The Vmp coefficient is not catalogued, so the Voc coefficient stands in for it.
  const vmpHot = vmp * (1 + k * (a.maxCellTempC - 25));

  const panelMaxSystem = num(panel, "max_system_voltage");
  const sMax = Math.floor(Math.min(maxPv / vocCold, mpptMax / vmpCold, panelMaxSystem !== undefined ? panelMaxSystem / vocCold : Infinity));
  const sMin = Math.ceil(mpptMin / vmpHot);
  if (sMax < 1 || sMin > sMax) {
    return `${panel.sku} cannot form a string inside the ${mpptMin}–${mpptMax} V MPPT window and ${maxPv} V limit of ${inv.sku}.`;
  }

  const want = Math.max(1, Math.ceil((req.pvWp ?? 0) / wp));
  let best = { s: sMax, p: Math.ceil(want / sMax), waste: Infinity };
  for (let s = sMax; s >= sMin; s--) {
    const p = Math.ceil(want / s);
    const waste = p * s - want;
    if (waste < best.waste) best = { s, p, waste };
  }
  const { s, p } = best;
  const panels = s * p;
  const arrayWp = panels * wp;
  const perMppt = Math.ceil(p / mppts);

  checks.push({ id: "pv_voltage", label: "String voltage", state: "pass", detail: `${s} panels per string: ${round2(s * vocCold)} V cold open-circuit (limit ${maxPv} V), ${round2(s * vmpHot)} V hot at max power (MPPT from ${mpptMin} V).` });
  if (isc * perMppt > maxCurrent) {
    checks.push({ id: "pv_current", label: "String current", state: "fail", detail: `${p} strings on ${mppts} MPPT input(s) puts ${round2(isc * perMppt)} A short-circuit on one input; the limit is ${maxCurrent} A.` });
  } else {
    checks.push({ id: "pv_current", label: "String current", state: "pass", detail: `${round2(isc * perMppt)} A short-circuit per input is within ${maxCurrent} A.` });
  }

  const maxPvPower = num(inv, "max_pv_input_power");
  checks.push(
    maxPvPower === undefined
      ? missingCheck("pv_power", "PV input power", inv, ["max_pv_input_power"])
      : arrayWp > maxPvPower
        ? { id: "pv_power", label: "PV input power", state: "fail", detail: `${arrayWp} Wp exceeds the inverter's ${maxPvPower} W PV input limit.` }
        : { id: "pv_power", label: "PV input power", state: "pass", detail: `${arrayWp} Wp is within the ${maxPvPower} W limit.` }
  );

  return { item: panel, checks, counts: { panels, panelsPerString: s, parallelStrings: p, arrayWp } };
}

export type CandidatesResult = {
  status: "blocked" | "no_candidates" | "ok";
  messages: string[];
  candidates: Candidate[];
  rejected: Rejection[];
};

const MAX_CANDIDATES = 5;
const MAX_REJECTED = 10;

export function buildCandidates(
  inputs: SizingInputs,
  req: Requirements,
  a: Assumptions,
  catalogue: CatalogueItem[]
): CandidatesResult {
  if (req.blockers.length > 0) {
    return { status: "blocked", messages: req.blockers, candidates: [], rejected: [] };
  }
  const by = (key: string) => catalogue.filter((c) => c.categoryKey === key);
  const inverters = by("inverter");
  const batteries = by("battery");
  const panels = by("pv_panel");

  const needsBattery = req.batteryDeliveredWh !== null;
  const needsPv = req.pvWp !== null;
  const messages: string[] = [];
  if (inverters.length === 0) messages.push("No active inverters in the catalogue.");
  if (needsBattery && batteries.length === 0) messages.push("No active batteries in the catalogue.");
  if (needsPv && panels.length === 0) messages.push("No active solar panels in the catalogue.");
  if (messages.length > 0) return { status: "no_candidates", messages, candidates: [], rejected: [] };

  const candidates: Candidate[] = [];
  const rejected: Rejection[] = [];
  const reject = (inv: CatalogueItem, bat: CatalogueItem | null, pan: CatalogueItem | null, reason: string) => {
    if (rejected.length < MAX_REJECTED && !rejected.some((r) => r.reason === reason)) {
      rejected.push({ inverterId: inv.id, batteryId: bat?.id ?? null, panelId: pan?.id ?? null, reason });
    }
  };

  for (const inv of inverters) {
    const base = inverterChecks(inv, req, inputs.systemType);
    const failed = base.find((c) => c.state === "fail");
    if (failed) {
      reject(inv, null, null, `${inv.sku}: ${failed.detail}`);
      continue;
    }
    for (const bat of needsBattery ? batteries : [null]) {
      const batPlan = bat ? planBattery(inv, bat, req, a) : null;
      if (typeof batPlan === "string") {
        reject(inv, bat, null, batPlan);
        continue;
      }
      const batFail = batPlan?.checks.find((c) => c.state === "fail");
      if (batFail) {
        reject(inv, bat, null, `${bat!.sku} with ${inv.sku}: ${batFail.detail}`);
        continue;
      }
      for (const pan of needsPv ? panels : [null]) {
        const arrPlan = pan ? planArray(inv, pan, req, a) : null;
        if (typeof arrPlan === "string") {
          reject(inv, bat, pan, arrPlan);
          continue;
        }
        const arrFail = arrPlan?.checks.find((c) => c.state === "fail");
        if (arrFail) {
          reject(inv, bat, pan, `${pan!.sku} with ${inv.sku}: ${arrFail.detail}`);
          continue;
        }
        const checks = [...base, ...(batPlan?.checks ?? []), ...(arrPlan?.checks ?? [])];
        candidates.push({
          inverterId: inv.id,
          batteryId: bat?.id ?? null,
          panelId: pan?.id ?? null,
          counts: {
            panels: arrPlan?.counts.panels ?? 0,
            panelsPerString: arrPlan?.counts.panelsPerString ?? 0,
            parallelStrings: arrPlan?.counts.parallelStrings ?? 0,
            arrayWp: arrPlan?.counts.arrayWp ?? 0,
            batteries: batPlan?.counts.batteries ?? 0,
            batteriesInSeries: batPlan?.counts.batteriesInSeries ?? 0,
            batteryStrings: batPlan?.counts.batteryStrings ?? 0,
            batteryNominalWh: batPlan?.counts.batteryNominalWh ?? 0
          },
          checks,
          status: statusOf(checks)
        });
      }
    }
  }

  const skuOf = (id: string | null) => catalogue.find((c) => c.id === id)?.sku ?? "";
  const rank = (c: Candidate) => (c.status === "compatible" ? 0 : 1);
  candidates.sort(
    (x, y) =>
      rank(x) - rank(y) ||
      x.counts.panels + x.counts.batteries - (y.counts.panels + y.counts.batteries) ||
      `${skuOf(x.inverterId)}${skuOf(x.batteryId)}${skuOf(x.panelId)}`.localeCompare(
        `${skuOf(y.inverterId)}${skuOf(y.batteryId)}${skuOf(y.panelId)}`
      )
  );

  const top = candidates.slice(0, MAX_CANDIDATES);
  return {
    status: top.length > 0 ? "ok" : "no_candidates",
    messages: top.length > 0 ? [] : ["No combination of catalogue products passed every check."],
    candidates: top,
    rejected
  };
}
