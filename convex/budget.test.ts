/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { groupForBudget, type BudgetSystem } from "./lib/budget";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

// ------------------------------------------------------------- grouping rules

/** A design with just what the grouping looks at. */
function sys(price: number, opts: { hours?: number; leftOut?: number; panels?: boolean; id?: string } = {}): BudgetSystem {
  const id = opts.id ?? `inv${price}`;
  return {
    key: `${opts.leftOut ?? 0}:hybrid:${opts.hours ?? 4}:${id}`,
    level: { systemType: opts.panels === false ? "backup_only" : "hybrid", backupHours: opts.hours ?? 4 },
    leftOut: opts.leftOut ?? 0,
    runs: [],
    leavesOut: [],
    candidate: { inverterId: id, batteryId: "b", panelId: opts.panels === false ? null : "p", counts: { batteries: 1, panels: opts.panels === false ? 0 : 2, panelsPerString: 2, parallelStrings: 1, arrayWp: 1000, batteriesInSeries: 1, batteryStrings: 1, batteryNominalWh: 4800 }, checks: [], status: "compatible" },
    components: [],
    priceMinor: price,
    hasPanels: opts.panels !== false,
    batteryWh: 4800,
    arrayWp: 1000,
    inverterW: 3000
  };
}

describe("grouping against a budget", () => {
  test("closest fit, best fits, cheaper and slightly above", () => {
    const g = groupForBudget(
      [sys(9_500, { hours: 8 }), sys(8_000, { hours: 4 }), sys(7_500, { hours: 2 }), sys(3_000, { panels: false }), sys(11_000, { hours: 8, id: "big" }), sys(13_000, { id: "huge" })],
      10_000
    );
    expect(g.closest?.priceMinor).toBe(9_500);
    expect(g.best.map((s) => s.priceMinor)).toEqual([8_000, 7_500]);
    expect(g.below.map((s) => s.priceMinor)).toEqual([3_000]);
    // Up to 25% above the budget; 13,000 is too far.
    expect(g.above.map((s) => s.priceMinor)).toEqual([11_000]);
    expect(g.smallest).toBeNull();
    expect(g.roomToSpare).toBe(false);
  });

  test("when nothing fits or is close, the smallest system is offered", () => {
    const g = groupForBudget([sys(50_000), sys(80_000, { id: "x" })], 10_000);
    expect(g.closest).toBeNull();
    expect(g.above).toEqual([]);
    expect(g.smallest?.priceMinor).toBe(50_000);
  });

  test("a budget far above what the appliances need has room to spare", () => {
    expect(groupForBudget([sys(4_000)], 10_000).roomToSpare).toBe(true);
    // Not when the closest fit leaves an appliance out.
    expect(groupForBudget([sys(4_000, { leftOut: 1 })], 10_000).roomToSpare).toBe(false);
  });

  test("the same equipment is shown once, described by the best design it meets", () => {
    const g = groupForBudget([sys(9_000, { hours: 2 }), sys(9_000, { hours: 8 })], 10_000);
    expect(g.closest?.level.backupHours).toBe(8);
    expect(g.best).toEqual([]);
  });
});

// ------------------------------------------------------------- end to end

const inverterSpecs = {
  topology: "Hybrid", rated_output_power: 3000, rated_output_apparent: 3000, surge_power: 6000,
  surge_duration: 5, phase: "Single-phase", output_voltage: 230, battery_voltage: 48, max_pv_input_power: 4000,
  max_pv_voltage: 450, mppt_min_voltage: 60, mppt_max_voltage: 400, max_pv_current: 18,
  mppt_count: 1, max_charge_current: 60
};
const batterySpecs = {
  chemistry: "LiFePO4", nominal_voltage: 48, capacity_ah: 100, max_discharge_current: 100,
  max_charge_current: 60, recommended_dod: 80, has_bms: true
};
const panelSpecs = {
  rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2, voc_temp_coeff: -0.27, max_system_voltage: 1500
};

