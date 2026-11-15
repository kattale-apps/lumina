import { describe, expect, test } from "vitest";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type CatalogueItem } from "./lib/sizing";
import {
  buildUpgradeReport,
  busClass,
  chemistryFamily,
  optionsOf,
  validateExisting,
  type ExistingSystem,
  type UpgradeNeeds
} from "./lib/upgrade";

const a: Assumptions = { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "Test" };

const item = (id: string, categoryKey: string, specValues: CatalogueItem["specValues"]): CatalogueItem => ({
  id, sku: id.toUpperCase(), name: id, categoryKey, specSchemaVersion: 1, specValues
});

const catalogue: CatalogueItem[] = [
  item("inv5", "inverter", {
    topology: "Hybrid", rated_output_power: 5000, rated_output_apparent: 5000, phase: "Single-phase",
    battery_voltage: 48, max_pv_input_power: 6000, max_pv_voltage: 500, mppt_min_voltage: 120,
    mppt_max_voltage: 450, max_pv_current: 27, mppt_count: 1, max_charge_current: 100, efficiency: 97
  }),
  item("inv3-24", "inverter", {
    topology: "Hybrid", rated_output_power: 3000, rated_output_apparent: 3000, phase: "Single-phase",
    battery_voltage: 24, max_pv_input_power: 4000, max_pv_voltage: 450
  }),
  item("li100", "battery", {
    chemistry: "LiFePO4", nominal_voltage: 51.2, capacity_ah: 100, max_discharge_current: 100,
    max_charge_current: 50, recommended_dod: 90, has_bms: true, cycle_life: 6000
  }),
  item("agm200", "battery", {
    chemistry: "AGM lead-acid", nominal_voltage: 12, capacity_ah: 200, max_discharge_current: 200,
    max_charge_current: 60, recommended_dod: 50, cycle_life: 600
  }),
  item("pv550", "pv_panel", {
    rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2, voc_temp_coeff: -0.27, max_system_voltage: 1500, efficiency: 21.3
  }),
  item("pv330", "pv_panel", { rated_power: 330, voc: 45.5, vmp: 37.6, isc: 9.3, imp: 8.8, voc_temp_coeff: -0.3, efficiency: 17 }),
  item("mppt60", "charge_controller", {
    technology: "MPPT", battery_voltage: 48, max_pv_voltage: 150, max_pv_power: 3400, max_charge_current: 60
  }),
  item("mppt100", "charge_controller", {
    technology: "MPPT", battery_voltage: 48, max_pv_voltage: 250, max_pv_power: 5800, max_charge_current: 100
  })
];

/** A typical older off-grid home: 3 kW inverter, PWM controller, 4 x 330 W panels, 4 x 12 V 200 Ah lead-acid. */
const home: ExistingSystem = {
  systemType: "off_grid",
  systemVoltage: 48,
  inverter: { ratedW: 3000, hasSolarInput: false, maxChargeA: 40 },
  controller: { technology: "PWM", maxChargeA: 40, maxPvVoltage: 150 },
  panels: { count: 4, wp: 330, voc: 45.5, vmp: 37.6, isc: 9.3, perString: 2 },
  batteries: { count: 4, nominalV: 12, ah: 200, chemistry: "lead_acid", ageYears: 3 }
};
const everything: UpgradeNeeds = {
  goals: ["battery", "panels", "inverter", "swaps"], dailyKwh: 8, peakLoadW: 3500, backupHours: 8, backupLoadW: 800
};
const run = (sys: ExistingSystem, needs: UpgradeNeeds, cat = catalogue) => buildUpgradeReport(sys, needs, a, cat);
const section = (r: ReturnType<typeof run>, area: string) => r.sections.find((s) => s.area === area)!;
const check = (o: { checks: { id: string; state: string }[] }, id: string) => o.checks.find((c) => c.id === id)?.state;

