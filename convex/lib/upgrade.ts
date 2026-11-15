/**
 * Deterministic upgrade study for a solar system that is already installed
 * (engine `upgrade-1`).
 *
 * Pure functions: the same reported system, needs, assumptions and catalogue
 * always give the same report. The existing system is described by nameplate
 * ratings typed in by an agent or the owner, so everything here is indicative
 * until a technician has verified those ratings on site. A rating that was not
 * given means "cannot validate" (a `review` check), never an implicit pass.
 *
 * The report answers three questions for each part of the system:
 *   1. What does the existing equipment require of anything added to it
 *      (bank voltage, string voltage window, charge and power limits)?
 *   2. How much more is needed to meet what the customer wants?
 *   3. Which catalogue products fit, and what must a technician still confirm?
 */
import {
  TOPOLOGY_OK,
  type Assumptions,
  type CatalogueItem,
  type Check,
  type CompatibilityStatus,
  type SystemType
} from "./sizing";

export const UPGRADE_ENGINE_VERSION = "upgrade-1";

export type Chemistry = "lithium" | "lead_acid" | "unknown";
export type UpgradeGoal = "battery" | "panels" | "inverter" | "swaps" | "repair";
export const UPGRADE_GOALS: UpgradeGoal[] = ["battery", "panels", "inverter", "swaps", "repair"];
export type FaultyPart = "battery" | "panels" | "inverter" | "controller";

export type ExistingSystem = {
  systemType: SystemType;
  /** Nominal battery bank voltage (12, 24, 48 ...). Not needed for a grid-tied system without batteries. */
  systemVoltage?: number;
  inverter?: {
    ratedW: number;
    surgeW?: number;
    /** True when the panels plug straight into the inverter (built-in solar charger). */
    hasSolarInput: boolean;
    maxPvPowerW?: number;
    maxPvVoltage?: number;
    mpptMinVoltage?: number;
    maxPvCurrentA?: number;
    maxChargeA?: number;
  };
  /** A separate solar charge controller, when there is one. */
  controller?: {
    technology: "MPPT" | "PWM";
    maxChargeA: number;
    maxPvVoltage?: number;
    maxPvPowerW?: number;
  };
  panels?: {
    count: number;
    wp: number;
    voc?: number;
    vmp?: number;
    isc?: number;
    /** Panels wired in series in each string. */
    perString?: number;
  };
  batteries?: {
    count: number;
    nominalV: number;
    ah: number;
    chemistry: Chemistry;
    ageYears?: number;
  };
};

export type UpgradeNeeds = {
  goals: UpgradeGoal[];
  /** Energy the customer wants from solar each day. */
  dailyKwh?: number;
  /** Largest load running at one time. */
  peakLoadW?: number;
  backupHours?: number;
  /** Load to carry during those backup hours. */
  backupLoadW?: number;
  /** With the "repair" goal: the parts that are faulty or no longer work as well as they should. */
  faultyParts?: FaultyPart[];
  /** The owner's own words about what is wrong. */
  faultNote?: string;
};

/** True when the owner reported this part as faulty or worn out. */
export function isFaulty(needs: UpgradeNeeds, part: FaultyPart) {
  return needs.goals.includes("repair") && (needs.faultyParts ?? []).includes(part);
}

const FAULTY_LABEL: Record<FaultyPart, string> = {
  battery: "batteries",
  panels: "panels",
  inverter: "inverter",
  controller: "charge controller"
};

export type UpgradeArea = "battery" | "panels" | "inverter" | "controller";

export type UpgradeOption = {
  /** Stable within one report: area, action and product. */
  key: string;
  area: UpgradeArea;
  action: "add" | "replace";
  productId: string;
  quantity: number;
  title: string;
  summary: string;
  /** Numbers behind the summary, in base units (Wh, Wp, W, V, h, %). */
  figures: Record<string, number>;
  checks: Check[];
  status: CompatibilityStatus;
  /** Key of another option in the same report that this one only works together with. */
  requires?: string;
};

export type UpgradeSection = {
  area: UpgradeArea;
  title: string;
  /** What the existing equipment requires of anything added or swapped here. */
  requirements: string[];
  /** Plain-language conclusions about the gap. */
  messages: string[];
  options: UpgradeOption[];
  /** Why catalogue products were left out (first few reasons). */
  rejected: string[];
};

export type UpgradeReport = {
  engineVersion: string;
  /** Problems with the reported system that stop the study. */
  blockers: string[];
  current: {
    systemVoltage: number | null;
    arrayWp: number;
    solarWhPerDay: number;
    batteryNominalWh: number;
    batteryUsableWh: number;
    /** Hours the existing bank carries the stated backup load, when one was given. */
    backupHours: number | null;
    inverterW: number | null;
    /** Largest array the existing solar charger accepts, when it can be worked out. */
    chargerLimitWp: number | null;
  };
  /** What the customer's stated needs work out to. Null when not stated. */
  required: {
    pvWp: number | null;
    batteryDeliveredWh: number | null;
    inverterW: number | null;
  };
  /** Checks on the system as it stands today. */
  findings: Check[];
  sections: UpgradeSection[];
};

// ------------------------------------------------------------------ helpers

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const kwh = (wh: number) => `${round1(wh / 1000)} kWh`;
const MAX_OPTIONS = 40;
const MAX_REJECTED = 6;
/** Assumed when a panel's Voc temperature coefficient is unknown (as the sizing engine does). */
const DEFAULT_VOC_COEFF_PCT = -0.35;
/** A string's hot Vmp must stay above the battery charging voltage: about 1.2 x nominal. */
const CHARGE_VOLTAGE_FACTOR = 1.2;
/** New strings sharing an MPPT input with old ones should be within this share of their voltage. */
const STRING_MATCH_TOLERANCE = 0.05;
/** Depth of discharge assumed for an existing bank whose datasheet is not to hand. */
export const EXISTING_DOD: Record<Chemistry, number | null> = { lithium: 0.8, lead_acid: 0.5, unknown: null };