async function setup(priced = true) {
  const t: T = convexTest(schema, modules);
  const owner = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "owner@acme.ug" });
    await ctx.db.insert("userProfiles", { authSubject: userId, email: "owner@acme.ug", displayName: "owner", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    return `${userId}|s`;
  });
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug" });
  const asOwner = t.withIdentity({ subject: owner });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  for (const [key, sku, cost, specValues] of [
    ["inverter", "INV-3K", 2_000_000, inverterSpecs],
    ["battery", "BAT-4.8", 3_000_000, batterySpecs],
    ["pv_panel", "PV-550", 500_000, panelSpecs]
  ] as const) {
    const { productId } = await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: cats.find((c) => c.key === key)!.id, name: sku, brand: "Brand", model: sku, sku, specValues
    });
    await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: cost });
  }
  // List price = cost + 25%: inverter 2.5M, battery 3.75M, panel 625k.
  if (priced) await asOwner.mutation(api.margins.setMarginRule, { tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10 });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  return { t, asOwner };
}

const items = [
  { name: "Fridge", quantity: 1, hoursPerDay: 24, powerW: 150 },
  { name: "TV", quantity: 1, hoursPerDay: 5, powerW: 100 }
];
const person = { name: "Kats", phone: "+256 782 872796", location: "Kampala" };

describe("what can my money buy", () => {
  test("shows systems that fit, with a battery always, and never a price", async () => {
    const { t } = await setup();
    const match = await t.action(api.budget.budgetMatch, { budget: 7_000_000, grid: "unreliable", items });
    expect(match.status).toBe("ok");
    // Inverter and battery charged from UEDCL (6.25M) fits; adding panels goes above 7M.
    expect(match.closest?.systemType).toBe("backup_only");
    expect(match.closest?.components.map((c) => c.role)).toEqual(["Inverter", "Battery"]);
    expect(match.above.length).toBeGreaterThan(0);
    expect(match.above.every((s) => s.components.some((c) => c.role === "Battery"))).toBe(true);
    // Nothing that reveals a price, or a product id, reaches the public.
    const text = JSON.stringify({ ...match, budgetMinor: undefined });
    expect(text).not.toMatch(/price|Minor|productId/i);
  });

  test("with no grid, every system has panels; a tiny budget says nothing fits", async () => {
    const { t } = await setup();
    const offGrid = await t.action(api.budget.budgetMatch, { budget: 30_000_000, grid: "none", items });
    expect(offGrid.closest?.components.some((c) => c.role === "Solar panels")).toBe(true);
    expect([...offGrid.best, ...offGrid.below].every((s) => s.systemType === "off_grid")).toBe(true);

    const tiny = await t.action(api.budget.budgetMatch, { budget: 500_000, grid: "unreliable", items });
    expect(tiny.closest).toBeNull();
    expect(tiny.above).toEqual([]);
    expect(tiny.smallest?.systemType).toBe("backup_only");
  });

  test("without list prices, budgets cannot be matched yet", async () => {
    const { t } = await setup(false);
    const match = await t.action(api.budget.budgetMatch, { budget: 7_000_000, grid: "unreliable", items });
    expect(match.status).toBe("no_prices");
  });

  test("a request carries the budget and chosen system; staff see it with today's price", async () => {
    const { t, asOwner } = await setup();
    const match = await t.action(api.budget.budgetMatch, { budget: 7_000_000, grid: "unreliable", items });
    const sent = await t.mutation(api.budget.submitBudgetRequest, {
      budget: 7_000_000, grid: "unreliable", items, systemKey: match.closest!.key, ...person
    });
    expect(sent.systemTitle).toMatch(/Battery backup charged from UEDCL/);
    const lead = await asOwner.query(api.responses.getLead, { leadId: sent.requestId as Id<"quoteRequests"> });
    expect(lead.budget).toMatchObject({ amountMinor: 7_000_000, leavesOut: [], equipmentMinor: 6_250_000 });
    expect(lead.components.map((c) => c.role)).toEqual(["Inverter", "Battery"]);
    expect(lead.appliances).toHaveLength(2);

    // "Send us your budget": no system chosen, a technician advises.
    const advice = await t.mutation(api.budget.submitBudgetRequest, { budget: 500_000, grid: "none", items, ...person });
    const adviceLead = await asOwner.query(api.responses.getLead, { leadId: advice.requestId as Id<"quoteRequests"> });
    expect(adviceLead.optionTitle).toBe("Advice on what my budget can buy");
    expect(adviceLead.budget).toMatchObject({ amountMinor: 500_000, equipmentMinor: null });

    await expect(
      t.mutation(api.budget.submitBudgetRequest, { budget: 7_000_000, grid: "unreliable", items, systemKey: "0:hybrid:4:made-up:x:y", ...person })
    ).rejects.toThrow(/no longer available/);
  });
});
