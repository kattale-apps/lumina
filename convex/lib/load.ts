/**
 * Deterministic load-profile calculation for assessments.
 *
 * Energy per line follows docs/SOLAR_CALCULATIONS.md:
 *   E_i (Wh/day) = quantity x power (W) x operating hours (h/day) x duty factor
 * Operating hours come from the schedule windows, so hours and schedule can
 * never disagree. The hourly profile has one-hour resolution; demand inside an
 * hour is treated as constant. Results are indicative until technician review.
 */
export const LOAD_ENGINE_VERSION = "load-1";

export type LoadLine = {
  name: string;
  quantity: number;
  powerW: number;
  powerFactor?: number;
  surgeW?: number;
  dutyFactor?: number;
  currentType: "ac" | "dc";
  critical: boolean;
  windows: { start: number; end: number }[];
};

export type LoadResults = {
  engineVersion: string;
  // Sum of quantity x power for every line, whether or not they run together.
  connectedLoadW: number;
  dailyEnergyWh: number;
  acEnergyWh: number;
  dcEnergyWh: number;
  criticalEnergyWh: number;
  // Running demand per hour of day, 24 entries.
  hourlyDemandW: number[];
  hourlyCriticalW: number[];
  // Highest hourly running demand (coincident maximum demand).
  coincidentPeakW: number;
  // Peak running demand plus the largest single start-up excess among lines running that hour.
  peakWithSurgeW: number;
  peakApparentVA: number | null;
  daytimeEnergyWh: number;
  nighttimeEnergyWh: number;
  warnings: string[];
};

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** Total scheduled hours; overlapping windows are rejected before this is called. */
export function scheduledHours(windows: { start: number; end: number }[]) {
  return windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

/** Returns a message for the first problem found in a line, or null when it is valid. */
export function validateLine(line: LoadLine): string | null {
  const label = line.name || "Appliance";
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) {
    return `${label}: quantity must be a whole number from 1 to 10000.`;
  }
  if (!Number.isFinite(line.powerW) || line.powerW <= 0 || line.powerW > 10_000_000) {
    return `${label}: power must be greater than 0 W.`;
  }
  if (line.powerFactor !== undefined && !(line.powerFactor > 0 && line.powerFactor <= 1)) {
    return `${label}: power factor must be above 0 and at most 1.`;
  }
  if (line.surgeW !== undefined && !(Number.isFinite(line.surgeW) && line.surgeW >= line.powerW)) {
    return `${label}: starting power cannot be below running power.`;
  }
  if (line.dutyFactor !== undefined && !(line.dutyFactor > 0 && line.dutyFactor <= 1)) {
    return `${label}: duty factor must be above 0 and at most 1.`;
  }
  if (line.windows.length === 0) return `${label}: add at least one operating window.`;
  const sorted = [...line.windows].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start) {
      return `${label}: each window needs whole hours with 0 <= start < end <= 24.`;
    }
    if (i > 0 && start < sorted[i - 1].end) return `${label}: operating windows overlap.`;
  }
  return null;
}

export function computeLoad(lines: LoadLine[]): LoadResults {
  const hourly = new Array<number>(24).fill(0);
  const hourlyCritical = new Array<number>(24).fill(0);
  const hourlyApparent = new Array<number>(24).fill(0);
  const hourlySurgeExcess = new Array<number>(24).fill(0);
  let connected = 0;
  let acWh = 0;
  let dcWh = 0;
  let criticalWh = 0;
  let day = 0;
  let night = 0;
  const warnings: string[] = [];
  let missingPf = false;

  for (const line of lines) {
    const duty = line.dutyFactor ?? 1;
    const runningW = line.quantity * line.powerW * duty;
    connected += line.quantity * line.powerW;
    if (line.currentType === "ac" && line.powerFactor === undefined) missingPf = true;
    const apparentW = line.currentType === "ac" ? runningW / (line.powerFactor ?? 1) : runningW;
    // Only one unit of a line is assumed to start at a time.
    const excess = Math.max(0, (line.surgeW ?? line.powerW) - line.powerW);

    for (const { start, end } of line.windows) {
      for (let h = start; h < end; h++) {
        hourly[h] += runningW;
        hourlyApparent[h] += apparentW;
        if (line.critical) hourlyCritical[h] += runningW;
        hourlySurgeExcess[h] = Math.max(hourlySurgeExcess[h], excess);
        if (line.currentType === "ac") acWh += runningW;
        else dcWh += runningW;
        if (line.critical) criticalWh += runningW;
        if (h >= DAY_START_HOUR && h < DAY_END_HOUR) day += runningW;
        else night += runningW;
      }
    }
  }

  let peak = 0;
  let peakWithSurge = 0;
  let peakVA = 0;
  for (let h = 0; h < 24; h++) {
    peak = Math.max(peak, hourly[h]);
    peakWithSurge = Math.max(peakWithSurge, hourly[h] + hourlySurgeExcess[h]);
    peakVA = Math.max(peakVA, hourlyApparent[h]);
  }

  if (missingPf) {
    warnings.push("Some AC loads have no power factor; apparent power assumes a power factor of 1.");
  }
  if (lines.some((l) => l.surgeW === undefined && l.currentType === "ac")) {
    warnings.push("Starting power is missing for some AC loads; motors and compressors need it.");
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    engineVersion: LOAD_ENGINE_VERSION,
    connectedLoadW: round(connected),
    dailyEnergyWh: round(acWh + dcWh),
    acEnergyWh: round(acWh),
    dcEnergyWh: round(dcWh),
    criticalEnergyWh: round(criticalWh),
    hourlyDemandW: hourly.map(round),
    hourlyCriticalW: hourlyCritical.map(round),
    coincidentPeakW: round(peak),
    peakWithSurgeW: round(peakWithSurge),
    peakApparentVA: lines.length ? round(peakVA) : null,
    daytimeEnergyWh: round(day),
    nighttimeEnergyWh: round(night),
    warnings
  };
}
