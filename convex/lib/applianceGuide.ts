/**
 * Appliance guide for the public power check: the names people search for,
 * common sizes and a typical running power for each size.
 *
 * Figures are typical values for appliances sold in Uganda, for a first
 * estimate only. Customers are asked to replace them with the watts on the
 * appliance label, and a technician checks every design.
 *
 * Shared by the browser (suggestions and prefill) and the server (starting
 * power, power factor and duty when a customer does not type a figure).
 */

export type GuideSize = { label: string; powerW: number };

export type GuideAppliance = {
  key: string;
  /** Shown next to the name so people can find appliances at a glance. */
  emoji: string;
  name: string;
  category: string;
  /** Extra words people type, lower case. */
  aliases: string[];
  /** What "size" means for this appliance, e.g. "Screen size". Omitted when there is only one size. */
  sizeLabel?: string;
  sizes: GuideSize[];
  defaultSize: number;
  defaultHours: number;
  defaultQuantity?: number;
  /** Starting power as a multiple of running power, for motors and compressors. */
  surgeRatio?: number;
  powerFactor: number;
  /** Share of the "on" hours the appliance actually draws power, for thermostat-driven loads. */
  duty?: number;
  dutyNote?: string;
  /** Shown first as quick picks. */
  popular?: boolean;
};

const one = (powerW: number): GuideSize[] => [{ label: "Standard", powerW }];

