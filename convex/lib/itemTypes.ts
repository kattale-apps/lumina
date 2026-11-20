/**
 * What a member of the public can ask for on the "Request an item" page, and the specifications
 * offered as buttons for each (anything else can be typed). Labels live in the translations under
 * item.type.<key>, item.sub.<key> and item.spec.<key>.
 */
export type SpecField = {
  key: string;
  unit: string;
  /** Common values offered as buttons. */
  options: string[];
};

export type ItemType = {
  key: string;
  emoji: string;
  /** Catalogue categories this matches, to suggest products we sell. */
  categoryKeys: string[];
  subtypes: string[];
  specs: SpecField[];
};

export const ITEM_TYPES: ItemType[] = [
  {
    key: "battery", emoji: "🔋", categoryKeys: ["battery"],
    subtypes: ["lithium", "gel", "agm", "lead_acid", "not_sure"],
    specs: [
      { key: "voltage", unit: "V", options: ["12", "24", "48", "51.2"] },
      { key: "capacity", unit: "Ah", options: ["50", "100", "150", "200", "250", "300"] }
    ]
  },
  {
    key: "panel", emoji: "☀️", categoryKeys: ["pv_panel"], subtypes: [],
    specs: [{ key: "power", unit: "W", options: ["100", "150", "200", "300", "450", "550", "600"] }]
  },
  {
    key: "inverter", emoji: "⚡", categoryKeys: ["inverter"],
    subtypes: ["hybrid", "offgrid", "gridtied", "not_sure"],
    specs: [
      { key: "power", unit: "kW", options: ["1", "1.5", "3", "3.5", "5", "6", "8", "10", "12"] },
      { key: "voltage", unit: "V", options: ["12", "24", "48"] }
    ]
  },
  {
    key: "controller", emoji: "🎛️", categoryKeys: ["charge_controller"],
    subtypes: ["mppt", "pwm", "not_sure"],
    specs: [
      { key: "current", unit: "A", options: ["20", "30", "40", "60", "80", "100"] },
      { key: "voltage", unit: "V", options: ["12", "24", "48"] }
    ]
  },
  {
    key: "power_station", emoji: "🔌", categoryKeys: ["portable_power"], subtypes: [],
    specs: [
      { key: "power", unit: "W", options: ["300", "500", "1000", "2000", "3000", "5000"] },
      { key: "energy", unit: "kWh", options: ["0.5", "1", "2", "3", "5", "10"] }
    ]
  },
  {
    key: "lighting", emoji: "💡", categoryKeys: ["solar_lighting"],
    subtypes: ["street", "flood", "garden", "not_sure"],
    specs: [{ key: "power", unit: "W", options: ["50", "100", "200", "300", "500", "1000"] }]
  },
  {
    key: "cable", emoji: "🧵", categoryKeys: ["cable"],
    subtypes: ["dc_solar", "battery_cable", "ac"],
    specs: [
      { key: "size", unit: "mm²", options: ["2.5", "4", "6", "10", "16", "25", "35"] },
      { key: "length", unit: "m", options: ["10", "20", "50", "100"] }
    ]
  },
  {
    key: "protection", emoji: "🛡️", categoryKeys: ["protection"],
    subtypes: ["dc_breaker", "ac_breaker", "surge", "fuse", "isolator", "combiner"],
    specs: [{ key: "rating", unit: "A", options: ["16", "32", "63", "100", "125"] }]
  },
  {
    key: "charger", emoji: "🔁", categoryKeys: ["battery_charger"], subtypes: [],
    specs: [
      { key: "voltage", unit: "V", options: ["12", "24", "48"] },
      { key: "current", unit: "A", options: ["5", "10", "20", "30", "50"] }
    ]
  },
  { key: "other", emoji: "📦", categoryKeys: ["mounting", "accessory", "solar_appliance"], subtypes: [], specs: [] }
];

export const itemTypeByKey = (key: string) => ITEM_TYPES.find((t) => t.key === key);

/** Battery sub-types as the shop names them, to narrow suggestions to e.g. lithium batteries. */
export const BATTERY_PART: Record<string, string> = {
  lithium: "Lithium batteries",
  gel: "Gel batteries",
  agm: "AGM batteries",
  lead_acid: "Lead-acid batteries"
};

/** A spec value as typed, tidied: "200 ah" -> "200". Units are added from the field. */
export function cleanSpecValue(raw: string) {
  return raw.trim().replace(/\s*(v|ah|w|kw|kwh|a|mm²|mm2|m)\.?$/i, "").trim().slice(0, 20);
}
