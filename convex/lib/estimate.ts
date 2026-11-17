/**
 * Self-service power estimate for people who are not staff.
 *
 * It turns either a UEDCL bill or a short appliance list into daily energy and
 * running cost, builds load lines the sizing engine already understands, and
 * shapes a candidate into a customer-safe option. Nothing here reads prices:
 * an option holds components and energy figures only.
 */
import type { LoadLine } from "./load";
import { computeLoad } from "./load";
import type { Assumptions, Candidate, CatalogueItem, SystemType } from "./sizing";
import { DEFAULT_ASSUMPTIONS } from "./sizing";

export const ESTIMATE_ENGINE_VERSION = "estimate-1";
export const DAYS_PER_MONTH = 30;

export const PUBLIC_ASSUMPTIONS: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
  solarResourceSource: "Conservative default for Uganda; a technician confirms the site figure."
};

export type GridAvailability = "none" | "unreliable" | "reliable";

export type Summary = {
  dailyKwh: number;
  // Minor units of the company currency. Null when no tariff or bill amount is known.
  costPerDayMinor: number | null;
  costPerMonthMinor: number | null;
  ratePerKwhMinor: number | null;
  peakW: number;
  basis: "bill" | "appliances";
};

export type ApplianceInput = {
  name: string;
  quantity: number;
  hoursPerDay: number;
  powerW: number;
  surgeW?: number;
  powerFactor?: number;
  currentType: "ac" | "dc";
  /** Share of the on-hours it actually draws power (fridges, freezers). Defaults to 1. */
  duty?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Places `hours` of use in one block ending late evening, spilling into the afternoon if long. */
export function windowsForHours(hours: number): { start: number; end: number }[] {
  const whole = Math.min(24, Math.max(1, Math.ceil(hours)));
  if (whole >= 24) return [{ start: 0, end: 24 }];
  const end = 23;
  return [{ start: Math.max(0, end - whole), end }];
}

/** Appliance lines. Hours below one are kept by scaling power through the duty factor. */
export function linesFromAppliances(items: ApplianceInput[]): LoadLine[] {
  return items.map((item) => {
    const wholeHours = Math.max(1, Math.ceil(item.hoursPerDay));
    const duty = (item.hoursPerDay < 1 ? item.hoursPerDay : item.hoursPerDay / wholeHours) * (item.duty ?? 1);
    const dutyFactor = duty < 1 ? round2(duty) || 0.01 : undefined;
    return {
      name: item.name,
      quantity: item.quantity,
      powerW: item.powerW,
      powerFactor: item.powerFactor,
      surgeW: item.surgeW,
      dutyFactor,
      currentType: item.currentType,
      critical: false,
      windows: windowsForHours(wholeHours)
    };
  });
}

/**
 * Bill-only customers have no appliance list, so the energy is split into an
 * evening block and a spread-out base load. The peak this implies is an
 * assumption, and the options say so.
 */
export function linesFromDailyWh(dailyWh: number): LoadLine[] {
  const eveningWh = dailyWh * 0.6;
  const baseWh = dailyWh - eveningWh;
  return [
    {
      name: "Evening use (estimated from bill)",
      quantity: 1,
      powerW: Math.max(1, round2(eveningWh / 6)),
      powerFactor: 0.9,
      currentType: "ac",
      critical: false,
      windows: [{ start: 17, end: 23 }]
    },
    {
      name: "Rest of day (estimated from bill)",
      quantity: 1,
      powerW: Math.max(1, round2(baseWh / 24)),
      powerFactor: 0.9,
      currentType: "ac",
      critical: false,
      windows: [{ start: 0, end: 24 }]
    }
  ];
}

export type BillInput = { units: number; days: number; amountMinor?: number };

export function summariseBill(bill: BillInput, tariffMinor: number | null): { summary: Summary; lines: LoadLine[] } {
  const dailyKwh = bill.units / bill.days;
  const lines = linesFromDailyWh(dailyKwh * 1000);
  const load = computeLoad(lines);
  // The amount actually paid wins over a company tariff: it is the customer's own rate.
  const rate =
    bill.amountMinor !== undefined && bill.units > 0 ? bill.amountMinor / bill.units : tariffMinor;
  const costPerDay = rate === null ? null : Math.round(rate * dailyKwh);
  return {
    lines,
    summary: {
      dailyKwh: round2(dailyKwh),
      costPerDayMinor: costPerDay,
      costPerMonthMinor: costPerDay === null ? null : costPerDay * DAYS_PER_MONTH,
      ratePerKwhMinor: rate === null ? null : Math.round(rate),
      peakW: Math.round(load.coincidentPeakW),
      basis: "bill"
    }
  };
}

export function summariseAppliances(
  items: ApplianceInput[],
  rateMinor: number | null
): { summary: Summary; lines: LoadLine[] } {
  const lines = linesFromAppliances(items);
  const load = computeLoad(lines);
  const dailyKwh = load.dailyEnergyWh / 1000;
  const costPerDay = rateMinor === null ? null : Math.round(rateMinor * dailyKwh);
  return {
    lines,
    summary: {
      dailyKwh: round2(dailyKwh),
      costPerDayMinor: costPerDay,
      costPerMonthMinor: costPerDay === null ? null : costPerDay * DAYS_PER_MONTH,
      ratePerKwhMinor: rateMinor === null ? null : Math.round(rateMinor),
      peakW: Math.round(load.coincidentPeakW),
      basis: "appliances"
    }
  };
}

export type OptionKey = "bill_saver" | "bill_saver_backup" | "independent";

export type OptionTemplate = {
  key: OptionKey;
  title: string;
  blurb: string;
  systemType: SystemType;
  backupHours?: number;
  autonomyDays?: number;
};

const TEMPLATES: Record<OptionKey, OptionTemplate> = {
  bill_saver: {
    key: "bill_saver",
    title: "Cut my electricity bill",
    blurb: "Solar panels and an inverter that feed your home and reduce what you buy from the grid. No battery, so it stops when the grid is off.",
    systemType: "grid_tied"
  },
  bill_saver_backup: {
    key: "bill_saver_backup",
    title: "Cut my bill and keep the lights on",
    blurb: "Solar plus a battery. It reduces your bill and keeps your home running for about four hours when the grid goes off.",
    systemType: "hybrid",
    backupHours: 4
  },
  independent: {
    key: "independent",
    title: "Run without the grid",
    blurb: "Solar plus a battery sized to carry your full daily use. For homes with no grid, or no wish to rely on it.",
    systemType: "off_grid",
    autonomyDays: 1
  }
};

/** Which options to offer, best fit first, given what the customer says about the grid. */
export function optionsFor(grid: GridAvailability): OptionTemplate[] {
  if (grid === "none") return [TEMPLATES.independent, TEMPLATES.bill_saver_backup];
  if (grid === "unreliable") return [TEMPLATES.bill_saver_backup, TEMPLATES.bill_saver, TEMPLATES.independent];
  return [TEMPLATES.bill_saver, TEMPLATES.bill_saver_backup];
}

export function templateByKey(key: string): OptionTemplate | undefined {
  return (TEMPLATES as Record<string, OptionTemplate | undefined>)[key];
}

export type ProductLabel = { name: string; brand?: string; model?: string };

export type Component = {
  role: "Solar panels" | "Inverter" | "Battery";
  name: string;
  brand?: string;
  model?: string;
  quantity: number;
  // Plain-language size, e.g. "550 W each".
  detail?: string;
  // Some figures for this part were safe estimates, pending technician verification.
  estimated?: boolean;
};

export type PublicOption = {
  key: OptionKey;
  title: string;
  blurb: string;
  // "ready" passed every check; "to_confirm" needs a technician to confirm a detail.
  confidence: "ready" | "to_confirm";
  components: Component[];
  arrayKw: number | null;
  batteryKwh: number | null;
  solarKwhPerDay: number | null;
  // Share of the customer's daily use the panels can cover on a good day, 0 to 100.
  coveragePercent: number | null;
  // Share of the monthly electricity cost the solar could offset. Not a system price.
  offsetPerMonthMinor: number | null;
  notes: string[];
};

const spec = (item: CatalogueItem | undefined, key: string) => {
  const value = item?.specValues[key];
  return typeof value === "number" ? value : undefined;
};

/** Builds the customer-facing option from a candidate. No price field exists on this type. */
export function toPublicOption(
  template: OptionTemplate,
  candidate: Candidate,
  catalogue: CatalogueItem[],
  labels: Map<string, ProductLabel>,
  summary: Summary,
  a: Assumptions
): PublicOption {
  const find = (id: string | null) => catalogue.find((c) => c.id === id);
  const label = (id: string): ProductLabel & { estimated?: boolean } => ({
    ...(labels.get(id) ?? { name: find(id)?.name ?? "Component" }),
    ...(find(id)?.estimated ? { estimated: true } : {})
  });
  const components: Component[] = [];

  if (candidate.panelId && candidate.counts.panels > 0) {
    const wp = spec(find(candidate.panelId), "rated_power");
    components.push({
      role: "Solar panels",
      ...label(candidate.panelId),
      quantity: candidate.counts.panels,
      detail: wp ? `${wp} W each` : undefined
    });
  }
  const inverter = find(candidate.inverterId);
  const invW = spec(inverter, "rated_output_power");
  components.push({
    role: "Inverter",
    ...label(candidate.inverterId),
    quantity: 1,
    detail: invW ? `${invW} W` : undefined
  });
  if (candidate.batteryId && candidate.counts.batteries > 0) {
    const unitWh = candidate.counts.batteryNominalWh / candidate.counts.batteries;
    components.push({
      role: "Battery",
      ...label(candidate.batteryId),
      quantity: candidate.counts.batteries,
      detail: unitWh > 0 ? `${round2(unitWh / 1000)} kWh each` : undefined
    });
  }

  const arrayKw = candidate.counts.arrayWp > 0 ? round2(candidate.counts.arrayWp / 1000) : null;
  const solarKwh = arrayKw === null ? null : round2(arrayKw * a.peakSunHours * a.performanceRatio);
  const coverage =
    solarKwh === null || summary.dailyKwh <= 0 ? null : Math.min(100, Math.round((solarKwh / summary.dailyKwh) * 100));
  const offset =
    coverage === null || summary.costPerMonthMinor === null
      ? null
      : Math.round((summary.costPerMonthMinor * coverage) / 100);
  const notes: string[] = [];
  if (components.some((c) => c.estimated)) {
    notes.push(
      "Some figures for the marked parts were missing from the supplier, so safe estimates were used. A technician will verify them before this is final."
    );
  } else if (candidate.status === "requires_review") {
    notes.push("A technician will confirm a few technical details before this is final.");
  }
  if (summary.basis === "bill") {
    notes.push("Sized from your bill. Your appliances may change the inverter size.");
  }

  return {
    key: template.key,
    title: template.title,
    blurb: template.blurb,
    confidence: candidate.status === "compatible" ? "ready" : "to_confirm",
    components,
    arrayKw,
    batteryKwh: candidate.counts.batteryNominalWh > 0 ? round2(candidate.counts.batteryNominalWh / 1000) : null,
    solarKwhPerDay: solarKwh,
    coveragePercent: coverage,
    offsetPerMonthMinor: offset,
    notes
  };
}