describe("helpers", () => {
  test("lithium blocks are matched to their bank-voltage class", () => {
    expect(busClass(12.8)).toBe(12);
    expect(busClass(25.6)).toBe(24);
    expect(busClass(51.2)).toBe(48);
    expect(busClass(12)).toBe(12);
    expect(busClass(48)).toBe(48);
    expect(busClass(2)).toBe(2);
  });

  test("catalogue chemistry labels map to families", () => {
    expect(chemistryFamily("LiFePO4")).toBe("lithium");
    expect(chemistryFamily("Lithium-ion (other)")).toBe("lithium");
    expect(chemistryFamily("Gel lead-acid")).toBe("lead_acid");
    expect(chemistryFamily("Other")).toBe("unknown");
    expect(chemistryFamily(undefined)).toBe("unknown");
  });
});

describe("validation", () => {
  test("a battery bank needs the system voltage", () => {
    const { systemVoltage: _v, controller: _c, ...rest } = home;
    expect(validateExisting(rest, everything)).toMatch(/system \(battery bank\) voltage/);
  });

  test("backup hours and backup load go together", () => {
    expect(validateExisting(home, { goals: ["battery"], backupHours: 4 })).toMatch(/both the backup hours/);
  });

  test("an invalid description is reported as a blocker, not thrown", () => {
    const r = run({ systemType: "off_grid" }, { goals: ["battery"] });
    expect(r.blockers).toEqual(["Describe at least one part of the existing system."]);
    expect(r.sections).toEqual([]);
  });

  test("batteries that cannot make the stated bank voltage block the study", () => {
    const r = run({ ...home, batteries: { count: 3, nominalV: 12, ah: 200, chemistry: "lead_acid" } }, everything);
    expect(r.blockers[0]).toMatch(/cannot make a 48 V bank/);
  });
});

describe("the system today", () => {
  const r = run(home, everything);

  test("array, storage and backup follow the documented arithmetic", () => {
    expect(r.blockers).toEqual([]);
    // 4 x 330 Wp; x 4 sun hours x 0.75 performance.
    expect(r.current.arrayWp).toBe(1320);
    expect(r.current.solarWhPerDay).toBe(3960);
    // 4 x 12 V x 200 Ah = 9600 Wh; lead-acid at 50% x 0.95 discharge efficiency.
    expect(r.current.batteryNominalWh).toBe(9600);
    expect(r.current.batteryUsableWh).toBe(4560);
    // 4560 Wh / 800 W.
    expect(r.current.backupHours).toBe(5.7);
    // A controller with no stated PV power is limited by 40 A x 48 V.
    expect(r.current.chargerLimitWp).toBe(1920);
  });

  test("needs are turned into requirements", () => {
    // 8000 Wh / (4 h x 0.75); 8 h x 800 W; 3500 W x 1.2 headroom.
    expect(r.required.pvWp).toBe(2666.67);
    expect(r.required.batteryDeliveredWh).toBe(6400);
    expect(r.required.inverterW).toBe(4200);
  });

  test("shortfalls are findings", () => {
    const state = (id: string) => r.findings.find((f) => f.id === id)?.state;
    expect(state("bank")).toBe("pass");
    expect(state("backup")).toBe("fail");
    expect(state("solar_energy")).toBe("fail");
    expect(state("inverter_load")).toBe("fail");
    expect(state("charger_power")).toBe("pass");
    expect(state("string_voltage")).toBe("pass");
  });

  test("an array above the charger's limit is flagged", () => {
    const over = run({ ...home, panels: { count: 8, wp: 330, perString: 2 } }, { goals: ["panels"] });
    expect(over.findings.find((f) => f.id === "charger_power")?.state).toBe("fail");
  });
});