const num = (item: CatalogueItem, key: string) => {
  const v = item.specValues[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const text = (item: CatalogueItem, key: string) => {
  const v = item.specValues[key];
  return typeof v === "string" ? v : undefined;
};

function statusOf(checks: Check[]): CompatibilityStatus {
  if (checks.some((c) => c.state === "fail")) return "incompatible";
  if (checks.some((c) => c.state === "review")) return "requires_review";
  return "compatible";
}

/**
 * The bank-voltage class a battery belongs to. Lithium iron phosphate blocks
 * are labelled by cell voltage (12.8, 25.6, 51.2 V) but are used on 12, 24 and
 * 48 V systems, so they are matched by class while energy uses the real figure.
 */
export function busClass(nominalV: number) {
  const blocks = nominalV / 12.8;
  return Math.abs(blocks - Math.round(blocks)) < 1e-6 && blocks >= 1 ? Math.round(blocks) * 12 : nominalV;
}

/** Maps a catalogue chemistry label to the family that decides what may be wired together. */
export function chemistryFamily(label: string | undefined): Chemistry {
  if (!label) return "unknown";
  if (label === "LiFePO4" || label.startsWith("Lithium")) return "lithium";
  if (label.toLowerCase().includes("lead-acid")) return "lead_acid";
  return "unknown";
}

const SYSTEM_NAME: Record<SystemType, string> = {
  off_grid: "an off-grid",
  hybrid: "a hybrid",
  grid_tied: "a grid-tied",
  backup_only: "a backup-only"
};

const CHEMISTRY_NAME: Record<Chemistry, string> = {
  lithium: "lithium",
  lead_acid: "lead-acid",
  unknown: "unknown-chemistry"
};

/** Returns the first problem with the reported system or needs, or null. */
export function validateExisting(sys: ExistingSystem, needs: UpgradeNeeds): string | null {
  const within = (n: number | undefined, lo: number, hi: number) =>
    n === undefined || (Number.isFinite(n) && n > lo && n <= hi);
  const whole = (n: number, hi: number) => Number.isInteger(n) && n >= 1 && n <= hi;

  if (!sys.inverter && !sys.controller && !sys.panels && !sys.batteries) {
    return "Describe at least one part of the existing system.";
  }
  if (!within(sys.systemVoltage, 5, 1000)) return "System (battery bank) voltage must be between 6 V and 1000 V.";
  if (sys.batteries && sys.systemVoltage === undefined) {
    return "Give the system (battery bank) voltage, for example 12, 24 or 48 V.";
  }
  if (sys.controller && sys.systemVoltage === undefined) {
    return "Give the system (battery bank) voltage the charge controller works at.";
  }
  if (sys.inverter) {
    const i = sys.inverter;
    if (!within(i.ratedW, 0, 10_000_000) || i.ratedW === undefined) return "Inverter power must be above 0 W.";
    if (!within(i.surgeW, 0, 50_000_000)) return "Inverter surge power must be above 0 W.";
    if (!within(i.maxPvPowerW, 0, 10_000_000)) return "Inverter solar input power must be above 0 W.";
    if (!within(i.maxPvVoltage, 0, 2000)) return "Inverter maximum solar voltage must be between 1 and 2000 V.";
    if (!within(i.mpptMinVoltage, 0, 2000)) return "Inverter MPPT minimum voltage must be between 1 and 2000 V.";
    if (!within(i.maxPvCurrentA, 0, 2000)) return "Inverter solar input current must be above 0 A.";
    if (!within(i.maxChargeA, 0, 5000)) return "Inverter charge current must be above 0 A.";
  }
  if (sys.controller) {
    const c = sys.controller;
    if (!(Number.isFinite(c.maxChargeA) && c.maxChargeA > 0 && c.maxChargeA <= 5000)) {
      return "Charge controller current must be above 0 A.";
    }
    if (!within(c.maxPvVoltage, 0, 2000)) return "Charge controller maximum solar voltage must be between 1 and 2000 V.";
    if (!within(c.maxPvPowerW, 0, 10_000_000)) return "Charge controller solar power must be above 0 W.";
  }
  if (sys.panels) {
    const p = sys.panels;
    if (!whole(p.count, 100_000)) return "Number of panels must be a whole number of 1 or more.";
    if (!(Number.isFinite(p.wp) && p.wp > 0 && p.wp <= 2000)) return "Panel power must be between 1 and 2000 W.";
    if (!within(p.voc, 0, 500)) return "Panel open-circuit voltage (Voc) must be between 1 and 500 V.";
    if (!within(p.vmp, 0, 500)) return "Panel voltage at max power (Vmp) must be between 1 and 500 V.";
    if (!within(p.isc, 0, 100)) return "Panel short-circuit current (Isc) must be between 0 and 100 A.";
    if (p.voc !== undefined && p.vmp !== undefined && p.vmp >= p.voc) return "Panel Vmp must be lower than its Voc.";
    if (p.perString !== undefined && (!whole(p.perString, 200) || p.perString > p.count)) {
      return "Panels per string must be a whole number no larger than the number of panels.";
    }
    if (p.perString !== undefined && p.count % p.perString !== 0) {
      return "The number of panels must divide evenly into strings of the size given.";
    }
  }
  if (sys.batteries) {
    const b = sys.batteries;
    if (!whole(b.count, 10_000)) return "Number of batteries must be a whole number of 1 or more.";
    if (!(Number.isFinite(b.nominalV) && b.nominalV > 0 && b.nominalV <= 1000)) return "Battery voltage must be above 0 V.";
    if (!(Number.isFinite(b.ah) && b.ah > 0 && b.ah <= 100_000)) return "Battery capacity must be above 0 Ah.";
    if (!within(b.ageYears, -1, 60) || (b.ageYears !== undefined && b.ageYears < 0)) {
      return "Battery age must be between 0 and 60 years.";
    }
  }
  if (needs.goals.length === 0) return "Choose what the customer wants to improve.";
  if (needs.goals.includes("repair")) {
    const parts = needs.faultyParts ?? [];
    if (parts.length === 0) return "Say which part is faulty or no longer works as well as it should.";
    const present: Record<FaultyPart, boolean> = {
      battery: Boolean(sys.batteries),
      panels: Boolean(sys.panels),
      inverter: Boolean(sys.inverter),
      controller: Boolean(sys.controller)
    };
    for (const part of parts) {
      if (!present[part]) return `The ${FAULTY_LABEL[part]} marked as faulty must be described above as part of the system.`;
    }
  }
  if (needs.faultNote !== undefined && needs.faultNote.length > 500) return "Keep the description of the fault to 500 characters.";
  if (!within(needs.dailyKwh, 0, 100_000)) return "Daily energy must be above 0 kWh.";
  if (!within(needs.peakLoadW, 0, 10_000_000)) return "Peak load must be above 0 W.";
  if (!within(needs.backupHours, 0, 240)) return "Backup hours must be above 0 and at most 240.";
  if (!within(needs.backupLoadW, 0, 10_000_000)) return "Backup load must be above 0 W.";
  if ((needs.backupHours === undefined) !== (needs.backupLoadW === undefined)) {
    return "Give both the backup hours wanted and the load to run during them, or neither.";
  }
  return null;
}

// ------------------------------------------------------------------ solar charger

type Charger = {
  source: "controller" | "inverter";
  label: string;
  technology: "MPPT" | "PWM" | "unknown";
  maxPvPowerW?: number;
  maxPvVoltage?: number;
  minPvVoltage?: number;
  maxPvCurrentA?: number;
  maxChargeA?: number;
};

/** What the panels are wired into: the separate controller when there is one, else the inverter. */
function chargerOf(sys: ExistingSystem): Charger | null {
  if (sys.controller) {
    return {
      source: "controller",
      label: "charge controller",
      technology: sys.controller.technology,
      maxPvPowerW: sys.controller.maxPvPowerW,
      maxPvVoltage: sys.controller.maxPvVoltage,
      maxChargeA: sys.controller.maxChargeA
    };
  }
  if (sys.inverter?.hasSolarInput) {
    return {
      source: "inverter",
      label: "inverter",
      technology: "unknown",
      maxPvPowerW: sys.inverter.maxPvPowerW,
      maxPvVoltage: sys.inverter.maxPvVoltage,
      minPvVoltage: sys.inverter.mpptMinVoltage,
      maxPvCurrentA: sys.inverter.maxPvCurrentA,
      maxChargeA: sys.inverter.maxChargeA
    };
  }
  return null;
}

/**
 * Largest array the charger accepts. A controller without a stated PV power is
 * limited by its charge current at the bank voltage; an inverter's charge
 * current may include grid charging, so it is not used as a PV limit.
 */
function chargerLimitWp(charger: Charger | null, systemVoltage: number | undefined): number | null {
  if (!charger) return null;
  if (charger.maxPvPowerW !== undefined) return charger.maxPvPowerW;
  if (charger.source === "controller" && charger.maxChargeA !== undefined && systemVoltage !== undefined) {
    return round2(charger.maxChargeA * systemVoltage);
  }
  return null;
}

const coldFactor = (coeffPct: number | undefined, a: Assumptions) =>
  1 + ((coeffPct ?? DEFAULT_VOC_COEFF_PCT) / 100) * (a.minCellTempC - 25);
const hotFactor = (coeffPct: number | undefined, a: Assumptions) =>
  1 + ((coeffPct ?? DEFAULT_VOC_COEFF_PCT) / 100) * (a.maxCellTempC - 25);

// ------------------------------------------------------------------ the system today

function describeCurrent(sys: ExistingSystem, needs: UpgradeNeeds, a: Assumptions) {
  const findings: Check[] = [];
  const blockers: string[] = [];
  const V = sys.systemVoltage;
  const charger = chargerOf(sys);

  const arrayWp = sys.panels ? sys.panels.count * sys.panels.wp : 0;
  const solarWhPerDay = round2(arrayWp * a.peakSunHours * a.performanceRatio);

  let batteryNominalWh = 0;
  let batteryUsableWh = 0;
  if (sys.batteries && V !== undefined) {
    const b = sys.batteries;
    const series = V / busClass(b.nominalV);
    if (!Number.isInteger(series) || series < 1 || b.count % series !== 0) {
      blockers.push(
        `${b.count} × ${b.nominalV} V batteries cannot make a ${V} V bank. Check the battery voltage, the number of batteries and the system voltage.`
      );
    } else {
      batteryNominalWh = b.count * b.nominalV * b.ah;
      const dod = EXISTING_DOD[b.chemistry] ?? a.defaultDod;
      batteryUsableWh = round2(batteryNominalWh * dod * a.dischargeEfficiency);
      findings.push({
        id: "bank",
        label: "Battery bank",
        state: b.chemistry === "unknown" ? "review" : "pass",
        detail:
          `${series} in series × ${b.count / series} string(s) make a ${V} V bank of ${kwh(batteryNominalWh)} nominal. ` +
          (b.chemistry === "unknown"
            ? `The chemistry is not known, so ${Math.round(dod * 100)}% usable depth was assumed: about ${kwh(batteryUsableWh)} usable.`
            : `At ${Math.round(dod * 100)}% depth of discharge (typical for ${CHEMISTRY_NAME[b.chemistry]}; check the datasheet) about ${kwh(batteryUsableWh)} is usable.`)
      });
    }
  }

  const backupHours =
    needs.backupLoadW !== undefined && batteryUsableWh > 0 ? round1(batteryUsableWh / needs.backupLoadW) : null;
  if (backupHours !== null && needs.backupHours !== undefined) {
    findings.push({
      id: "backup",
      label: "Backup time",
      state: backupHours >= needs.backupHours ? "pass" : "fail",
      detail:
        backupHours >= needs.backupHours
          ? `The bank carries ${needs.backupLoadW} W for about ${backupHours} h, which covers the ${needs.backupHours} h wanted.`
          : `The bank carries ${needs.backupLoadW} W for about ${backupHours} h; ${needs.backupHours} h is wanted.`
    });
  }

  if (sys.panels && needs.dailyKwh !== undefined) {
    const wantWh = needs.dailyKwh * 1000;
    findings.push({
      id: "solar_energy",
      label: "Solar energy",
      state: solarWhPerDay >= wantWh ? "pass" : "fail",
      detail: `${arrayWp} Wp makes about ${kwh(solarWhPerDay)} on a design day (${a.peakSunHours} sun hours, ${Math.round(a.performanceRatio * 100)}% performance); ${needs.dailyKwh} kWh a day is wanted.`
    });
  }

  if (sys.inverter && needs.peakLoadW !== undefined) {
    const required = round2(needs.peakLoadW * a.inverterHeadroom);
    findings.push({
      id: "inverter_load",
      label: "Inverter loading",
      state: sys.inverter.ratedW >= required ? "pass" : "fail",
      detail:
        sys.inverter.ratedW >= required
          ? `${sys.inverter.ratedW} W covers the ${needs.peakLoadW} W peak with ${Math.round((a.inverterHeadroom - 1) * 100)}% headroom.`
          : `${sys.inverter.ratedW} W is below the ${required} W needed for a ${needs.peakLoadW} W peak with ${Math.round((a.inverterHeadroom - 1) * 100)}% headroom.`
    });
  }

  if (sys.panels && !charger) {
    findings.push({
      id: "charger",
      label: "Solar charger",
      state: "review",
      detail: "The system has panels but no charge controller or inverter solar input was described, so the array cannot be checked."
    });
  }

  const limitWp = chargerLimitWp(charger, V);
  if (sys.panels && charger) {
    if (limitWp === null) {
      findings.push({
        id: "charger_power",
        label: "Solar charger capacity",
        state: "review",
        detail: `The ${charger.label}'s maximum solar input power was not given, so room for more panels cannot be validated.`
      });
    } else {
      findings.push({
        id: "charger_power",
        label: "Solar charger capacity",
        state: arrayWp <= limitWp ? "pass" : "fail",
        detail:
          arrayWp <= limitWp
            ? `The ${arrayWp} Wp array is within the ${charger.label}'s ${limitWp} W solar limit.`
            : `The ${arrayWp} Wp array is above the ${charger.label}'s ${limitWp} W solar limit: the ${charger.label} is holding the array back.`
      });
    }
    const p = sys.panels;
    if (charger.maxPvVoltage !== undefined && p.voc !== undefined && p.perString !== undefined) {
      const stringVocCold = round2(p.perString * p.voc * coldFactor(undefined, a));
      findings.push({
        id: "string_voltage",
        label: "String voltage",
        state: stringVocCold <= charger.maxPvVoltage ? "pass" : "fail",
        detail: `${p.perString} panels in series reach about ${stringVocCold} V open-circuit when cold (assuming ${DEFAULT_VOC_COEFF_PCT} %/°C); the ${charger.label} allows ${charger.maxPvVoltage} V.`
      });
    }
    if (charger.technology === "PWM" && V !== undefined && p.vmp !== undefined && p.perString !== undefined) {
      const stringVmp = p.perString * p.vmp;
      if (stringVmp > V * 1.6) {
        findings.push({
          id: "pwm_mismatch",
          label: "PWM controller",
          state: "review",
          detail: `The strings run at about ${round1(stringVmp)} V but a PWM controller pulls them down to the ${V} V bank voltage, so part of the panels' power is lost. An MPPT controller would recover it.`
        });
      }
    }
  }

  return {
    blockers,
    findings,
    charger,
    limitWp,
    current: {
      systemVoltage: V ?? null,
      arrayWp,
      solarWhPerDay,
      batteryNominalWh,
      batteryUsableWh,
      backupHours,
      inverterW: sys.inverter?.ratedW ?? null,
      chargerLimitWp: limitWp
    }
  };
}

// ------------------------------------------------------------------ batteries

function batterySection(
  sys: ExistingSystem,
  needs: UpgradeNeeds,
  a: Assumptions,
  catalogue: CatalogueItem[],
  current: UpgradeReport["current"],
  charger: Charger | null
): UpgradeSection {
  const section: UpgradeSection = { area: "battery", title: "Batteries", requirements: [], messages: [], options: [], rejected: [] };
  const V = sys.systemVoltage;
  if (V === undefined) {
    section.messages.push("This system has no battery bank voltage, so batteries cannot be matched to it.");
    return section;
  }
  const reject = (reason: string) => {
    if (section.rejected.length < MAX_REJECTED && !section.rejected.includes(reason)) section.rejected.push(reason);
  };

  const blocks = [12, 24, 48].filter((v) => v <= V && Number.isInteger(V / v));
  section.requirements.push(
    `Every battery string must make ${V} V` +
      (blocks.length > 0 ? `: ${blocks.map((v) => `${V / v} × ${v} V`).join(", ")} in series.` : ".")
  );
  const chargeA = charger?.maxChargeA ?? sys.inverter?.maxChargeA;
  if (chargeA !== undefined) section.requirements.push(`The existing charger delivers up to ${chargeA} A, so the bank must accept that or the charge limit must be set lower.`);
  if (sys.inverter) {
    section.requirements.push(
      `At full load the ${sys.inverter.ratedW} W inverter draws about ${round1(sys.inverter.ratedW / (V * a.inverterEfficiency))} A from the bank.`
    );
  }

  const wantWh =
    needs.backupHours !== undefined && needs.backupLoadW !== undefined ? needs.backupHours * needs.backupLoadW : null;
  if (wantWh !== null) {
    const shortWh = wantWh - current.batteryUsableWh;
    section.messages.push(
      shortWh > 0
        ? `Running ${needs.backupLoadW} W for ${needs.backupHours} h needs about ${kwh(wantWh)} usable; the bank has about ${kwh(current.batteryUsableWh)}, so about ${kwh(shortWh)} more usable storage is needed.`
        : `Running ${needs.backupLoadW} W for ${needs.backupHours} h needs about ${kwh(wantWh)} usable; the existing bank already covers it.`
    );
  } else {
    section.messages.push("No backup target was given, so each option shows what it adds or how it compares with the existing bank.");
  }

  const existing = sys.batteries;
  if (isFaulty(needs, "battery")) {
    section.messages.push(
      "The existing batteries are reported faulty or no longer holding charge, so the bank should be replaced. New batteries should not be added to a failing bank: the weak ones drag the new ones down and shorten their life."
    );
  }
  const batteries = catalogue.filter((c) => c.categoryKey === "battery");
  if (batteries.length === 0) section.messages.push("There are no active batteries in the catalogue.");

  for (const bat of batteries) {
    const nominalV = num(bat, "nominal_voltage");
    const ah = num(bat, "capacity_ah");
    if (nominalV === undefined || ah === undefined) {
      reject(`${bat.sku} has no nominal voltage or capacity, so it cannot be sized.`);
      continue;
    }
    const series = V / busClass(nominalV);
    if (!Number.isInteger(series) || series < 1) {
      reject(`${bat.sku} (${nominalV} V) cannot make up a ${V} V bank.`);
      continue;
    }
    const family = chemistryFamily(text(bat, "chemistry"));
    const recDod = num(bat, "recommended_dod");
    const dod = recDod !== undefined ? Math.min(1, recDod / 100) : EXISTING_DOD[family] ?? a.defaultDod;
    const stringWh = series * nominalV * ah;
    const usablePerString = stringWh * dod * a.dischargeEfficiency;

    const common: Check[] = [
      { id: "battery_voltage", label: "Bank voltage", state: "pass", detail: `${series} × ${nominalV} V in series make the ${V} V bank.` },
      recDod !== undefined
        ? { id: "battery_dod", label: "Depth of discharge", state: "pass", detail: `Sized to the manufacturer's ${recDod}%.` }
        : { id: "battery_dod", label: "Depth of discharge", state: "review", detail: `${bat.sku} has no recommended depth of discharge; ${Math.round(dod * 100)}% was assumed.` }
    ];
    if (family === "lithium") {
      const bms = bat.specValues["has_bms"];
      common.push(
        bms === true
          ? { id: "battery_bms", label: "Battery management", state: "pass", detail: "Built-in BMS." }
          : { id: "battery_bms", label: "Battery management", state: "review", detail: bms === false ? `${bat.sku} is lithium with no built-in BMS.` : `${bat.sku} is lithium and its BMS is not specified.` }
      );
    }
    const batCharge = num(bat, "max_charge_current");
    const batDischarge = num(bat, "max_discharge_current");

    const figures = (strings: number, totalNominalWh: number, totalUsableWh: number) => {
      const f: Record<string, number> = {
        batteriesInSeries: series,
        strings,
        resultingNominalWh: round2(totalNominalWh),
        resultingUsableWh: round2(totalUsableWh)
      };
      if (needs.backupLoadW !== undefined) f.backupHours = round1(totalUsableWh / needs.backupLoadW);
      const cycles = num(bat, "cycle_life");
      if (cycles !== undefined) f.cycleLife = cycles;
      return f;
    };

    // Adding to the bank: only the same chemistry family can share a bank.
    if (existing && current.batteryNominalWh > 0 && existing.chemistry !== "unknown" && family === existing.chemistry && !isFaulty(needs, "battery")) {
      const shortWh = wantWh === null ? 0 : wantWh - current.batteryUsableWh;
      if (wantWh === null || shortWh > 0) {
        const strings = Math.max(1, Math.ceil(shortWh / usablePerString - 1e-9));
        const checks = [...common];
        if (family === "lead_acid") {
          const old = existing.ageYears !== undefined && existing.ageYears > 1;
          checks.push({
            id: "battery_mixing",
            label: "Mixing old and new",
            state: "review",
            detail: old
              ? `The existing lead-acid bank is about ${existing.ageYears} years old. New lead-acid batteries wired to an aged bank are dragged down to its condition: replacing the whole bank is usually the better choice.`
              : "New lead-acid batteries should only join a bank that is still young and in good health. A technician must test the existing batteries first."
          });
          if (ah !== existing.ah) {
            checks.push({
              id: "battery_capacity_match",
              label: "Capacity match",
              state: "review",
              detail: `${bat.sku} is ${ah} Ah but the existing batteries are ${existing.ah} Ah. Parallel lead-acid strings should be the same capacity.`
            });
          }
        } else {
          checks.push({
            id: "battery_mixing",
            label: "Paralleling with the existing battery",
            state: "review",
            detail: "Lithium batteries should only be paralleled with units the manufacturer approves (normally the same model), with BMS communication set up. A technician must confirm this against the existing battery."
          });
        }
        checks.push({
          id: "battery_discharge",
          label: "Discharge current",
          state: "review",
          detail: "The existing batteries' discharge limit is not known, so the combined bank's current rating must be confirmed."
        });
        const totalNominal = current.batteryNominalWh + strings * stringWh;
        const totalUsable = current.batteryUsableWh + strings * usablePerString;
        section.options.push({
          key: `battery:add:${bat.id}`,
          area: "battery",
          action: "add",
          productId: bat.id,
          quantity: series * strings,
          title: `Add ${series * strings} × ${bat.name}`,
          summary: `Adds ${kwh(strings * stringWh)} nominal (${series} in series × ${strings} string${strings === 1 ? "" : "s"}), taking the bank to about ${kwh(totalUsable)} usable.`,
          figures: figures(strings, totalNominal, totalUsable),
          checks,
          status: statusOf(checks)
        });
      }
    }

    // Replacing the whole bank: sized to the backup target, or to match today's usable energy.
    const targetUsable = wantWh !== null ? Math.max(wantWh, 0) : current.batteryUsableWh;
    const replaceAnyway = needs.goals.includes("swaps") || isFaulty(needs, "battery") || !existing;
    const offerReplace = wantWh !== null ? wantWh > current.batteryUsableWh || replaceAnyway : replaceAnyway;
    if (offerReplace) {
      const strings = Math.max(1, Math.ceil(targetUsable / usablePerString - 1e-9));
      const checks = [...common];
      if (sys.inverter) {
        const neededA = sys.inverter.ratedW / (V * a.inverterEfficiency);
        checks.push(
          batDischarge === undefined
            ? { id: "battery_discharge", label: "Discharge current", state: "review", detail: `${bat.sku} has no maximum discharge current, so this cannot be validated.` }
            : batDischarge * strings >= neededA
              ? { id: "battery_discharge", label: "Discharge current", state: "pass", detail: `${round2(batDischarge * strings)} A available for the ${round2(neededA)} A the inverter can draw.` }
              : { id: "battery_discharge", label: "Discharge current", state: "fail", detail: `${round2(batDischarge * strings)} A available is below the ${round2(neededA)} A the inverter can draw.` }
        );
      }
      if (chargeA === undefined || batCharge === undefined) {
        checks.push({ id: "battery_charge", label: "Charge current", state: "review", detail: "A charge current limit is missing for the existing charger or the battery, so the charge settings cannot be validated." });
      } else if (chargeA > batCharge * strings) {
        checks.push({ id: "battery_charge", label: "Charge current", state: "review", detail: `The existing charger delivers ${chargeA} A but these batteries accept ${batCharge * strings} A: the charge limit must be set lower.` });
      } else {
        checks.push({ id: "battery_charge", label: "Charge current", state: "pass", detail: `The existing charger's ${chargeA} A is within the batteries' ${batCharge * strings} A.` });
      }
      if (family === "lithium" && existing?.chemistry !== "lithium") {
        checks.push({
          id: "battery_profile",
          label: "Charger settings",
          state: "review",
          detail: "The existing inverter and charge controller must support a lithium charging profile. A technician must confirm the settings (and BMS communication where the inverter needs it)."
        });
      }
      const failed = checks.find((c) => c.state === "fail");
      if (failed) {
        reject(`${bat.sku}: ${failed.detail}`);
      } else {
        const totalNominal = strings * stringWh;
        const totalUsable = strings * usablePerString;
        section.options.push({
          key: `battery:replace:${bat.id}`,
          area: "battery",
          action: "replace",
          productId: bat.id,
          quantity: series * strings,
          title: `Replace the bank with ${series * strings} × ${bat.name}`,
          summary:
            `${kwh(totalNominal)} nominal, about ${kwh(totalUsable)} usable (${series} in series × ${strings} string${strings === 1 ? "" : "s"})` +
            (existing && current.batteryUsableWh > 0 ? `, against about ${kwh(current.batteryUsableWh)} usable today.` : "."),
          figures: figures(strings, totalNominal, totalUsable),
          checks,
          status: statusOf(checks)
        });
      }
    }
  }

  if (existing && existing.chemistry === "unknown") {
    section.messages.push("The existing battery chemistry is not known, so only whole-bank replacements are offered. Batteries of different chemistries must never share a bank.");
  }
  return finish(section);
}

// ------------------------------------------------------------------ panels

type PanelPlan = { option: UpgradeOption; addWp: number } | string;

/**
 * Sizes one catalogue panel onto a solar charger: the existing one, or a
 * replacement offered elsewhere in the report (`partner`), in which case the
 * option only holds together with that replacement.
 */
function planPanels(
  sys: ExistingSystem,
  a: Assumptions,
  panel: CatalogueItem,
  charger: Charger,
  limitWp: number | null,
  arrayWp: number,
  gapWp: number | null,
  partner?: { key: string; name: string }
): PanelPlan {
  const V = sys.systemVoltage;
  const wp = num(panel, "rated_power");
  const voc = num(panel, "voc");
  const vmp = num(panel, "vmp");
  const isc = num(panel, "isc");
  if (wp === undefined || wp <= 0 || voc === undefined || vmp === undefined || isc === undefined) {
    return `${panel.sku} is missing its rated power, Voc, Vmp or Isc, so strings cannot be configured.`;
  }
  const minV = charger.minPvVoltage ?? (V !== undefined ? round2(V * CHARGE_VOLTAGE_FACTOR) : undefined);
  const minAssumed = charger.minPvVoltage === undefined;
  if (charger.maxPvVoltage === undefined || minV === undefined) {
    return `Strings cannot be configured until the ${charger.label}'s solar voltage limits are known.`;
  }
  const headroomWp = limitWp === null ? null : Math.max(0, round2(limitWp - arrayWp));
  const coeff = num(panel, "voc_temp_coeff");
  const vocCold = voc * coldFactor(coeff, a);
  const vmpHot = vmp * hotFactor(coeff, a);
  const panelMax = num(panel, "max_system_voltage");
  const sMax = Math.floor(Math.min(charger.maxPvVoltage / vocCold, panelMax !== undefined ? panelMax / vocCold : Infinity));
  const sMin = Math.ceil(minV / vmpHot);
  if (sMax < 1 || sMin > sMax) {
    return `${panel.sku} cannot form a string between ${minV} V and ${charger.maxPvVoltage} V on the ${charger.label}.`;
  }

  // Prefer the string length closest to the existing strings; otherwise the longest allowed.
  const old = sys.panels;
  const oldStringVmp = old?.vmp !== undefined && old.perString !== undefined ? old.vmp * old.perString : undefined;
  let s = sMax;
  if (oldStringVmp !== undefined) {
    let best = Infinity;
    for (let n = sMin; n <= sMax; n++) {
      const diff = Math.abs(n * vmp - oldStringVmp);
      if (diff < best) {
        best = diff;
        s = n;
      }
    }
  }
  const perStringWp = s * wp;
  const wantedWp = gapWp !== null && gapWp > 0 ? gapWp : perStringWp;
  let strings = Math.max(1, Math.ceil(wantedWp / perStringWp - 1e-9));
  if (headroomWp !== null) strings = Math.min(strings, Math.floor(headroomWp / perStringWp + 1e-9));
  if (strings < 1) {
    return `One string of ${s} × ${panel.sku} (${perStringWp} Wp) does not fit in the ${Math.round(headroomWp ?? 0)} Wp of room left on the ${charger.label}.`;
  }
  const addWp = strings * perStringWp;

  const checks: Check[] = [];
  if (coeff === undefined) {
    checks.push({ id: "pv_temp", label: "Temperature coefficient", state: "review", detail: `${panel.sku} has no Voc temperature coefficient; ${DEFAULT_VOC_COEFF_PCT} %/°C was assumed.` });
  }
  checks.push({
    id: "pv_voltage",
    label: "String voltage",
    state: minAssumed ? "review" : "pass",
    detail:
      `${s} per string: ${round2(s * vocCold)} V cold open-circuit (limit ${charger.maxPvVoltage} V), ${round2(s * vmpHot)} V hot at max power (minimum ${minV} V).` +
      (minAssumed ? ` The minimum is the ${V} V bank's charging voltage, not a nameplate figure: confirm the ${charger.label}'s own start-up voltage.` : "")
  });
  if (oldStringVmp !== undefined) {
    const diff = Math.abs(s * vmp - oldStringVmp) / oldStringVmp;
    checks.push(
      diff <= STRING_MATCH_TOLERANCE
        ? { id: "pv_match", label: "Match with existing strings", state: "pass", detail: `New strings run at ${round1(s * vmp)} V against the existing ${round1(oldStringVmp)} V.` }
        : { id: "pv_match", label: "Match with existing strings", state: "review", detail: `New strings run at ${round1(s * vmp)} V but the existing ones at ${round1(oldStringVmp)} V (${Math.round(diff * 100)}% apart). They need their own MPPT input or controller, or the mismatch will cost power.` }
    );
  } else if (old) {
    checks.push({ id: "pv_match", label: "Match with existing strings", state: "review", detail: "The existing panels' Vmp or string size was not given, so the match with new strings cannot be validated." });
  }
  checks.push(
    limitWp === null
      ? { id: "pv_power", label: "Solar input power", state: "review", detail: `The ${charger.label}'s maximum solar power is not known, so ${arrayWp + addWp} Wp cannot be validated against it.` }
      : { id: "pv_power", label: "Solar input power", state: "pass", detail: `${arrayWp + addWp} Wp in total is within the ${limitWp} W limit of the ${charger.label}.` }
  );
  if (charger.maxPvCurrentA !== undefined) {
    const oldStrings = old && old.perString ? old.count / old.perString : undefined;
    const oldIsc = old?.isc;
    if (old && (oldStrings === undefined || oldIsc === undefined)) {
      checks.push({ id: "pv_current", label: "Input current", state: "review", detail: "The existing strings' current is not known, so the total input current cannot be validated." });
    } else {
      const totalA = round2((oldStrings ?? 0) * (oldIsc ?? 0) + strings * isc);
      checks.push(
        totalA <= charger.maxPvCurrentA
          ? { id: "pv_current", label: "Input current", state: "pass", detail: `${totalA} A short-circuit in total is within the ${charger.maxPvCurrentA} A input limit.` }
          : { id: "pv_current", label: "Input current", state: "review", detail: `${totalA} A short-circuit in total exceeds one input's ${charger.maxPvCurrentA} A: the strings must be split across MPPT inputs, which a technician must confirm.` }
      );
    }
  }
  if (charger.technology === "PWM" && V !== undefined && s * vmp > V * 1.6) {
    checks.push({ id: "pv_pwm", label: "PWM controller", state: "review", detail: `These strings run at ${round1(s * vmp)} V, far above the ${V} V bank. A PWM controller wastes the difference; an MPPT controller is needed to use these panels properly.` });
  }

  const short = gapWp !== null && gapWp > 0 ? Math.max(0, round2(gapWp - addWp)) : 0;
  const totalWp = arrayWp + addWp;
  const figures: Record<string, number> = {
    panelsPerString: s,
    strings,
    addWp,
    resultingWp: totalWp,
    solarWhPerDay: round2(totalWp * a.peakSunHours * a.performanceRatio)
  };
  const eff = num(panel, "efficiency");
  if (eff !== undefined) figures.efficiency = eff;
  if (short > 0) figures.shortWp = short;
  const option: UpgradeOption = {
    key: partner ? `panels:add:${panel.id}:with:${partner.key}` : `panels:add:${panel.id}`,
    area: "panels",
    action: "add",
    productId: panel.id,
    quantity: s * strings,
    title: `Add ${s * strings} × ${panel.name}` + (partner ? ` (with ${partner.name})` : ""),
    summary:
      `${strings} string${strings === 1 ? "" : "s"} of ${s} add ${addWp} Wp, taking the array to ${totalWp} Wp (about ${kwh(figures.solarWhPerDay)} on a design day).` +
      (short > 0 ? ` That is all the ${charger.label} has room for: about ${Math.round(short)} Wp of the target is left over.` : ""),
    figures,
    checks,
    status: statusOf(checks)
  };
  if (partner) option.requires = partner.key;
  return { option, addWp };
}

function panelSection(
  sys: ExistingSystem,
  needs: UpgradeNeeds,
  a: Assumptions,
  catalogue: CatalogueItem[],
  current: UpgradeReport["current"],
  charger: Charger | null,
  requiredPvWp: number | null,
  /** A replacement solar charger offered elsewhere in the report, tried when the existing one is too small. */
  partner: { key: string; name: string; charger: Charger; limitWp: number | null } | null
): UpgradeSection {
  const section: UpgradeSection = { area: "panels", title: "Solar panels", requirements: [], messages: [], options: [], rejected: [] };
  const V = sys.systemVoltage;
  const reject = (reason: string) => {
    if (section.rejected.length < MAX_REJECTED && !section.rejected.includes(reason)) section.rejected.push(reason);
  };

  const gapWp = requiredPvWp === null ? null : Math.max(0, round2(requiredPvWp - current.arrayWp));
  if (requiredPvWp !== null) {
    section.messages.push(
      gapWp! > 0
        ? `${needs.dailyKwh} kWh a day needs about ${Math.round(requiredPvWp)} Wp; the array is ${current.arrayWp} Wp, so about ${Math.round(gapWp!)} Wp more is needed.`
        : `${needs.dailyKwh} kWh a day needs about ${Math.round(requiredPvWp)} Wp; the existing ${current.arrayWp} Wp array already covers it.`
    );
  }
  const panels = catalogue.filter((c) => c.categoryKey === "pv_panel");
  if (panels.length === 0) section.messages.push("There are no active solar panels in the catalogue.");

  let coveredWp = 0;
  if (charger) {
    const limitWp = current.chargerLimitWp;
    const headroomWp = limitWp === null ? null : Math.max(0, round2(limitWp - current.arrayWp));
    const minV = charger.minPvVoltage ?? (V !== undefined ? round2(V * CHARGE_VOLTAGE_FACTOR) : undefined);
    if (charger.maxPvVoltage !== undefined) {
      section.requirements.push(`On the existing ${charger.label}, each string must stay under ${charger.maxPvVoltage} V open-circuit on the coldest morning (${a.minCellTempC} °C cells).`);
    } else {
      section.requirements.push(`The ${charger.label}'s maximum solar voltage was not given, so strings cannot be configured on it. Read it off the nameplate.`);
    }
    if (minV !== undefined) {
      section.requirements.push(
        charger.minPvVoltage === undefined
          ? `Each string must stay above about ${minV} V at max power when hot, so it can still charge the ${V} V bank.`
          : `Each string must stay above the ${minV} V MPPT minimum at max power when hot.`
      );
    }
    if (limitWp !== null) {
      section.requirements.push(
        headroomWp! > 0
          ? `The ${charger.label} accepts ${limitWp} W of solar: there is room for about ${Math.round(headroomWp!)} Wp more.`
          : `The ${charger.label} accepts ${limitWp} W of solar and is already full.`
      );
    }
    const old = sys.panels;
    if (old?.vmp !== undefined && old.perString !== undefined) {
      section.requirements.push(`New strings sharing an input with the old ones should run close to their ${round1(old.vmp * old.perString)} V (within ${STRING_MATCH_TOLERANCE * 100}%).`);
    }

    if (headroomWp !== null && headroomWp <= 0) {
      section.messages.push(`The existing ${charger.label} has no room for more panels.`);
    } else {
      for (const panel of panels) {
        const plan = planPanels(sys, a, panel, charger, limitWp, current.arrayWp, gapWp);
        if (typeof plan === "string") reject(plan);
        else {
          section.options.push(plan.option);
          coveredWp = Math.max(coveredWp, plan.addWp);
        }
      }
    }
  } else {
    section.messages.push("No charge controller or inverter solar input was described, so panels have nothing to connect to yet.");
  }

  // When the existing charger cannot take the increase, try the replacement offered elsewhere in the report.
  const wanted = gapWp !== null && gapWp > 0 ? gapWp : 0;
  const stuck = wanted > 0 ? coveredWp < wanted : section.options.length === 0;
  if (stuck && partner) {
    let any = false;
    for (const panel of panels) {
      const plan = planPanels(sys, a, panel, partner.charger, partner.limitWp, current.arrayWp, gapWp, { key: partner.key, name: partner.name });
      if (typeof plan === "string") reject(plan);
      else {
        section.options.push(plan.option);
        any = true;
      }
    }
    if (any) {
      section.messages.push(
        charger
          ? `The existing ${charger.label} cannot take the whole increase. The options marked "with ${partner.name}" move the array to that unit, which has the room.`
          : `The options below connect the panels through ${partner.name}.`
      );
    }
  } else if (stuck && wanted > 0) {
    section.messages.push("The existing solar charger cannot take the whole increase, and no catalogue controller or inverter with a big enough solar input was found.");
  }
  return finish(section);
}

// ------------------------------------------------------------------ charge controller

function controllerSection(
  sys: ExistingSystem,
  a: Assumptions,
  catalogue: CatalogueItem[],
  current: UpgradeReport["current"],
  targetWp: number
): UpgradeSection {
  const section: UpgradeSection = { area: "controller", title: "Charge controller", requirements: [], messages: [], options: [], rejected: [] };
  const V = sys.systemVoltage;
  if (V === undefined) {
    section.messages.push("Without a battery bank voltage a charge controller cannot be matched.");
    return section;
  }
  const reject = (reason: string) => {
    if (section.rejected.length < MAX_REJECTED && !section.rejected.includes(reason)) section.rejected.push(reason);
  };
  const neededA = round2(targetWp / V);
  const old = sys.panels;
  const oldStringVoc = old?.voc !== undefined && old.perString !== undefined ? round2(old.voc * old.perString * coldFactor(undefined, a)) : undefined;

  section.requirements.push(`It must work on a ${V} V bank.`);
  section.requirements.push(`A ${Math.round(targetWp)} Wp array needs about ${neededA} A of charge current at ${V} V.`);
  if (oldStringVoc !== undefined) section.requirements.push(`Its solar input must accept at least ${oldStringVoc} V (the existing strings, cold).`);
  if (sys.controller) {
    section.messages.push(
      sys.controller.maxChargeA >= neededA
        ? `The existing ${sys.controller.technology} controller's ${sys.controller.maxChargeA} A covers a ${Math.round(targetWp)} Wp array.`
        : `The existing ${sys.controller.technology} controller's ${sys.controller.maxChargeA} A is below the ${neededA} A a ${Math.round(targetWp)} Wp array can deliver.`
    );
  }

  const controllers = catalogue.filter((c) => c.categoryKey === "charge_controller");
  if (controllers.length === 0) section.messages.push("There are no active charge controllers in the catalogue.");

  for (const c of controllers) {
    const chargeA = num(c, "max_charge_current");
    if (chargeA === undefined) {
      reject(`${c.sku} has no maximum charge current, so it cannot be sized.`);
      continue;
    }
    if (chargeA < neededA) {
      reject(`${c.sku} (${chargeA} A) is below the ${neededA} A needed.`);
      continue;
    }
    const checks: Check[] = [
      { id: "controller_current", label: "Charge current", state: "pass", detail: `${chargeA} A covers the ${neededA} A needed.` }
    ];
    const batV = num(c, "battery_voltage");
    if (batV === undefined) {
      checks.push({ id: "controller_voltage", label: "Bank voltage", state: "review", detail: `${c.sku} has no supported battery voltage specified.` });
    } else if (batV !== V) {
      reject(`${c.sku} is for a ${batV} V bank, not ${V} V.`);
      continue;
    } else {
      checks.push({ id: "controller_voltage", label: "Bank voltage", state: "pass", detail: `Works on the ${V} V bank.` });
    }
    const maxPower = num(c, "max_pv_power");
    if (maxPower === undefined) {
      checks.push({ id: "controller_power", label: "Solar input power", state: "review", detail: `${c.sku} has no maximum solar power specified.` });
    } else if (maxPower < targetWp) {
      reject(`${c.sku} accepts ${maxPower} W of solar, below the ${Math.round(targetWp)} Wp array.`);
      continue;
    } else {
      checks.push({ id: "controller_power", label: "Solar input power", state: "pass", detail: `${maxPower} W covers the ${Math.round(targetWp)} Wp array.` });
    }
    const maxV = num(c, "max_pv_voltage");
    if (maxV === undefined || oldStringVoc === undefined) {
      checks.push({
        id: "controller_pv_voltage",
        label: "String voltage",
        state: "review",
        detail: maxV === undefined ? `${c.sku} has no maximum solar voltage specified.` : `The existing strings' open-circuit voltage is not known, so the ${maxV} V input cannot be validated against them.`
      });
    } else if (oldStringVoc > maxV) {
      reject(`${c.sku} allows ${maxV} V but the existing strings reach ${oldStringVoc} V when cold.`);
      continue;
    } else {
      checks.push({ id: "controller_pv_voltage", label: "String voltage", state: "pass", detail: `The existing strings' ${oldStringVoc} V (cold) is within the ${maxV} V input.` });
    }
    const tech = text(c, "technology");
    const upgradeFromPwm = sys.controller?.technology === "PWM" && tech === "MPPT";
    section.options.push({
      key: `controller:replace:${c.id}`,
      area: "controller",
      action: sys.controller ? "replace" : "add",
      productId: c.id,
      quantity: 1,
      title: `${sys.controller ? "Replace the controller with" : "Add"} ${c.name}`,
      summary:
        `${tech ?? "Charge"} controller, ${chargeA} A at ${V} V: handles up to about ${Math.round(maxPower ?? chargeA * V)} Wp.` +
        (upgradeFromPwm ? " Moving from PWM to MPPT recovers power the present controller cannot use." : ""),
      figures: { chargeA, handlesWp: round2(maxPower ?? chargeA * V), mppt: tech === "MPPT" ? 1 : 0 },
      checks,
      status: statusOf(checks)
    });
  }
  // Smallest adequate controller first.
  section.options.sort((x, y) => x.figures.chargeA - y.figures.chargeA);
  return finish(section, false);
}

// ------------------------------------------------------------------ inverter

function inverterSection(
  sys: ExistingSystem,
  needs: UpgradeNeeds,
  a: Assumptions,
  catalogue: CatalogueItem[],
  current: UpgradeReport["current"],
  requiredW: number | null
): UpgradeSection {
  const section: UpgradeSection = { area: "inverter", title: "Inverter", requirements: [], messages: [], options: [], rejected: [] };
  const V = sys.systemVoltage;
  const reject = (reason: string) => {
    if (section.rejected.length < MAX_REJECTED && !section.rejected.includes(reason)) section.rejected.push(reason);
  };
  const targetW = requiredW ?? sys.inverter?.ratedW ?? null;
  if (targetW === null) {
    section.messages.push("Give the peak load, or the existing inverter's power, so a replacement can be sized.");
    return section;
  }
  // Panels feed the new inverter directly only when today's inverter does that job and there is no separate controller.
  const pvThroughInverter = Boolean(sys.panels && sys.inverter?.hasSolarInput && !sys.controller);
  const old = sys.panels;
  const oldStringVoc = old?.voc !== undefined && old.perString !== undefined ? round2(old.voc * old.perString * coldFactor(undefined, a)) : undefined;
  const oldStringVmpHot = old?.vmp !== undefined && old.perString !== undefined ? round2(old.vmp * old.perString * hotFactor(undefined, a)) : undefined;

  section.requirements.push(`At least ${Math.round(targetW)} W continuous output.`);
  if (V !== undefined && sys.batteries) section.requirements.push(`A ${V} V battery input, so the existing bank can stay.`);
  if (pvThroughInverter) section.requirements.push(`A solar input for the existing ${current.arrayWp} Wp array${oldStringVoc !== undefined ? ` (strings reach ${oldStringVoc} V cold)` : ""}.`);
  if (sys.controller && sys.panels) section.requirements.push("The existing charge controller keeps charging the bank, so the inverter does not need its own solar input.");

  if (sys.inverter && requiredW !== null) {
    section.messages.push(
      sys.inverter.ratedW >= requiredW
        ? `The existing ${sys.inverter.ratedW} W inverter covers the ${needs.peakLoadW} W peak; a replacement is optional.`
        : `The existing ${sys.inverter.ratedW} W inverter is too small for the ${needs.peakLoadW} W peak: about ${Math.round(requiredW)} W is needed.`
    );
  }

  const inverters = catalogue.filter((c) => c.categoryKey === "inverter");
  if (inverters.length === 0) section.messages.push("There are no active inverters in the catalogue.");

  for (const inv of inverters) {
    const power = num(inv, "rated_output_power");
    if (power === undefined) {
      reject(`${inv.sku} has no continuous output power, so it cannot be sized.`);
      continue;
    }
    if (power < targetW) {
      reject(`${inv.sku} (${power} W) is below the ${Math.round(targetW)} W needed.`);
      continue;
    }
    const checks: Check[] = [
      { id: "inverter_power", label: "Continuous power", state: "pass", detail: `${power} W covers the ${Math.round(targetW)} W needed.` }
    ];
    const topology = text(inv, "topology");
    if (topology === undefined) {
      checks.push({ id: "topology", label: "Inverter type", state: "review", detail: `${inv.sku} has no type specified.` });
    } else if (!TOPOLOGY_OK[sys.systemType].includes(topology)) {
      reject(`${inv.sku} is a ${topology} inverter, which does not suit ${SYSTEM_NAME[sys.systemType]} system.`);
      continue;
    } else {
      checks.push({ id: "topology", label: "Inverter type", state: "pass", detail: `${topology} suits ${SYSTEM_NAME[sys.systemType]} system.` });
    }
    if (V !== undefined && sys.batteries) {
      const bus = num(inv, "battery_voltage");
      if (bus === undefined) {
        checks.push({ id: "inverter_bus", label: "Battery voltage", state: "review", detail: `${inv.sku} has no battery voltage specified.` });
      } else if (bus !== V) {
        reject(`${inv.sku} needs a ${bus} V bank; the existing bank is ${V} V and would have to be rebuilt.`);
        continue;
      } else {
        checks.push({ id: "inverter_bus", label: "Battery voltage", state: "pass", detail: `${bus} V input keeps the existing bank.` });
      }
    }
    if (pvThroughInverter) {
      const maxPvPower = num(inv, "max_pv_input_power");
      if (maxPvPower === undefined) {
        checks.push({ id: "pv_power", label: "Solar input power", state: "review", detail: `${inv.sku} has no maximum solar input power specified.` });
      } else if (maxPvPower < current.arrayWp) {
        reject(`${inv.sku} accepts ${maxPvPower} W of solar, below the existing ${current.arrayWp} Wp array.`);
        continue;
      } else {
        checks.push({ id: "pv_power", label: "Solar input power", state: "pass", detail: `${maxPvPower} W takes the existing ${current.arrayWp} Wp array with room for ${maxPvPower - current.arrayWp} Wp more.` });
      }
      const maxPvV = num(inv, "max_pv_voltage");
      const mpptMin = num(inv, "mppt_min_voltage");
      if (maxPvV === undefined || mpptMin === undefined || oldStringVoc === undefined || oldStringVmpHot === undefined) {
        checks.push({ id: "pv_voltage", label: "String voltage", state: "review", detail: "The existing strings' voltages or this inverter's solar voltage window are not known, so the strings cannot be validated against it." });
      } else if (oldStringVoc > maxPvV) {
        reject(`${inv.sku} allows ${maxPvV} V of solar but the existing strings reach ${oldStringVoc} V when cold.`);
        continue;
      } else if (oldStringVmpHot < mpptMin) {
        checks.push({ id: "pv_voltage", label: "String voltage", state: "review", detail: `The existing strings fall to ${oldStringVmpHot} V when hot, below this inverter's ${mpptMin} V MPPT minimum: the array would need rewiring into longer strings.` });
      } else {
        checks.push({ id: "pv_voltage", label: "String voltage", state: "pass", detail: `The existing strings (${oldStringVmpHot} V hot to ${oldStringVoc} V cold) fit the ${mpptMin}–${maxPvV} V solar input.` });
      }
    }
    if (sys.batteries) {
      checks.push({ id: "battery_discharge", label: "Battery current", state: "review", detail: `At full load this inverter draws about ${V !== undefined ? round1(power / (V * a.inverterEfficiency)) : "?"} A from the bank. A technician must confirm the existing batteries and cables are rated for it.` });
    }
    const phase = text(inv, "phase");
    if (phase !== "Single-phase") {
      checks.push({ id: "phase", label: "Phase", state: "review", detail: phase ? `${phase} output: confirm the site supply and load phases.` : `${inv.sku} has no output phase specified.` });
    }
    const f: Record<string, number> = { ratedW: power };
    const eff = num(inv, "efficiency");
    if (eff !== undefined) f.efficiency = eff;
    const pvIn = num(inv, "max_pv_input_power");
    if (pvIn !== undefined) f.maxPvPowerW = pvIn;
    section.options.push({
      key: `inverter:replace:${inv.id}`,
      area: "inverter",
      action: sys.inverter ? "replace" : "add",
      productId: inv.id,
      quantity: 1,
      title: `${sys.inverter ? "Replace the inverter with" : "Add"} ${inv.name}`,
      summary:
        `${power} W continuous` +
        (sys.inverter ? ` against ${sys.inverter.ratedW} W today` : "") +
        (eff !== undefined ? `, ${eff}% peak efficiency` : "") +
        (pvIn !== undefined ? `, solar input up to ${pvIn} W` : "") +
        ".",
      figures: f,
      checks,
      status: statusOf(checks)
    });
  }
  // Smallest adequate inverter first.
  section.options.sort((x, y) => x.figures.ratedW - y.figures.ratedW);
  return finish(section, false);
}

/** Verified-compatible options first, then those that meet the whole target, then fewest units. Caps the list. */
function finish<T extends UpgradeSection>(section: T, sort = true): T {
  const rank = (o: UpgradeOption) => (o.status === "compatible" ? 0 : 1);
  if (sort) {
    section.options.sort(
      (x, y) =>
        rank(x) - rank(y) ||
        (x.figures.shortWp ?? 0) - (y.figures.shortWp ?? 0) ||
        x.quantity - y.quantity ||
        x.key.localeCompare(y.key)
    );
  } else {
    // Keep the caller's order within each status.
    const order = new Map(section.options.map((o, i) => [o.key, i]));
    section.options.sort((x, y) => rank(x) - rank(y) || order.get(x.key)! - order.get(y.key)!);
  }
  section.options = section.options.slice(0, MAX_OPTIONS);
  return section;
}

// ------------------------------------------------------------------ the study

export function buildUpgradeReport(
  sys: ExistingSystem,
  needs: UpgradeNeeds,
  a: Assumptions,
  catalogue: CatalogueItem[]
): UpgradeReport {
  const problem = validateExisting(sys, needs);
  const empty: UpgradeReport = {
    engineVersion: UPGRADE_ENGINE_VERSION,
    blockers: [],
    current: {
      systemVoltage: sys.systemVoltage ?? null, arrayWp: 0, solarWhPerDay: 0, batteryNominalWh: 0,
      batteryUsableWh: 0, backupHours: null, inverterW: sys.inverter?.ratedW ?? null, chargerLimitWp: null
    },
    required: { pvWp: null, batteryDeliveredWh: null, inverterW: null },
    findings: [],
    sections: []
  };
  if (problem) return { ...empty, blockers: [problem] };

  const now = describeCurrent(sys, needs, a);
  const required = {
    pvWp: needs.dailyKwh === undefined ? null : round2((needs.dailyKwh * 1000) / (a.peakSunHours * a.performanceRatio)),
    batteryDeliveredWh:
      needs.backupHours !== undefined && needs.backupLoadW !== undefined ? round2(needs.backupHours * needs.backupLoadW) : null,
    inverterW: needs.peakLoadW === undefined ? null : round2(needs.peakLoadW * a.inverterHeadroom)
  };
  if (now.blockers.length > 0) {
    return { ...empty, blockers: now.blockers, current: now.current, required, findings: now.findings };
  }

  const goals = new Set(needs.goals);
  const V = sys.systemVoltage;
  const gapWp = required.pvWp === null ? 0 : Math.max(0, required.pvWp - now.current.arrayWp);
  // Wanted panels that the existing solar charger cannot take (or there is no charger at all).
  const headroomWp = now.limitWp === null ? null : Math.max(0, now.limitWp - now.current.arrayWp);
  const pvShort =
    goals.has("panels") && (now.charger === null || (headroomWp !== null && (gapWp > headroomWp || headroomWp <= 0)));

  const battery =
    goals.has("battery") || (goals.has("swaps") && sys.batteries) || isFaulty(needs, "battery")
      ? batterySection(sys, needs, a, catalogue, now.current, now.charger)
      : null;

  // The array runs through a separate controller, or has nothing to run through yet.
  const usesController = sys.controller !== undefined || now.charger === null;
  const controllerFull = now.limitWp !== null && now.current.arrayWp > now.limitWp;
  const controller =
    usesController &&
    V !== undefined &&
    (sys.panels !== undefined || goals.has("panels")) &&
    (controllerFull || pvShort || (sys.controller !== undefined && (goals.has("inverter") || goals.has("swaps") || isFaulty(needs, "controller"))))
      ? controllerSection(sys, a, catalogue, now.current, Math.max(now.current.arrayWp, required.pvWp ?? 0, 1))
      : null;

  const overloaded = sys.inverter !== undefined && required.inverterW !== null && sys.inverter.ratedW < required.inverterW;
  const inverterIsCharger = now.charger?.source === "inverter";
  const inverter =
    goals.has("inverter") || overloaded || (goals.has("swaps") && sys.inverter) || (pvShort && inverterIsCharger) || (sys.inverter && isFaulty(needs, "inverter"))
      ? inverterSection(sys, needs, a, catalogue, now.current, required.inverterW)
      : null;

  let panels: UpgradeSection | null = null;
  if (goals.has("panels")) {
    // The replacement charger to try when the existing one is too small: the first usable controller, or inverter.
    let partner: Parameters<typeof panelSection>[7] = null;
    const from = usesController ? controller : inverterIsCharger ? inverter : null;
    const pick = from?.options.find((o) => o.status !== "incompatible");
    const item = pick ? catalogue.find((c) => c.id === pick.productId) : undefined;
    if (pick && item) {
      const charger: Charger =
        from!.area === "controller"
          ? {
              source: "controller",
              label: item.name,
              technology: text(item, "technology") === "PWM" ? "PWM" : text(item, "technology") === "MPPT" ? "MPPT" : "unknown",
              maxPvPowerW: num(item, "max_pv_power"),
              maxPvVoltage: num(item, "max_pv_voltage"),
              minPvVoltage: num(item, "mppt_min_voltage"),
              maxChargeA: num(item, "max_charge_current")
            }
          : {
              source: "inverter",
              label: item.name,
              technology: "unknown",
              maxPvPowerW: num(item, "max_pv_input_power"),
              maxPvVoltage: num(item, "max_pv_voltage"),
              minPvVoltage: num(item, "mppt_min_voltage"),
              maxPvCurrentA: num(item, "max_pv_current"),
              maxChargeA: num(item, "max_charge_current")
            };
      partner = { key: pick.key, name: item.name, charger, limitWp: chargerLimitWp(charger, V) };
    }
    panels = panelSection(sys, needs, a, catalogue, now.current, now.charger, required.pvWp, partner);
  }

  if (isFaulty(needs, "panels") && sys.panels) {
    const repair = faultyPanelSection(sys.panels, catalogue);
    if (panels) {
      panels.requirements.push(...repair.requirements);
      panels.messages.push(...repair.messages);
      panels.options.push(...repair.options);
    } else {
      panels = repair;
    }
  }
  if (inverter && isFaulty(needs, "inverter")) {
    inverter.messages.unshift("The existing inverter is reported faulty or no longer working well, so these options replace it at the same size or larger.");
  }
  if (controller && isFaulty(needs, "controller")) {
    controller.messages.unshift("The existing charge controller is reported faulty or no longer working well, so these options replace it.");
  }

  const findings = [...now.findings];
  if (goals.has("repair")) {
    const parts = (needs.faultyParts ?? []).map((part) => FAULTY_LABEL[part]).join(", ");
    findings.unshift({
      id: "reported_fault",
      label: "Reported fault",
      state: "review",
      detail: `The owner reports a problem with the ${parts}${needs.faultNote ? `: "${needs.faultNote}"` : "."} A technician should test it on site before anything is replaced.`
    });
  }

  const sections = [battery, panels, inverter, controller].filter((s): s is UpgradeSection => s !== null);

  return {
    engineVersion: UPGRADE_ENGINE_VERSION,
    blockers: [],
    current: now.current,
    required,
    findings,
    sections
  };
}

/**
 * Replacing faulty panels: new panels share strings with the old ones, so they must match
 * them closely in power, voltage and current, or the whole string loses output.
 */
function faultyPanelSection(old: NonNullable<ExistingSystem["panels"]>, catalogue: CatalogueItem[]): UpgradeSection {
  const section: UpgradeSection = { area: "panels", title: "Panels", requirements: [], messages: [], options: [], rejected: [] };
  section.messages.push(
    "Some panels are reported faulty or producing less than they should. A technician should test each panel to find the weak ones; only those need replacing."
  );
  section.requirements.push(`Replacements should be close to the existing ${old.wp} W panels, so the strings stay matched.`);
  if (old.vmp !== undefined) section.requirements.push(`Voltage at maximum power within about 5% of ${old.vmp} V.`);
  if (old.voc !== undefined) section.requirements.push(`Open-circuit voltage within about 5% of ${old.voc} V.`);
  if (old.isc !== undefined) section.requirements.push(`A similar current (about ${old.isc} A): a weaker panel pulls the whole string down.`);
  const close = (mine: number | undefined, theirs: number | undefined) =>
    mine === undefined || theirs === undefined ? null : Math.abs(mine - theirs) / theirs <= STRING_MATCH_TOLERANCE;
  for (const panel of catalogue.filter((c) => c.categoryKey === "pv_panel")) {
    const wp = num(panel, "rated_power");
    if (wp === undefined) continue;
    if (Math.abs(wp - old.wp) / old.wp > 0.15) {
      if (section.rejected.length < MAX_REJECTED) section.rejected.push(`${panel.sku} (${wp} W) is too different from the existing ${old.wp} W panels.`);
      continue;
    }
    const checks: Check[] = [];
    const pairs: [string, string, number | undefined, number | undefined][] = [
      ["panel_vmp", "Voltage at maximum power", num(panel, "vmp"), old.vmp],
      ["panel_voc", "Open-circuit voltage", num(panel, "voc"), old.voc]
    ];
    for (const [id, label, mine, theirs] of pairs) {
      const ok = close(mine, theirs);
      checks.push(
        ok === null
          ? { id, label, state: "review", detail: "Not known for both panels, so a technician must compare them." }
          : ok
            ? { id, label, state: "pass", detail: `${mine} V against the existing ${theirs} V.` }
            : { id, label, state: "fail", detail: `${mine} V is too far from the existing ${theirs} V for the same string.` }
      );
    }
    section.options.push({
      key: `panels:replace:${panel.id}`,
      area: "panels",
      action: "replace",
      productId: panel.id,
      quantity: 1,
      title: `Replace faulty panels with ${panel.name}`,
      summary: `${wp} W each, against the existing ${old.wp} W. Priced per panel; the technician confirms how many have failed.`,
      figures: { wp },
      checks,
      status: statusOf(checks)
    });
  }
  if (section.options.length === 0) section.messages.push("No panel in the catalogue is close enough to the existing ones; a technician will source a match.");
  return finish(section);
}

/** Every option in a report, for looking one up by key. */
export function optionsOf(report: UpgradeReport): UpgradeOption[] {
  return report.sections.flatMap((s) => s.options);
}
