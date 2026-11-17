/** The order the shop's part filters are offered in: what people look for first. */
export const PART_ORDER = [
  "Solar panels", "Inverters", "Lithium batteries", "Gel batteries", "AGM batteries", "Lead-acid batteries",
  "Other batteries", "Charge controllers", "Portable power stations", "Solar lighting"
];

/** Sorts part names by PART_ORDER, then any others alphabetically. */
export function byPartOrder(a: string, b: string) {
  const ia = PART_ORDER.indexOf(a);
  const ib = PART_ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
}