describe("batteries", () => {
  const r = run(home, everything);
  const batteries = section(r, "battery");

  test("the required bank voltage is stated", () => {
    expect(batteries.requirements[0]).toBe("Every battery string must make 48 V: 4 × 12 V, 2 × 24 V, 1 × 48 V in series.");
  });

  test("adding the same chemistry is sized to the shortfall and needs a technician", () => {
    const add = batteries.options.find((o) => o.key === "battery:add:agm200")!;
    // Short by 6400 - 4560 = 1840 Wh; one 48 V string of 200 Ah gives 4560 Wh usable.
    expect(add.quantity).toBe(4);
    expect(add.figures.resultingUsableWh).toBe(9120);
    expect(add.figures.backupHours).toBe(11.4);
    expect(check(add, "battery_mixing")).toBe("review");
    expect(add.status).toBe("requires_review");
  });

  test("a different chemistry is only ever offered as a whole-bank replacement", () => {
    expect(batteries.options.some((o) => o.key === "battery:add:li100")).toBe(false);
    const swap = batteries.options.find((o) => o.key === "battery:replace:li100")!;
    // 6400 Wh needed; one 51.2 V x 100 Ah string gives 5120 x 0.9 x 0.95 = 4377.6 Wh usable, so two.
    expect(swap.quantity).toBe(2);
    expect(swap.figures.resultingNominalWh).toBe(10240);
    expect(swap.figures.resultingUsableWh).toBe(8755.2);
    expect(check(swap, "battery_voltage")).toBe("pass");
    expect(check(swap, "battery_profile")).toBe("review");
    expect(check(swap, "battery_discharge")).toBe("pass");
  });

  test("a bank the inverter would overdraw is rejected with the reason", () => {
    const weak = [item("li50", "battery", {
      chemistry: "LiFePO4", nominal_voltage: 51.2, capacity_ah: 200, max_discharge_current: 30,
      max_charge_current: 50, recommended_dod: 90, has_bms: true
    })];
    const s = section(run(home, { goals: ["battery"], backupHours: 8, backupLoadW: 800 }, weak), "battery");
    expect(s.options).toEqual([]);
    expect(s.rejected[0]).toMatch(/LI50: 30 A available is below/);
  });

  test("a battery that cannot make the bank voltage is left out", () => {
    const s = section(run({ ...home, systemVoltage: 24, batteries: { count: 2, nominalV: 12, ah: 200, chemistry: "lead_acid" } },
      { goals: ["battery"] }), "battery");
    expect(s.options.some((o) => o.productId === "li100")).toBe(false);
    expect(s.rejected).toContain("LI100 (51.2 V) cannot make up a 24 V bank.");
  });

  test("when the bank already covers the target nothing is added", () => {
    const s = section(run(home, { goals: ["battery"], backupHours: 2, backupLoadW: 800 }), "battery");
    expect(s.options).toEqual([]);
    expect(s.messages[0]).toMatch(/already covers it/);
  });

  test("an unknown chemistry is never added to", () => {
    const s = section(run({ ...home, batteries: { count: 4, nominalV: 12, ah: 200, chemistry: "unknown" } },
      { goals: ["battery"], backupHours: 10, backupLoadW: 800 }), "battery");
    expect(s.options.every((o) => o.action === "replace")).toBe(true);
  });
});

describe("panels", () => {
  test("additions fit the existing charger's voltage window and power", () => {
    const sys: ExistingSystem = { ...home, controller: { technology: "MPPT", maxChargeA: 80, maxPvVoltage: 150 } };
    const s = section(run(sys, { goals: ["panels"], dailyKwh: 8 }), "panels");
    const same = s.options.find((o) => o.key === "panels:add:pv330")!;
    // Limit 80 A x 48 V = 3840 W; gap 2666.67 - 1320 = 1346.67 Wp; strings of 2 x 330 = 660 Wp -> 3 strings.
    expect(same.figures.panelsPerString).toBe(2);
    expect(same.quantity).toBe(6);
    expect(same.figures.resultingWp).toBe(3300);
    expect(check(same, "pv_match")).toBe("pass");
    expect(check(same, "pv_power")).toBe("pass");
    // The minimum voltage is the bank's charging voltage, not a nameplate figure.
    expect(check(same, "pv_voltage")).toBe("review");
    expect(same.requires).toBeUndefined();
  });

  test("a string longer than the charger allows is never proposed", () => {
    const sys: ExistingSystem = { ...home, controller: { technology: "MPPT", maxChargeA: 80, maxPvVoltage: 100 } };
    const s = section(run(sys, { goals: ["panels"] }), "panels");
    // 49.9 V x (1 + -0.27% x -10) = 51.25 V cold: only one PV550 fits under 100 V, and one cannot reach 57.6 V hot.
    expect(s.options.some((o) => o.productId === "pv550")).toBe(false);
    expect(s.rejected.some((x) => x.startsWith("PV550 cannot form a string"))).toBe(true);
  });

  test("when the charger is too small, panels are offered together with a replacement", () => {
    const r = run(home, { goals: ["panels"], dailyKwh: 8 });
    const s = section(r, "panels");
    expect(s.options.length).toBeGreaterThan(0);
    for (const o of s.options) {
      expect(o.requires).toBe("controller:replace:mppt60");
      expect(optionsOf(r).some((x) => x.key === o.requires)).toBe(true);
    }
    // The option that meets the whole target comes first.
    expect(s.options[0].productId).toBe("pv330");
    expect(s.options[0].figures.shortWp).toBeUndefined();
    expect(section(r, "controller").options.map((o) => o.productId)).toEqual(["mppt60", "mppt100"]);
  });

  test("an inverter with a full solar input brings a replacement inverter", () => {
    const sys: ExistingSystem = {
      systemType: "hybrid", systemVoltage: 48,
      inverter: { ratedW: 3000, hasSolarInput: true, maxPvPowerW: 2000, maxPvVoltage: 450, mpptMinVoltage: 120 },
      panels: { count: 4, wp: 450, voc: 49, vmp: 41, isc: 11.5, perString: 4 },
      batteries: { count: 1, nominalV: 51.2, ah: 100, chemistry: "lithium" }
    };
    const r = run(sys, { goals: ["panels"], dailyKwh: 12 });
    const s = section(r, "panels");
    expect(section(r, "inverter").options[0].productId).toBe("inv5");
    expect(s.options.every((o) => o.requires === "inverter:replace:inv5")).toBe(true);
    expect(s.options.length).toBeGreaterThan(0);
  });
});

