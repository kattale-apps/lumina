/**
 * "What can my money buy?": systems from the catalogue matched to a budget.
 *
 * Pure functions. The customer's appliances are sized at a few levels of
 * backup (and, when the budget is short, without their heaviest appliances),
 * each design is priced from today's list prices for the main equipment only
 * (inverter, batteries, panels; installation is not included), and the
 * designs are grouped against the budget. Prices never leave the server: the
 * public result carries parts and plain-language figures only.
 *
 * A battery is always part of the system: it is the storage. Where there is
 * grid power, panels are optional, because the battery can charge from UEDCL.
 */
import type { LoadLine } from "./load";
import { componentsOf, PUBLIC_ASSUMPTIONS, type Component, type GridAvailability, type ProductLabel } from "./estimate";
import { buildCandidates, computeRequirements, type Candidate, type CatalogueItem } from "./sizing";

export type BudgetSystemType = "backup_only" | "hybrid" | "off_grid";
export type BudgetLevel = { systemType: BudgetSystemType; backupHours?: number; autonomyDays?: number };

/** Systems at or above this share of the budget are "best fits"; cheaper ones are "below". */
export const BEST_SHARE = 0.7;
/** "Slightly above your budget" goes up to this multiple of it. */
export const ABOVE_SHARE = 1.25;
/** When the closest fit covers everything and uses less than this share, the budget has room to spare. */
export const SPARE_SHARE = 0.6;
export const PER_GROUP = 3;
/** At most this many of the heaviest appliances are left out to fit a budget. */
export const MAX_LEFT_OUT = 3;

/** The designs tried for a grid situation: always with a battery, panels optional where there is grid power. */
export function budgetLevels(grid: GridAvailability): BudgetLevel[] {
  if (grid === "none") {
    return [
      { systemType: "off_grid", autonomyDays: 0.5 },
      { systemType: "off_grid", autonomyDays: 1 }
    ];
  }
  return [2, 4, 8].flatMap((backupHours) => [
    { systemType: "backup_only" as const, backupHours },
    { systemType: "hybrid" as const, backupHours }
  ]);
}

/** Hours of use the battery is sized to carry. */
export const storageHours = (l: BudgetLevel) => l.backupHours ?? (l.autonomyDays ?? 0) * 24;

const levelCode = (l: BudgetLevel) => `${l.systemType}:${l.backupHours ?? `d${l.autonomyDays}`}`;

/** Line indexes, heaviest first (by watts): the order appliances are left out when money is short. */
export function heaviestFirst(lines: LoadLine[]): number[] {
  return lines
    .map((l, i) => ({ i, w: l.quantity * l.powerW }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.i);
}

export type BudgetSystem = {
  /** Identifies the design so a request can rebuild it on the server. */
  key: string;
  level: BudgetLevel;
  leftOut: number;
  runs: string[];
  leavesOut: string[];
  candidate: Candidate;
  components: Component[];
  /** List price of the main equipment. Server only: never sent to the public. */
  priceMinor: number;
  hasPanels: boolean;
  batteryWh: number;
  arrayWp: number;
  inverterW: number | null;
};

export type BudgetInputs = {
  lines: LoadLine[];
  grid: GridAvailability;
  /** Only products with a list price; the engine never picks an unpriced part. */
  catalogue: CatalogueItem[];
  prices: Map<string, number>;
  labels: Map<string, ProductLabel>;
};

const lineLabel = (l: LoadLine) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name);

