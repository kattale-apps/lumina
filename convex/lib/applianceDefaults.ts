/**
 * Starting appliance library. These are typical nameplate-style estimates for
 * discussion, not measurements and not product specifications. Agents should
 * replace them with nameplate or measured values wherever they can.
 */
export type DefaultAppliance = {
  name: string;
  category: string;
  powerW: number;
  surgeW?: number;
  powerFactor?: number;
  typicalHoursPerDay: number;
  currentType: "ac" | "dc";
};

export const DEFAULT_APPLIANCES: DefaultAppliance[] = [
  { name: "LED bulb", category: "Lighting", powerW: 9, typicalHoursPerDay: 5, currentType: "ac", powerFactor: 0.9 },
  { name: "Security floodlight (LED)", category: "Lighting", powerW: 30, typicalHoursPerDay: 11, currentType: "ac", powerFactor: 0.9 },
  { name: "Phone charger", category: "Electronics", powerW: 10, typicalHoursPerDay: 3, currentType: "ac", powerFactor: 0.6 },
  { name: "Laptop", category: "Electronics", powerW: 60, typicalHoursPerDay: 6, currentType: "ac", powerFactor: 0.6 },
  { name: "LED television (32 in)", category: "Entertainment", powerW: 50, typicalHoursPerDay: 5, currentType: "ac", powerFactor: 0.8 },
  { name: "Decoder / set-top box", category: "Entertainment", powerW: 15, typicalHoursPerDay: 5, currentType: "ac", powerFactor: 0.7 },
  { name: "Wi-Fi router", category: "Electronics", powerW: 12, typicalHoursPerDay: 24, currentType: "ac", powerFactor: 0.6 },
  { name: "Ceiling fan", category: "Cooling", powerW: 70, surgeW: 140, typicalHoursPerDay: 8, currentType: "ac", powerFactor: 0.85 },
  { name: "Refrigerator (medium)", category: "Refrigeration", powerW: 150, surgeW: 750, typicalHoursPerDay: 24, currentType: "ac", powerFactor: 0.7 },
  { name: "Chest freezer", category: "Refrigeration", powerW: 200, surgeW: 900, typicalHoursPerDay: 24, currentType: "ac", powerFactor: 0.7 },
  { name: "Water pump (0.5 hp)", category: "Pumping", powerW: 370, surgeW: 1100, typicalHoursPerDay: 2, currentType: "ac", powerFactor: 0.75 },
  { name: "Electric iron", category: "Heating", powerW: 1000, typicalHoursPerDay: 1, currentType: "ac", powerFactor: 1 },
  { name: "Electric kettle", category: "Heating", powerW: 1500, typicalHoursPerDay: 1, currentType: "ac", powerFactor: 1 },
  { name: "Microwave oven", category: "Heating", powerW: 1200, typicalHoursPerDay: 1, currentType: "ac", powerFactor: 0.95 },
  { name: "Washing machine", category: "Laundry", powerW: 500, surgeW: 1500, typicalHoursPerDay: 1, currentType: "ac", powerFactor: 0.7 },
  { name: "Air conditioner (1 hp split)", category: "Cooling", powerW: 800, surgeW: 2400, typicalHoursPerDay: 6, currentType: "ac", powerFactor: 0.8 },
  { name: "Desktop computer", category: "Electronics", powerW: 150, typicalHoursPerDay: 6, currentType: "ac", powerFactor: 0.65 },
  { name: "DC LED light strip", category: "Lighting", powerW: 12, typicalHoursPerDay: 5, currentType: "dc" }
];
