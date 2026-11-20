import type { Doc } from "../_generated/dataModel";

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

/**
 * The shop's "part" filter. Batteries are split by chemistry because customers shop for lithium
 * and gel batteries as different things. The chemistry spec is used when set; otherwise the
 * product name decides, since this only sorts the catalogue and is never a specification.
 */
export function partType(category: Doc<"productCategories">, product: Doc<"products">) {
  if (category.key !== "battery") return category.name;
  const chemistry = product.specValues.chemistry;
  const text = `${typeof chemistry === "string" ? chemistry : ""} ${product.name} ${product.model}`.toLowerCase();
  if (/lifepo|lithium|li-ion|lfp/.test(text)) return "Lithium batteries";
  if (/\bgel\b/.test(text)) return "Gel batteries";
  if (/\bagm\b/.test(text)) return "AGM batteries";
  if (/flooded|lead[- ]acid|tubular/.test(text)) return "Lead-acid batteries";
  return "Other batteries";
}