export const APPLIANCE_GUIDE: GuideAppliance[] = [
  // Lighting
  { key: "led_bulb", emoji: "💡", name: "LED bulb", category: "Lighting", aliases: ["light", "lights", "bulb", "lamp", "led"], sizeLabel: "Brightness",
    sizes: [{ label: "Small (5 W)", powerW: 5 }, { label: "Standard (9 W)", powerW: 9 }, { label: "Bright (15 W)", powerW: 15 }],
    defaultSize: 1, defaultHours: 6, defaultQuantity: 6, powerFactor: 0.9, popular: true },
  { key: "tube_light", emoji: "💡", name: "Tube light", category: "Lighting", aliases: ["tube", "fluorescent", "strip light"], sizeLabel: "Length",
    sizes: [{ label: "2 ft LED (9 W)", powerW: 9 }, { label: "4 ft LED (18 W)", powerW: 18 }, { label: "4 ft fluorescent (36 W)", powerW: 40 }],
    defaultSize: 1, defaultHours: 6, defaultQuantity: 4, powerFactor: 0.9 },
  { key: "floodlight", emoji: "🔦", name: "Security floodlight", category: "Lighting", aliases: ["security light", "flood", "outside light", "compound light"], sizeLabel: "Power",
    sizes: [{ label: "20 W", powerW: 20 }, { label: "30 W", powerW: 30 }, { label: "50 W", powerW: 50 }, { label: "100 W", powerW: 100 }],
    defaultSize: 1, defaultHours: 12, defaultQuantity: 2, powerFactor: 0.9 },

  // Entertainment
  { key: "tv", emoji: "📺", name: "Television", category: "Entertainment", aliases: ["tv", "telly", "smart tv", "screen", "led tv"], sizeLabel: "Screen size",
    sizes: [{ label: "24 in", powerW: 30 }, { label: "32 in", powerW: 50 }, { label: "43 in", powerW: 75 }, { label: "50 in", powerW: 100 }, { label: "55 in", powerW: 120 }, { label: "65 in", powerW: 160 }],
    defaultSize: 1, defaultHours: 5, powerFactor: 0.8, popular: true },
  { key: "decoder", emoji: "📡", name: "Decoder / set-top box", category: "Entertainment", aliases: ["dstv", "gotv", "startimes", "zuku", "decoder", "satellite"],
    sizes: one(15), defaultSize: 0, defaultHours: 5, powerFactor: 0.7 },
  { key: "sound", emoji: "🔊", name: "Sound system", category: "Entertainment", aliases: ["radio", "speaker", "music", "home theatre", "amplifier"], sizeLabel: "Size",
    sizes: [{ label: "Radio / small speaker", powerW: 20 }, { label: "Home theatre", powerW: 100 }, { label: "Large speakers / PA", powerW: 300 }],
    defaultSize: 0, defaultHours: 4, powerFactor: 0.8 },

  // Electronics
  { key: "phone_charger", emoji: "📱", name: "Phone charger", category: "Electronics", aliases: ["phone", "charger", "mobile"],
    sizes: one(10), defaultSize: 0, defaultHours: 3, defaultQuantity: 2, powerFactor: 0.6, popular: true },
  { key: "laptop", emoji: "💻", name: "Laptop", category: "Electronics", aliases: ["computer", "notebook", "macbook"], sizeLabel: "Type",
    sizes: [{ label: "Small / office", powerW: 45 }, { label: "Standard", powerW: 65 }, { label: "Gaming / design", powerW: 150 }],
    defaultSize: 1, defaultHours: 6, powerFactor: 0.6, popular: true },
  { key: "desktop", emoji: "🖥️", name: "Desktop computer with monitor", category: "Electronics", aliases: ["computer", "pc", "desktop", "monitor"], sizeLabel: "Type",
    sizes: [{ label: "Office", powerW: 150 }, { label: "Gaming / design", powerW: 400 }],
    defaultSize: 0, defaultHours: 8, powerFactor: 0.65 },
  { key: "router", emoji: "📶", name: "Wi-Fi router", category: "Electronics", aliases: ["wifi", "internet", "modem", "mifi"],
    sizes: one(12), defaultSize: 0, defaultHours: 24, powerFactor: 0.6 },
  { key: "printer", emoji: "🖨️", name: "Printer", category: "Electronics", aliases: ["print"], sizeLabel: "Type",
    sizes: [{ label: "Inkjet", powerW: 30 }, { label: "Laser", powerW: 400 }],
    defaultSize: 0, defaultHours: 1, powerFactor: 0.9 },
  { key: "photocopier", emoji: "🖨️", name: "Photocopier", category: "Electronics", aliases: ["copier", "photocopy"],
    sizes: one(800), defaultSize: 0, defaultHours: 3, powerFactor: 0.9 },
  { key: "cctv", emoji: "📹", name: "CCTV cameras", category: "Electronics", aliases: ["camera", "security camera", "dvr", "nvr"], sizeLabel: "System",
    sizes: [{ label: "4 cameras", powerW: 40 }, { label: "8 cameras", powerW: 80 }, { label: "16 cameras", powerW: 160 }],
    defaultSize: 0, defaultHours: 24, powerFactor: 0.8 },
  { key: "pos", emoji: "🧾", name: "Till / POS machine", category: "Electronics", aliases: ["till", "pos", "cash register", "card machine"],
    sizes: one(30), defaultSize: 0, defaultHours: 10, powerFactor: 0.7 },

  // Cooling
  { key: "fan", emoji: "🌀", name: "Fan", category: "Cooling", aliases: ["ceiling fan", "standing fan", "table fan"], sizeLabel: "Type",
    sizes: [{ label: "Table fan", powerW: 40 }, { label: "Standing fan", powerW: 55 }, { label: "Ceiling fan", powerW: 75 }],
    defaultSize: 1, defaultHours: 8, surgeRatio: 2, powerFactor: 0.85, popular: true },
  { key: "ac", emoji: "❄️", name: "Air conditioner", category: "Cooling", aliases: ["ac", "aircon", "air con", "split"], sizeLabel: "Size",
    sizes: [{ label: "1 hp (9,000 BTU)", powerW: 800 }, { label: "1.5 hp (12,000 BTU)", powerW: 1100 }, { label: "2 hp (18,000 BTU)", powerW: 1600 }, { label: "2.5 hp (24,000 BTU)", powerW: 2200 }],
    defaultSize: 0, defaultHours: 6, surgeRatio: 3, powerFactor: 0.85, duty: 0.7,
    dutyNote: "Cycles on and off, so we count about 70% of the time." },

  // Refrigeration
  { key: "fridge", emoji: "🧊", name: "Fridge", category: "Refrigeration", aliases: ["refrigerator", "fridge", "frige"], sizeLabel: "Size",
    sizes: [{ label: "Small (under 150 L)", powerW: 80 }, { label: "Medium (150–300 L)", powerW: 150 }, { label: "Large (300–450 L)", powerW: 200 }, { label: "Double door / side-by-side", powerW: 300 }],
    defaultSize: 1, defaultHours: 24, surgeRatio: 5, powerFactor: 0.7, duty: 0.4,
    dutyNote: "A fridge switches on and off by itself, so we count about 40% of the time.", popular: true },
  { key: "freezer", emoji: "🧊", name: "Chest freezer", category: "Refrigeration", aliases: ["freezer", "deep freezer"], sizeLabel: "Size",
    sizes: [{ label: "Small (100–200 L)", powerW: 120 }, { label: "Medium (200–300 L)", powerW: 180 }, { label: "Large (over 300 L)", powerW: 250 }],
    defaultSize: 1, defaultHours: 24, surgeRatio: 4.5, powerFactor: 0.7, duty: 0.45,
    dutyNote: "A freezer switches on and off by itself, so we count about 45% of the time." },
  { key: "display_fridge", emoji: "🥤", name: "Display fridge / drinks cooler", category: "Refrigeration", aliases: ["display", "cooler", "soda fridge", "beverage", "drinks"], sizeLabel: "Size",
    sizes: [{ label: "Single door", powerW: 250 }, { label: "Double door", powerW: 400 }],
    defaultSize: 0, defaultHours: 24, surgeRatio: 4, powerFactor: 0.7, duty: 0.55,
    dutyNote: "Switches on and off by itself, so we count about 55% of the time." },

  // Kitchen
  { key: "kettle", emoji: "🫖", name: "Electric kettle", category: "Kitchen", aliases: ["kettle", "water boiler"], sizeLabel: "Size",
    sizes: [{ label: "Small (1 L)", powerW: 1500 }, { label: "Standard (1.7 L)", powerW: 2200 }],
    defaultSize: 1, defaultHours: 0.5, powerFactor: 1 },
  { key: "microwave", emoji: "🍲", name: "Microwave oven", category: "Kitchen", aliases: ["microwave"], sizeLabel: "Size",
    sizes: [{ label: "Small (20 L)", powerW: 800 }, { label: "Medium (25 L)", powerW: 1000 }, { label: "Large (30 L+)", powerW: 1200 }],
    defaultSize: 1, defaultHours: 0.5, powerFactor: 0.95 },
  { key: "cooker", emoji: "🍳", name: "Electric cooker / hot plate", category: "Kitchen", aliases: ["cooker", "hot plate", "hotplate", "stove", "oven"], sizeLabel: "Type",
    sizes: [{ label: "Single hot plate", powerW: 1500 }, { label: "Double hot plate", powerW: 2500 }, { label: "Full cooker with oven", powerW: 6000 }],
    defaultSize: 0, defaultHours: 1.5, powerFactor: 1 },
  { key: "pressure_cooker", emoji: "🍲", name: "Electric pressure cooker", category: "Kitchen", aliases: ["pressure cooker", "instant pot", "epc"],
    sizes: one(1000), defaultSize: 0, defaultHours: 1, powerFactor: 1, duty: 0.6,
    dutyNote: "Heats in bursts once at pressure, so we count about 60% of the time." },
  { key: "rice_cooker", emoji: "🍚", name: "Rice cooker", category: "Kitchen", aliases: ["rice"], sizes: one(700), defaultSize: 0, defaultHours: 0.5, powerFactor: 1 },
  { key: "blender", emoji: "🥤", name: "Blender", category: "Kitchen", aliases: ["juicer", "mixer", "blend"], sizes: one(400), defaultSize: 0, defaultHours: 0.25, surgeRatio: 2, powerFactor: 0.85 },
  { key: "toaster", emoji: "🍞", name: "Toaster", category: "Kitchen", aliases: ["toast"], sizes: one(900), defaultSize: 0, defaultHours: 0.25, powerFactor: 1 },

  // Laundry and personal
  { key: "iron", emoji: "👔", name: "Electric iron", category: "Laundry", aliases: ["iron", "flat iron", "steam iron"], sizeLabel: "Type",
    sizes: [{ label: "Dry iron", powerW: 1000 }, { label: "Steam iron", powerW: 2000 }],
    defaultSize: 0, defaultHours: 0.5, powerFactor: 1, popular: true },
  { key: "washing_machine", emoji: "🧺", name: "Washing machine", category: "Laundry", aliases: ["washer", "washing"], sizeLabel: "Load size",
    sizes: [{ label: "Small (6 kg)", powerW: 400 }, { label: "Medium (8 kg)", powerW: 500 }, { label: "Large (10 kg+)", powerW: 700 }],
    defaultSize: 1, defaultHours: 1, surgeRatio: 3, powerFactor: 0.7 },
  { key: "water_heater", emoji: "🚿", name: "Water heater", category: "Laundry", aliases: ["geyser", "boiler", "shower", "heater", "hot water"], sizeLabel: "Type",
    sizes: [{ label: "Instant shower heater", powerW: 3500 }, { label: "Tank 50 L", powerW: 2000 }, { label: "Tank 100 L", powerW: 3000 }],
    defaultSize: 1, defaultHours: 1.5, powerFactor: 1 },
  { key: "hair_dryer", emoji: "💇", name: "Hair dryer", category: "Laundry", aliases: ["dryer", "blow dryer", "salon"], sizeLabel: "Type",
    sizes: [{ label: "Hand-held", powerW: 1200 }, { label: "Salon hood dryer", powerW: 1000 }],
    defaultSize: 0, defaultHours: 0.5, powerFactor: 1 },
  { key: "clipper", emoji: "💈", name: "Hair clipper", category: "Laundry", aliases: ["shaver", "clipper", "barber", "salon"],
    sizes: one(15), defaultSize: 0, defaultHours: 4, powerFactor: 0.8 },
  { key: "sewing", emoji: "🧵", name: "Sewing machine", category: "Laundry", aliases: ["tailor", "sewing"], sizes: one(100), defaultSize: 0, defaultHours: 6, surgeRatio: 2, powerFactor: 0.8 },

  // Pumping
  { key: "water_pump", emoji: "💧", name: "Water pump", category: "Pumping", aliases: ["pump", "booster pump", "surface pump"], sizeLabel: "Motor size",
    sizes: [{ label: "0.5 hp", powerW: 370 }, { label: "1 hp", powerW: 750 }, { label: "1.5 hp", powerW: 1100 }, { label: "2 hp", powerW: 1500 }],
    defaultSize: 0, defaultHours: 2, surgeRatio: 3, powerFactor: 0.75, popular: true },
  { key: "borehole_pump", emoji: "💧", name: "Borehole pump (submersible)", category: "Pumping", aliases: ["borehole", "submersible", "well pump"], sizeLabel: "Motor size",
    sizes: [{ label: "1 hp", powerW: 750 }, { label: "1.5 hp", powerW: 1100 }, { label: "2 hp", powerW: 1500 }, { label: "3 hp", powerW: 2200 }],
    defaultSize: 1, defaultHours: 4, surgeRatio: 3, powerFactor: 0.75 },

  // Business and farm
  { key: "welder", emoji: "🔥", name: "Welding machine", category: "Workshop & farm", aliases: ["welder", "welding"], sizeLabel: "Size",
    sizes: [{ label: "Small (160 A)", powerW: 4000 }, { label: "Medium (200 A)", powerW: 6000 }],
    defaultSize: 0, defaultHours: 1, surgeRatio: 1.5, powerFactor: 0.8 },
  { key: "mill", emoji: "🌽", name: "Grain / maize mill", category: "Workshop & farm", aliases: ["posho mill", "grinder", "maize", "milling", "huller"], sizeLabel: "Motor size",
    sizes: [{ label: "5 hp", powerW: 3700 }, { label: "10 hp", powerW: 7500 }, { label: "15 hp", powerW: 11000 }],
    defaultSize: 0, defaultHours: 4, surgeRatio: 3, powerFactor: 0.8 },
  { key: "incubator", emoji: "🥚", name: "Egg incubator", category: "Workshop & farm", aliases: ["incubator", "eggs", "poultry", "chicks"], sizeLabel: "Capacity",
    sizes: [{ label: "Up to 100 eggs", powerW: 60 }, { label: "Up to 500 eggs", powerW: 150 }, { label: "1,000 eggs or more", powerW: 300 }],
    defaultSize: 0, defaultHours: 24, powerFactor: 0.9, duty: 0.6,
    dutyNote: "The heater switches on and off to hold temperature, so we count about 60% of the time." },
  { key: "fence", emoji: "⚡", name: "Electric fence energiser", category: "Workshop & farm", aliases: ["fence", "energiser", "energizer"],
    sizes: one(10), defaultSize: 0, defaultHours: 24, powerFactor: 0.9 },
  { key: "power_tools", emoji: "🔧", name: "Power tools (drill, grinder, saw)", category: "Workshop & farm", aliases: ["drill", "grinder", "saw", "tools", "carpentry"],
    sizes: [{ label: "Light (drill)", powerW: 600 }, { label: "Heavy (grinder / saw)", powerW: 1500 }], sizeLabel: "Type",
    defaultSize: 0, defaultHours: 1, surgeRatio: 2, powerFactor: 0.85 }
];

