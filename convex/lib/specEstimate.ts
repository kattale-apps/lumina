/**
 * Safe estimates for missing inverter and panel specifications.
 *
 * Supplier price lists rarely give the solar-input figures the sizing engine needs. Rather
 * than leave those products out, a missing figure is replaced by a calculated value chosen
 * so that a design built on it can only be more cautious than the real product allows:
 *
 *   inverter max PV voltage   lowest plausible value   (fewer panels in series, no overvoltage)
 *   inverter MPPT window      narrowest plausible window
 *   inverter PV input current lowest plausible value
 *   inverter MPPT inputs      1
 *   panel Voc and Isc         highest plausible value
 *   panel Vmp                 lowest plausible value
 *
 * Estimates are never stored on the product. They are worked out each time, so a real figure
 * entered later replaces them, and every design that relies on one is marked for technician
 * verification (see `estimateChecks`).
 */
import type { CatalogueItem, Check } from "./sizing";

export const ESTIMATE_LABELS: Record<string, string> = {
  max_pv_voltage: "max PV voltage",
  mppt_min_voltage: "MPPT minimum voltage",
  mppt_max_voltage: "MPPT maximum voltage",
  max_pv_current: "max PV input current",
  mppt_count: "number of MPPT inputs",
  voc: "Voc",
  vmp: "Vmp",
  isc: "Isc"
};

/**
 * Lowest PV voltage limit found on inverters of each battery voltage. Low-voltage MPPT models
 * of each class stop around these figures, so assuming more could overload one of them.
 */
const PV_VOLTAGE_FLOOR: Record<number, number> = { 12: 50, 24: 100, 48: 145 };
/** Highest MPPT starting voltage to assume for each battery voltage when nothing is known. */
const MPPT_MIN_CEILING: Record<number, number> = { 12: 18, 24: 36, 48: 72 };

