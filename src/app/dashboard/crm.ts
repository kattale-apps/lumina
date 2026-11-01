export const CUSTOMER_TYPES = [
  "residential",
  "commercial",
  "institutional",
  "agricultural",
  "industrial"
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const GRID_LABELS = {
  none: "No grid connection",
  unreliable: "Grid available but unreliable",
  reliable: "Reliable grid"
} as const;
export type GridAvailability = keyof typeof GRID_LABELS;

export const SYSTEM_LABELS = {
  off_grid: "Off-grid",
  hybrid: "Hybrid (grid + battery)",
  grid_tied: "Grid-tied",
  backup_only: "Backup only"
} as const;
export type SystemType = keyof typeof SYSTEM_LABELS;

export const SOURCE_LABELS = {
  nameplate: "Nameplate",
  measured: "Measured",
  estimate: "Estimate"
} as const;

/** "6-8, 18-22" to windows. Returns an error message instead when the text is not valid. */
export function parseSchedule(text: string): { start: number; end: number }[] | string {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "Enter hours of use, e.g. 18-23.";
  const windows: { start: number; end: number }[] = [];
  for (const part of parts) {
    const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(part);
    if (!match) return `"${part}" is not a window like 18-23.`;
    windows.push({ start: Number(match[1]), end: Number(match[2]) });
  }
  return windows;
}

export function formatSchedule(windows: { start: number; end: number }[]) {
  return windows.map((w) => `${w.start}-${w.end}`).join(", ");
}

export function formatEnergy(wh: number) {
  return wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${wh} Wh`;
}