/** For appliances outside the guide (a company's own list), by category. */
const CATEGORY_EMOJI: Record<string, string> = {
  Lighting: "💡", Entertainment: "📺", Electronics: "💻", Cooling: "🌀", Refrigeration: "🧊",
  Kitchen: "🍳", Heating: "🔥", Laundry: "🧺", Pumping: "💧", "Workshop & farm": "🔧"
};
export function emojiFor(category: string | undefined) {
  return (category && CATEGORY_EMOJI[category]) || "🔌";
}

const BY_KEY = new Map(APPLIANCE_GUIDE.map((a) => [a.key, a]));

export function guideByKey(key: string | undefined) {
  return key ? BY_KEY.get(key) : undefined;
}

/** Search names and the words people actually type. Best matches first. */
export function searchGuide(term: string, limit = 8): GuideAppliance[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const scored: { a: GuideAppliance; score: number }[] = [];
  for (const a of APPLIANCE_GUIDE) {
    const name = a.name.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (a.aliases.some((w) => w.startsWith(q))) score = 2.5;
    else if (name.includes(q)) score = 2;
    else if (a.aliases.some((w) => w.includes(q))) score = 1;
    if (score > 0) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name)).slice(0, limit).map((s) => s.a);
}

/** Energy per day in kWh for one line, the way the server counts it. */
export function dailyKwh(powerW: number, quantity: number, hours: number, duty = 1) {
  return (powerW * quantity * hours * duty) / 1000;
}