describe("inverter and controller", () => {
  const r = run(home, everything);

  test("a replacement inverter must keep the existing bank voltage", () => {
    const s = section(r, "inverter");
    expect(s.options.map((o) => o.productId)).toEqual(["inv5"]);
    expect(check(s.options[0], "inverter_bus")).toBe("pass");
    expect(s.rejected).toContain("INV3-24 (3000 W) is below the 4200 W needed.");
  });

  test("an inverter for another bank voltage is rejected even when big enough", () => {
    const big24 = [item("inv6-24", "inverter", {
      topology: "Off-grid", rated_output_power: 6000, phase: "Single-phase", battery_voltage: 24
    })];
    const s = section(run(home, { goals: ["inverter"], peakLoadW: 3500 }, big24), "inverter");
    expect(s.options).toEqual([]);
    expect(s.rejected[0]).toMatch(/needs a 24 V bank/);
  });

  test("a grid-connected inverter does not suit an off-grid system", () => {
    const tied = [item("gt5", "inverter", { topology: "Grid-connected", rated_output_power: 5000, battery_voltage: 48 })];
    const s = section(run(home, { goals: ["inverter"], peakLoadW: 3500 }, tied), "inverter");
    expect(s.rejected[0]).toMatch(/does not suit an off-grid system/);
  });

  test("controllers are sized to the target array and the existing strings", () => {
    const s = section(r, "controller");
    // 2666.67 Wp / 48 V = 55.56 A.
    expect(s.requirements[1]).toBe("A 2667 Wp array needs about 55.56 A of charge current at 48 V.");
    expect(s.options[0].productId).toBe("mppt60");
    expect(s.options[0].status).toBe("compatible");
    expect(s.options[0].summary).toMatch(/PWM to MPPT/);
  });

  test("a missing specification means review, never a pass", () => {
    const bare = [item("mppt-x", "charge_controller", { technology: "MPPT", max_charge_current: 80 })];
    const s = section(run(home, { goals: ["panels"], dailyKwh: 8 }, bare), "controller");
    const o = s.options[0];
    expect(check(o, "controller_voltage")).toBe("review");
    expect(check(o, "controller_power")).toBe("review");
    expect(o.status).toBe("requires_review");
  });
});

describe("determinism", () => {
  test("the same inputs give the same report", () => {
    expect(run(home, everything)).toEqual(run(home, everything));
    expect(run(home, everything, [...catalogue].reverse()).sections.map((s) => s.options.map((o) => o.key))).toEqual(
      run(home, everything).sections.map((s) => s.options.map((o) => o.key))
    );
  });
});