function design(inputs: BudgetInputs, order: number[], leftOut: number, level: BudgetLevel): BudgetSystem[] {
  const dropped = new Set(order.slice(0, leftOut));
  const kept = inputs.lines.filter((_, i) => !dropped.has(i));
  if (kept.length === 0) return [];
  const sizing = { systemType: level.systemType, backupHours: level.backupHours, autonomyDays: level.autonomyDays, lines: kept };
  const requirements = computeRequirements(sizing, PUBLIC_ASSUMPTIONS);
  const outcome = buildCandidates(sizing, requirements, PUBLIC_ASSUMPTIONS, inputs.catalogue);
  const runs = kept.map(lineLabel);
  const leavesOut = order.slice(0, leftOut).map((i) => lineLabel(inputs.lines[i]));
  const systems: BudgetSystem[] = [];
  for (const candidate of outcome.candidates) {
    // A battery is always part of the system.
    if (!candidate.batteryId || candidate.counts.batteries === 0) continue;
    const parts: [string | null, number][] = [
      [candidate.inverterId, 1],
      [candidate.batteryId, candidate.counts.batteries],
      [candidate.panelId, candidate.counts.panels]
    ];
    let priceMinor = 0;
    let priced = true;
    for (const [id, quantity] of parts) {
      if (!id || quantity === 0) continue;
      const unit = inputs.prices.get(id);
      if (unit === undefined) priced = false;
      else priceMinor += unit * quantity;
    }
    if (!priced) continue;
    const inverter = inputs.catalogue.find((c) => c.id === candidate.inverterId);
    const invW = inverter?.specValues.rated_output_power;
    systems.push({
      key: [leftOut, levelCode(level), candidate.inverterId, candidate.batteryId, candidate.panelId ?? "-"].join(":"),
      level,
      leftOut,
      runs,
      leavesOut,
      candidate,
      components: componentsOf(candidate, inputs.catalogue, inputs.labels),
      priceMinor,
      hasPanels: candidate.counts.panels > 0,
      batteryWh: candidate.counts.batteryNominalWh,
      arrayWp: candidate.counts.arrayWp,
      inverterW: typeof invW === "number" ? invW : null
    });
  }
  return systems;
}

const maxLeftOut = (lines: LoadLine[]) => Math.min(MAX_LEFT_OUT, Math.max(0, lines.length - 1));

/** Every priced design for the appliances, at each level of backup and with up to three heavy appliances left out. */
export function budgetSystems(inputs: BudgetInputs): BudgetSystem[] {
  const order = heaviestFirst(inputs.lines);
  const systems: BudgetSystem[] = [];
  for (let leftOut = 0; leftOut <= maxLeftOut(inputs.lines); leftOut++) {
    for (const level of budgetLevels(inputs.grid)) systems.push(...design(inputs, order, leftOut, level));
  }
  return systems;
}

/** Rebuilds one design from its key, as the request is sent. Null when it is no longer available. */
export function findBudgetSystem(inputs: BudgetInputs, key: string): BudgetSystem | null {
  const [leftOutText, systemType, levelValue] = key.split(":");
  const leftOut = Number(leftOutText);
  if (!Number.isInteger(leftOut) || leftOut < 0 || leftOut > maxLeftOut(inputs.lines)) return null;
  const level = budgetLevels(inputs.grid).find((l) => levelCode(l) === `${systemType}:${levelValue}`);
  if (!level) return null;
  return design(inputs, heaviestFirst(inputs.lines), leftOut, level).find((s) => s.key === key) ?? null;
}

const hardware = (s: BudgetSystem) =>
  `${s.candidate.inverterId}|${s.candidate.batteryId}x${s.candidate.counts.batteries}|${s.candidate.panelId ?? "-"}x${s.candidate.counts.panels}`;

/** What kind of system it is, as a customer tells them apart. */
const kind = (s: BudgetSystem) => `${levelCode(s.level)}:${s.leftOut}`;

/** Better first: covers more appliances, stores more, has panels, bigger battery. */
function byValue(a: BudgetSystem, b: BudgetSystem) {
  return (
    a.leftOut - b.leftOut ||
    storageHours(b.level) - storageHours(a.level) ||
    Number(b.hasPanels) - Number(a.hasPanels) ||
    b.batteryWh - a.batteryWh ||
    b.arrayWp - a.arrayWp ||
    a.key.localeCompare(b.key)
  );
}

