/**
 * Standard solar product categories and their typed specifications.
 *
 * These are starting definitions only: administrators can add fields or change
 * labels/units. Fields marked `critical` are the ones sizing and compatibility
 * checks rely on; a product missing one is "cannot validate", never a pass.
 */
type FieldType = "number" | "text" | "boolean" | "choice";

export type DefaultField = {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  options?: string[];
  required?: boolean;
  critical?: boolean;
};

export type DefaultCategory = {
  key: string;
  name: string;
  description: string;
  fields: DefaultField[];
};

const num = (
  key: string,
  label: string,
  unit: string,
  flags: { required?: boolean; critical?: boolean } = {}
): DefaultField => ({ key, label, type: "number", unit, ...flags });

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    key: "pv_panel",
    name: "Solar panels",
    description: "Photovoltaic modules.",
    fields: [
      num("rated_power", "Rated power (Pmax)", "Wp", { required: true, critical: true }),
      num("voc", "Open-circuit voltage (Voc)", "V", { required: true, critical: true }),
      num("vmp", "Voltage at max power (Vmp)", "V", { required: true, critical: true }),
      num("isc", "Short-circuit current (Isc)", "A", { required: true, critical: true }),
      num("imp", "Current at max power (Imp)", "A", { required: true, critical: true }),
      num("voc_temp_coeff", "Voc temperature coefficient", "%/°C", { critical: true }),
      num("max_system_voltage", "Maximum system voltage", "V", { critical: true }),
      num("efficiency", "Module efficiency", "%"),
      { key: "cell_type", label: "Cell type", type: "choice", options: ["Monocrystalline", "Polycrystalline", "Thin film", "Other"] },
      num("length", "Length", "mm"),
      num("width", "Width", "mm"),
      num("weight", "Weight", "kg")
    ]
  },
  {
    key: "inverter",
    name: "Inverters",
    description: "Off-grid, hybrid and grid-connected inverters.",
    fields: [
      { key: "topology", label: "Type", type: "choice", options: ["Off-grid", "Hybrid", "Grid-connected"], required: true, critical: true },
      num("rated_output_power", "Continuous output power", "W", { required: true, critical: true }),
      num("rated_output_apparent", "Continuous apparent power", "VA", { required: true, critical: true }),
      num("surge_power", "Surge power", "W", { critical: true }),
      num("surge_duration", "Surge duration", "s", { critical: true }),
      { key: "phase", label: "Output phase", type: "choice", options: ["Single-phase", "Three-phase"], required: true, critical: true },
      num("output_voltage", "Nominal output voltage", "V", { required: true, critical: true }),
      num("output_frequency", "Output frequency", "Hz", { critical: true }),
      num("battery_voltage", "Nominal battery voltage", "V", { critical: true }),
      num("max_pv_input_power", "Maximum PV input power", "W", { critical: true }),
      num("max_pv_voltage", "Maximum PV input voltage", "V", { critical: true }),
      num("mppt_min_voltage", "MPPT minimum voltage", "V", { critical: true }),
      num("mppt_max_voltage", "MPPT maximum voltage", "V", { critical: true }),
      num("max_pv_current", "Maximum PV input current per MPPT", "A", { critical: true }),
      num("mppt_count", "Number of MPPT inputs", "", { critical: true }),
      num("max_charge_current", "Maximum battery charge current", "A", { critical: true }),
      num("efficiency", "Peak efficiency", "%")
    ]
  },
  {
    key: "battery",
    name: "Batteries",
    description: "Energy storage batteries.",
    fields: [
      { key: "chemistry", label: "Chemistry", type: "choice", options: ["LiFePO4", "Lithium-ion (other)", "AGM lead-acid", "Gel lead-acid", "Flooded lead-acid", "Other"], required: true, critical: true },
      num("nominal_voltage", "Nominal voltage", "V", { required: true, critical: true }),
      num("capacity_ah", "Capacity", "Ah", { required: true, critical: true }),
      num("usable_energy", "Usable energy", "kWh", { critical: true }),
      num("max_discharge_current", "Maximum continuous discharge current", "A", { critical: true }),
      num("max_charge_current", "Maximum charge current", "A", { critical: true }),
      num("recommended_dod", "Recommended depth of discharge", "%", { critical: true }),
      { key: "has_bms", label: "Built-in BMS", type: "boolean", critical: true },
      num("cycle_life", "Rated cycle life", "cycles"),
      num("weight", "Weight", "kg")
    ]
  },
  {
    key: "charge_controller",
    name: "Charge controllers",
    description: "Standalone solar charge controllers.",
    fields: [
      { key: "technology", label: "Technology", type: "choice", options: ["MPPT", "PWM"], required: true, critical: true },
      num("battery_voltage", "Supported battery voltage", "V", { critical: true }),
      num("max_pv_voltage", "Maximum PV input voltage", "V", { required: true, critical: true }),
      num("max_pv_power", "Maximum PV input power", "W", { critical: true }),
      num("max_charge_current", "Maximum charge current", "A", { required: true, critical: true }),
      num("mppt_min_voltage", "MPPT minimum voltage", "V", { critical: true })
    ]
  },
  {
    key: "mounting",
    name: "Mounting",
    description: "Racking and mounting structures.",
    fields: [
      { key: "mount_type", label: "Mount type", type: "choice", options: ["Roof", "Ground", "Pole", "Carport"], required: true },
      num("panel_capacity", "Panels supported", "panels"),
      { key: "material", label: "Material", type: "text" }
    ]
  },
  {
    key: "protection",
    name: "Protection",
    description: "Breakers, fuses, isolators and surge protection.",
    fields: [
      { key: "device_type", label: "Device type", type: "choice", options: ["DC breaker", "AC breaker", "Fuse", "Isolator", "Surge protector"], required: true },
      { key: "current_type", label: "Current type", type: "choice", options: ["DC", "AC"], required: true, critical: true },
      num("rated_voltage", "Rated voltage", "V", { required: true, critical: true }),
      num("rated_current", "Rated current", "A", { critical: true }),
      num("poles", "Number of poles", "")
    ]
  },
  {
    key: "cable",
    name: "Cables",
    description: "DC, AC and battery cabling.",
    fields: [
      { key: "cable_type", label: "Cable type", type: "choice", options: ["DC solar", "AC", "Battery"], required: true },
      num("conductor_size", "Conductor size", "mm²", { required: true, critical: true }),
      num("rated_voltage", "Rated voltage", "V", { critical: true }),
      num("length", "Length per unit", "m")
    ]
  },
  {
    key: "accessory",
    name: "Installation accessories",
    description: "Connectors, trunking and other installation materials.",
    fields: [{ key: "notes", label: "Notes", type: "text" }]
  }
];
