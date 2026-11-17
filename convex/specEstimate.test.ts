import { describe, expect, test } from "vitest";
import { buildCandidates, computeRequirements, DEFAULT_ASSUMPTIONS, type CatalogueItem } from "./lib/sizing";
import { estimateChecks, withSafeEstimates } from "./lib/specEstimate";

const item = (id: string, categoryKey: string, specValues: CatalogueItem["specValues"]): CatalogueItem => ({
  id, sku: id.toUpperCase(), name: id, categoryKey, specSchemaVersion: 1, specValues
});
const byId = (list: CatalogueItem[], id: string) => list.find((c) => c.id === id)!;

describe("safe estimates for inverters", () => {
  test("a known MPPT maximum becomes the PV voltage limit, which can only be lower than the real one", () => {
    // Real datasheet: Voc limit 500 V, MPPT 120–450 V. The price list only gave the MPPT range.
    const inv = item("inv", "inverter", { battery_voltage: 48, mppt_min_voltage: 120, mppt_max_voltage: 450, max_pv_input_power: 6000 });
    const out = byId(withSafeEstimates([inv]), "inv");
    expect(out.specValues.max_pv_voltage).toBe(450);
    expect(out.specValues.max_pv_voltage as number).toBeLessThanOrEqual(500);
    expect(out.specValues.mppt_count).toBe(1);
    // 6000 W ÷ 450 V = 13.3 A: the least current that could deliver the rated power.
    expect(out.specValues.max_pv_current).toBe(13.3);
    expect(Object.keys(out.estimated!)).toEqual(["max_pv_voltage", "mppt_count", "max_pv_current"]);
  });

  test("with no solar figures, a 48 V inverter is held to the lowest 48 V class limit and a narrow window", () => {
    const out = byId(withSafeEstimates([item("inv", "inverter", { battery_voltage: 48, max_pv_input_power: 4000 })]), "inv");
    expect(out.specValues.max_pv_voltage).toBe(145);
    expect(out.specValues.mppt_max_voltage).toBe(116); // 80% of 145 V
    expect(out.specValues.mppt_min_voltage).toBe(72);
    expect(out.specValues.mppt_max_voltage as number).toBeLessThan(out.specValues.max_pv_voltage as number);
  });

  test("peers only ever make an estimate more cautious", () => {
    const peer = item("peer", "inverter", { battery_voltage: 24, max_pv_voltage: 80, mppt_min_voltage: 40, mppt_max_voltage: 70, max_pv_current: 11 });
    const out = byId(withSafeEstimates([peer, item("inv", "inverter", { battery_voltage: 24 })]), "inv");
    expect(out.specValues.max_pv_voltage).toBe(80); // below the 100 V class floor, so the lower wins
    expect(out.specValues.max_pv_current).toBe(11);
    expect(out.specValues.mppt_min_voltage).toBe(40); // highest known start voltage
  });

  test("real figures are never replaced, and complete products are untouched", () => {
    const full = item("full", "inverter", {
      battery_voltage: 48, max_pv_voltage: 500, mppt_min_voltage: 120, mppt_max_voltage: 450, max_pv_current: 22, mppt_count: 2
    });
    const [out] = withSafeEstimates([full]);
    expect(out).toBe(full);
    expect(out.estimated).toBeUndefined();
  });

  test("no voltage estimate without a battery voltage to anchor it", () => {
    const out = byId(withSafeEstimates([item("inv", "inverter", { rated_output_power: 3000 })]), "inv");
    expect(out.specValues.max_pv_voltage).toBeUndefined();
    expect(out.specValues.mppt_min_voltage).toBeUndefined();
  });
});

describe("safe estimates for panels", () => {
  test("a large panel gets the highest likely Voc and Isc and the lowest likely Vmp", () => {
    const out = byId(withSafeEstimates([item("pv", "pv_panel", { rated_power: 550 })]), "pv");
    expect(out.specValues).toMatchObject({ voc: 54, vmp: 30, isc: 18.6 });
    // Real 550 W panels: Voc about 49.9 V, Vmp about 41.8 V, Isc about 14 A.
    expect(out.specValues.voc as number).toBeGreaterThan(49.9);
    expect(out.specValues.vmp as number).toBeLessThan(41.8);
    expect(out.specValues.isc as number).toBeGreaterThan(14);
  });

  test("a small panel covers both 12 V and 24 V layouts", () => {
    const out = byId(withSafeEstimates([item("pv", "pv_panel", { rated_power: 100 })]), "pv");
    expect(out.specValues).toMatchObject({ voc: 46, vmp: 16 });
    expect(out.specValues.isc).toBe(6.9); // 100 W ÷ 16 V plus 10%
  });

  test("a missing Isc follows from the real Vmp when it is known", () => {
    const out = byId(withSafeEstimates([item("pv", "pv_panel", { rated_power: 550, voc: 49.9, vmp: 41.8 })]), "pv");
    expect(out.specValues.isc).toBe(14.5);
    expect(Object.keys(out.estimated!)).toEqual(["isc"]);
  });

  test("no estimate without the rated power", () => {
    const [out] = withSafeEstimates([item("pv", "pv_panel", {})]);
    expect(out.estimated).toBeUndefined();
  });
});

describe("designs that rely on estimates", () => {
  test("are never final: each estimated part adds a technician check", () => {
    const catalogue = withSafeEstimates([
      item("inv", "inverter", {
        topology: "Hybrid", rated_output_power: 3000, rated_output_apparent: 3000, phase: "Single-phase",
        battery_voltage: 48, mppt_min_voltage: 120, mppt_max_voltage: 450, max_pv_input_power: 6000, max_charge_current: 60
      }),
      item("pv", "pv_panel", { rated_power: 400, vmp: 37, isc: 11 })
    ]);
    const a = { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "test" };
    const inputs = {
      systemType: "grid_tied" as const,
      lines: [{ name: "Lights", quantity: 10, powerW: 20, currentType: "ac" as const, critical: false, windows: [{ start: 8, end: 18 }] }]
    };
    const result = buildCandidates(inputs, computeRequirements(inputs, a), a, catalogue);
    expect(result.candidates.length, JSON.stringify(result.rejected)).toBeGreaterThan(0);
    const c = result.candidates[0];
    expect(c.status).toBe("requires_review");
    const flagged = c.checks.filter((k) => k.id.startsWith("estimated_"));
    expect(flagged.map((k) => k.id).sort()).toEqual(["estimated_inv", "estimated_pv"]);
    expect(flagged[0].detail).toMatch(/pending verification by a technician/);
  });

  test("complete products add no estimate check", () => {
    expect(estimateChecks([item("x", "inverter", {}), null, undefined])).toEqual([]);
  });
});