export type BudgetGroups = {
  closest: BudgetSystem | null;
  best: BudgetSystem[];
  below: BudgetSystem[];
  above: BudgetSystem[];
  /** Shown only when nothing fits and nothing is slightly above: the cheapest system there is. */
  smallest: BudgetSystem | null;
  /** The closest fit runs everything and leaves a good part of the budget unused. */
  roomToSpare: boolean;
};

/** Groups designs against the budget: the closest fit, best fits, cheaper ones and ones slightly above. */
export function groupForBudget(systems: BudgetSystem[], budgetMinor: number): BudgetGroups {
  // The same equipment can meet several designs; it is described by the best one it meets.
  const unique = new Map<string, BudgetSystem>();
  for (const s of [...systems].sort(byValue)) if (!unique.has(hardware(s))) unique.set(hardware(s), s);
  const all = [...unique.values()];

  const fits = all.filter((s) => s.priceMinor <= budgetMinor);
  const closest = fits.reduce<BudgetSystem | null>(
    (best, s) => (!best || s.priceMinor > best.priceMinor || (s.priceMinor === best.priceMinor && byValue(s, best) < 0) ? s : best),
    null
  );
  const rest = fits.filter((s) => s !== closest);
  // Each group shows different kinds of system (panels or not, hours of backup, what is left out)
  // before a second one of the same kind: kinds not shown in an earlier group come first.
  const seen = new Set(closest ? [kind(closest)] : []);
  const pick = (ordered: BudgetSystem[]) => {
    const chosen: BudgetSystem[] = [];
    const kinds = new Set<string>();
    for (const fresh of [true, false]) {
      for (const s of ordered) {
        if (chosen.length >= PER_GROUP) break;
        if (chosen.includes(s) || kinds.has(kind(s)) || seen.has(kind(s)) !== !fresh) continue;
        chosen.push(s);
        kinds.add(kind(s));
      }
    }
    kinds.forEach((k) => seen.add(k));
    return chosen;
  };
  const best = pick(rest.filter((s) => s.priceMinor >= budgetMinor * BEST_SHARE).sort(byValue));
  const below = pick(rest.filter((s) => !best.includes(s)).sort((a, b) => b.priceMinor - a.priceMinor || byValue(a, b)));
  const above = pick(
    all
      .filter((s) => s.priceMinor > budgetMinor && s.priceMinor <= budgetMinor * ABOVE_SHARE)
      .sort((a, b) => a.priceMinor - b.priceMinor || byValue(a, b))
  );
  const smallest =
    !closest && above.length === 0
      ? all.reduce<BudgetSystem | null>((min, s) => (!min || s.priceMinor < min.priceMinor ? s : min), null)
      : null;
  return {
    closest,
    best,
    below,
    above,
    smallest,
    roomToSpare: Boolean(closest && closest.leftOut === 0 && closest.priceMinor < budgetMinor * SPARE_SHARE)
  };
}

/** What the public sees of a design: parts and figures, never a price. */
export function publicSystem(s: BudgetSystem) {
  const a = PUBLIC_ASSUMPTIONS;
  const arrayKw = s.arrayWp > 0 ? Math.round(s.arrayWp / 10) / 100 : null;
  return {
    key: s.key,
    systemType: s.level.systemType,
    backupHours: s.level.backupHours ?? null,
    autonomyDays: s.level.autonomyDays ?? null,
    components: s.components.map(({ productId: _id, ...c }) => c),
    batteryKwh: s.batteryWh > 0 ? Math.round(s.batteryWh / 10) / 100 : null,
    arrayKw,
    solarKwhPerDay: arrayKw === null ? null : Math.round(arrayKw * a.peakSunHours * a.performanceRatio * 100) / 100,
    inverterW: s.inverterW,
    runs: s.runs,
    leavesOut: s.leavesOut,
    toConfirm: s.candidate.status !== "compatible"
  };
}
export type PublicBudgetSystem = ReturnType<typeof publicSystem>;