const num = (item: CatalogueItem, key: string) => {
  const v = item.specValues[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
};
const floor1 = (n: number) => Math.floor(n * 10) / 10;
const ceil1 = (n: number) => Math.ceil(n * 10) / 10;

type Estimate = { values: Record<string, number>; reasons: Record<string, string> };

function estimateInverter(inv: CatalogueItem, peers: CatalogueItem[]): Estimate {
  const values: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  const set = (key: string, value: number, reason: string) => {
    values[key] = value;
    reasons[key] = reason;
  };
  const get = (key: string) => num(inv, key) ?? values[key];
  const bus = num(inv, "battery_voltage");
  // Real figures from other inverters on the same battery voltage, used only in the safe direction.
  const sameBus = peers.filter((p) => p.id !== inv.id && bus !== undefined && num(p, "battery_voltage") === bus);
  const peerMin = (key: string) => {
    const xs = sameBus.map((p) => num(p, key)).filter((x): x is number => x !== undefined);
    return xs.length ? Math.min(...xs) : undefined;
  };
  const peerMax = (key: string) => {
    const xs = sameBus.map((p) => num(p, key)).filter((x): x is number => x !== undefined);
    return xs.length ? Math.max(...xs) : undefined;
  };

  if (get("max_pv_voltage") === undefined) {
    const mpptMax = num(inv, "mppt_max_voltage");
    if (mpptMax !== undefined) {
      set("max_pv_voltage", mpptMax, `taken as the MPPT maximum (${mpptMax} V); the real limit is at least this`);
    } else if (bus !== undefined && PV_VOLTAGE_FLOOR[bus] !== undefined) {
      const floor = Math.min(PV_VOLTAGE_FLOOR[bus], peerMin("max_pv_voltage") ?? Infinity);
      set("max_pv_voltage", floor, `lowest limit found on ${bus} V inverters (${floor} V)`);
    }
  }

  const maxPv = get("max_pv_voltage");
  if (maxPv !== undefined && (num(inv, "mppt_min_voltage") === undefined || num(inv, "mppt_max_voltage") === undefined)) {
    let lo = num(inv, "mppt_min_voltage");
    let hi = num(inv, "mppt_max_voltage");
    if (hi === undefined) hi = floor1(maxPv * 0.8);
    if (lo === undefined) {
      const ceiling = bus !== undefined ? MPPT_MIN_CEILING[bus] : undefined;
      lo = ceil1(Math.max(maxPv * 0.45, ceiling ?? 0, peerMax("mppt_min_voltage") ?? 0));
    }
    if (lo < hi) {
      if (num(inv, "mppt_max_voltage") === undefined) {
        set("mppt_max_voltage", hi, `80% of the max PV voltage (${hi} V)`);
      }
      if (num(inv, "mppt_min_voltage") === undefined) {
        set("mppt_min_voltage", lo, `highest likely starting voltage (${lo} V)`);
      }
    }
  }

  if (num(inv, "mppt_count") === undefined) set("mppt_count", 1, "assumed one MPPT input");

  if (num(inv, "max_pv_current") === undefined) {
    const power = num(inv, "max_pv_input_power");
    const hi = get("mppt_max_voltage");
    const count = get("mppt_count") ?? 1;
    const fromPower = power !== undefined && hi !== undefined ? floor1(power / hi / count) : undefined;
    const fromPeers = peerMin("max_pv_current");
    const current = Math.min(fromPower ?? Infinity, fromPeers ?? Infinity);
    if (Number.isFinite(current) && current > 0) {
      set(
        "max_pv_current",
        current,
        fromPower !== undefined && current === fromPower
          ? `max PV power ÷ MPPT maximum voltage (${current} A)`
          : `lowest found on ${bus} V inverters (${current} A)`
      );
    }
  }
  return { values, reasons };
}

function estimatePanel(panel: CatalogueItem): Estimate {
  const values: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  const wp = num(panel, "rated_power");
  if (wp === undefined) return { values, reasons };
  // Power alone does not give the cell count, so each class covers every common layout for its size.
  const cls =
    wp >= 400
      ? { voc: 54, vmp: 30, isc: 18.6, label: "400 W and larger panels" }
      : wp >= 300
        ? { voc: 50, vmp: 30, isc: 14, label: "300–399 W panels" }
        : { voc: 46, vmp: 16, isc: ceil1((wp / 16) * 1.1), label: "panels under 300 W" };
  const vmp = num(panel, "vmp");
  if (num(panel, "voc") === undefined) {
    values.voc = cls.voc;
    reasons.voc = `highest Voc for ${cls.label} (${cls.voc} V)`;
  }
  if (vmp === undefined) {
    values.vmp = cls.vmp;
    reasons.vmp = `lowest Vmp for ${cls.label} (${cls.vmp} V)`;
  }
  if (num(panel, "isc") === undefined) {
    // With a real Vmp, current follows from power; otherwise the class ceiling is used.
    const isc = vmp !== undefined ? ceil1((wp / vmp) * 1.1) : cls.isc;
    values.isc = isc;
    reasons.isc = vmp !== undefined ? `power ÷ Vmp plus 10% (${isc} A)` : `highest Isc for ${cls.label} (${isc} A)`;
  }
  return { values, reasons };
}

/**
 * Returns the catalogue with missing inverter and panel figures filled by safe estimates.
 * Each changed item lists what was estimated and how in `estimated`.
 */
export function withSafeEstimates(catalogue: CatalogueItem[]): CatalogueItem[] {
  const inverters = catalogue.filter((c) => c.categoryKey === "inverter");
  return catalogue.map((item) => {
    const est =
      item.categoryKey === "inverter"
        ? estimateInverter(item, inverters)
        : item.categoryKey === "pv_panel"
          ? estimatePanel(item)
          : null;
    if (!est || Object.keys(est.values).length === 0) return item;
    return { ...item, specValues: { ...item.specValues, ...est.values }, estimated: est.reasons };
  });
}

/** One review check per product whose figures were estimated, so no such design is final. */
export function estimateChecks(items: (CatalogueItem | null | undefined)[]): Check[] {
  const checks: Check[] = [];
  for (const item of items) {
    if (!item?.estimated) continue;
    const parts = Object.entries(item.estimated).map(([k, why]) => `${ESTIMATE_LABELS[k] ?? k}: ${why}`);
    checks.push({
      id: `estimated_${item.id}`,
      label: "Estimated specifications",
      state: "review",
      detail: `${item.sku} has figures missing from the supplier data. Safe estimates were used, pending verification by a technician: ${parts.join("; ")}.`
    });
  }
  return checks;
}
