import { itemTypeByKey, type ItemType } from "../../../convex/lib/itemTypes";
import { en } from "../../lib/i18n/en";

export type RequestItem = {
  type: string;
  subtype?: string;
  specs: { key: string; value: string; unit?: string }[];
  description?: string;
  productName?: string;
  quantity: number;
};

type Label = (key: string) => string;

/** English labels, for messages to staff and the staff list. */
export const englishLabel: Label = (key) => (en as Record<string, string>)[key] ?? key;

/** "2 × Battery, Lithium, 12 V, 200 Ah (Lithium battery 12V 200Ah) - prefer Deye". */
export function describeItem(item: RequestItem, label: Label = englishLabel) {
  const type = itemTypeByKey(item.type);
  const unitOf = (key: string, fallback?: string) => fallback ?? type?.specs.find((f) => f.key === key)?.unit ?? "";
  const parts = [
    label(`item.type.${item.type}`),
    item.subtype && item.subtype !== "not_sure" ? label(`item.sub.${item.subtype}`) : "",
    ...item.specs.map((s) => `${s.value} ${unitOf(s.key, s.unit)}`.trim())
  ].filter(Boolean);
  const extra = [item.productName ? `(${item.productName})` : "", item.description ? `- ${item.description}` : ""].filter(Boolean);
  return `${item.quantity} × ${[parts.join(", "), ...extra].join(" ")}`;
}

/**
 * Reads sizes out of a product name so picking "Lithium battery 12V 200Ah" also fills
 * Voltage 12 and Capacity 200.
 */
export function specsFromName(name: string, type: ItemType): Record<string, string> {
  const out: Record<string, string> = {};
  const n = name.replace(/,/g, "");
  const grab = (re: RegExp) => n.match(re)?.[1];
  for (const field of type.specs) {
    let value: string | undefined;
    if (field.unit === "V") value = grab(/(\d+(?:\.\d+)?)\s*V\b/i);
    else if (field.unit === "Ah") value = grab(/(\d+(?:\.\d+)?)\s*Ah\b/i);
    else if (field.unit === "W") value = grab(/(\d+(?:\.\d+)?)\s*W\b/i);
    else if (field.unit === "kW") {
      value = grab(/(\d+(?:\.\d+)?)\s*kW\b/i);
      const watts = grab(/(\d{3,5})\s*W\b/i);
      if (!value && watts) value = String(Number(watts) / 1000);
    } else if (field.unit === "kWh") value = grab(/(\d+(?:\.\d+)?)\s*kWh\b/i);
    else if (field.unit === "A") value = grab(/(\d+(?:\.\d+)?)\s*A\b/);
    else if (field.unit === "mm²") value = grab(/(\d+(?:\.\d+)?)\s*mm/i);
    if (value) out[field.key] = value;
  }
  return out;
}
