/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { LoadLine } from "./lib/load";
import {
  buildCandidates,
  computeRequirements,
  DEFAULT_ASSUMPTIONS,
  validateAssumptions,
  worstWindowWh,
  type Assumptions,
  type CatalogueItem,
  type SizingInputs
} from "./lib/sizing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "Site survey, worst month" };

const fridge: LoadLine = {
  name: "Fridge", quantity: 1, powerW: 150, powerFactor: 0.7, surgeW: 750, dutyFactor: 0.4,
  currentType: "ac", critical: true, windows: [{ start: 0, end: 24 }]
};
const lights: LoadLine = {
  name: "Lights", quantity: 5, powerW: 9, currentType: "ac", critical: false, windows: [{ start: 18, end: 23 }]
};
const offGrid: SizingInputs = { systemType: "off_grid", autonomyDays: 1, lines: [fridge, lights] };

const item = (
  id: string, categoryKey: string, specValues: CatalogueItem["specValues"]
): CatalogueItem => ({ id, sku: id.toUpperCase(), name: id, categoryKey, specSchemaVersion: 1, specValues });

const inverterSpecs = {
  topology: "Off-grid", rated_output_power: 3000, rated_output_apparent: 3000, surge_power: 6000,
  surge_duration: 5, phase: "Single-phase", battery_voltage: 48, max_pv_input_power: 4000,
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
const catalogue = (over: { inv?: object; bat?: object; pan?: object } = {}) => [
  item("inv1", "inverter", { ...inverterSpecs, ...over.inv }),
  item("bat1", "battery", { ...batterySpecs, ...over.bat }),
  item("pan1", "pv_panel", { ...panelSpecs, ...over.pan })
];
const build = (cat: CatalogueItem[], inputs = offGrid) =>
  buildCandidates(inputs, computeRequirements(inputs, assumptions), assumptions, cat);

describe("requirements", () => {
  test("off-grid energy, PV and inverter requirements follow the documented formulas", () => {
    const r = computeRequirements(offGrid, assumptions);
    // Fridge 150 W x 24 h x 0.4 = 1440 Wh; lights 5 x 9 W x 5 h = 225 Wh.
    expect(r.dailyEnergyWh).toBe(1665);
    expect(r.batteryDeliveredWh).toBe(1665);
    // Daytime 720 Wh + night 945 Wh / 0.9 = 1770 Wh; / (4 h x 0.75) = 590 Wp.
    expect(r.pvEnergyWh).toBe(1770);
    expect(r.pvWp).toBe(590);
    // Evening peak: fridge 60 W + lights 45 W; surge adds the fridge's 600 W start-up excess.
    expect(r.acPeakW).toBe(105);
    expect(r.acSurgePeakW).toBe(705);
    expect(r.requiredInverterW).toBe(126);
    expect(r.blockers).toEqual([]);
  });

  test("hybrid backup uses the worst window of the critical-load profile", () => {
    const r = computeRequirements({ systemType: "hybrid", backupHours: 4, lines: [fridge, lights] }, assumptions);
    // Critical load is the fridge alone at 60 W: 4 h x 60 W = 240 Wh.
    expect(r.batteryDeliveredWh).toBe(240);
    expect(worstWindowWh([0, 0, 100, 100, 0, ...new Array(19).fill(0)], 2)).toBe(200);
    expect(worstWindowWh([100, ...new Array(22).fill(0), 100], 2)).toBe(200); // wraps midnight
  });

  test("blocks, rather than guesses, when sizing inputs are missing", () => {
    expect(computeRequirements({ systemType: "off_grid", lines: [fridge] }, assumptions).blockers.join()).toMatch(/autonomy/);
    expect(computeRequirements({ systemType: "hybrid", lines: [fridge] }, assumptions).blockers.join()).toMatch(/backup hours/);
    expect(computeRequirements({ systemType: "off_grid", autonomyDays: 1, lines: [] }, assumptions).blockers.join()).toMatch(/no appliances/);
    const dc: LoadLine = { ...lights, currentType: "dc" };
    expect(computeRequirements({ systemType: "off_grid", autonomyDays: 1, lines: [dc] }, assumptions).blockers.join()).toMatch(/DC-only/);
  });

  test("grid-tied has no battery and warns about outages", () => {
    const r = computeRequirements({ systemType: "grid_tied", lines: [lights] }, assumptions);
    expect(r.batteryDeliveredWh).toBeNull();
    expect(r.warnings.join()).toMatch(/outage/);
  });

  test("assumptions are range-checked", () => {
    expect(validateAssumptions(assumptions)).toBeNull();
    expect(validateAssumptions({ ...assumptions, peakSunHours: 0 })).toMatch(/sun hours/);
    expect(validateAssumptions({ ...assumptions, performanceRatio: 1.4 })).toMatch(/Performance/);
    expect(validateAssumptions({ ...assumptions, solarResourceSource: " " })).toMatch(/where/);
    expect(validateAssumptions({ ...assumptions, inverterHeadroom: 0.9 })).toMatch(/headroom/);
  });
});

describe("candidate configurations", () => {
  test("a fully specified set is compatible with hand-checked counts", () => {
    const result = build(catalogue());
    expect(result.status).toBe("ok");
    const c = result.candidates[0];
    // The fridge compressor has a start-up surge whose duration is unknown, so a technician must confirm it.
    expect(c.status).toBe("requires_review");
    expect(c.checks.filter((k) => k.state !== "pass").map((k) => k.id)).toEqual(["inverter_surge"]);
    // 1665 Wh / (0.8 x 0.95) = 2191 Wh nominal, one 48 V 100 Ah (4800 Wh) battery is enough.
    expect(c.counts.batteries).toBe(1);
    // 590 Wp needs 2 x 550 W panels; 2 in series sit inside the MPPT window.
    expect(c.counts).toMatchObject({ panels: 2, panelsPerString: 2, parallelStrings: 1, arrayWp: 1100 });
  });

  test("loads with no start-up surge give a fully compatible set", () => {
    const inputs: SizingInputs = { systemType: "off_grid", autonomyDays: 1, lines: [lights] };
    const c = build(catalogue(), inputs).candidates[0];
    expect(c.status).toBe("compatible");
    expect(c.checks.every((k) => k.state === "pass")).toBe(true);
  });

  test("results are reproducible", () => {
    expect(build(catalogue())).toEqual(build(catalogue()));
  });

  test("a missing critical specification means requires_review, never a pass", () => {
    const { surge_power: _s, ...noSurge } = inverterSpecs;
    void _s;
    const cat = [
      item("inv1", "inverter", noSurge),
      item("bat1", "battery", batterySpecs),
      item("pan1", "pv_panel", panelSpecs)
    ];
    const c = build(cat).candidates[0];
    expect(c.status).toBe("requires_review");
    expect(c.checks.find((k) => k.id === "inverter_surge")?.state).toBe("review");

    const { voc_temp_coeff: _v, ...noCoeff } = panelSpecs;
    void _v;
    const c2 = build([item("inv1", "inverter", inverterSpecs), item("bat1", "battery", batterySpecs), item("pan1", "pv_panel", noCoeff)]).candidates[0];
    expect(c2.status).toBe("requires_review");
    expect(c2.checks.find((k) => k.id === "pv_temp")?.state).toBe("review");
  });

  test("a product that cannot be sized is rejected with the reason", () => {
    const { rated_power: _r, ...noPower } = panelSpecs;
    void _r;
    const result = build([item("inv1", "inverter", inverterSpecs), item("bat1", "battery", batterySpecs), item("pan1", "pv_panel", noPower)]);
    expect(result.status).toBe("no_candidates");
    expect(result.rejected[0].reason).toMatch(/no rated power/);
  });

  test("hard limits exclude a combination", () => {
    // Inverter too small for the load.
    expect(build(catalogue({ inv: { rated_output_power: 100 } })).rejected[0].reason).toMatch(/below the required/);
    // Wrong topology for an off-grid system.
    expect(build(catalogue({ inv: { topology: "Grid-connected" } })).rejected[0].reason).toMatch(/does not suit/);
    // 12 V batteries cannot make an odd bus; 36 V into 48 V is not whole.
    expect(build(catalogue({ bat: { nominal_voltage: 36 } })).rejected[0].reason).toMatch(/cannot make up/);
    // Array larger than the inverter's PV input.
    expect(build(catalogue({ inv: { max_pv_input_power: 500 } })).rejected[0].reason).toMatch(/exceeds/);
    // Panel voltage that cannot form a string in the MPPT window.
    expect(build(catalogue({ inv: { mppt_min_voltage: 380 } })).rejected[0].reason).toMatch(/cannot form a string/);
  });

  test("series batteries make up the bus and batteries are added for capacity", () => {
    const result = build(catalogue({ bat: { nominal_voltage: 12, capacity_ah: 10, recommended_dod: 50 } }));
    const c = result.candidates[0];
    // 1665 / (0.5 x 0.95) = 3505 Wh; one 4-in-series string stores 48 x 10 = 480 Wh, so 8 strings.
    expect(c.counts).toMatchObject({ batteriesInSeries: 4, batteryStrings: 8, batteries: 32 });
  });

  test("lithium without a BMS needs review; excess charge current needs review", () => {
    const c = build(catalogue({ bat: { has_bms: false, max_charge_current: 30 } })).candidates[0];
    expect(c.status).toBe("requires_review");
    expect(c.checks.find((k) => k.id === "battery_bms")?.state).toBe("review");
    expect(c.checks.find((k) => k.id === "battery_charge")?.state).toBe("review");
  });

  test("reports a clear message when the catalogue lacks a category, and blockers stop everything", () => {
    expect(build([item("inv1", "inverter", inverterSpecs)]).messages.join()).toMatch(/No active batteries/);
    const blocked = build(catalogue(), { systemType: "off_grid", lines: [fridge] });
    expect(blocked.status).toBe("blocked");
    expect(blocked.candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------- stored runs

type T = ReturnType<typeof convexTest>;
async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active",
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

const apiLine = (l: LoadLine) => ({ ...l, powerSource: "nameplate" as const });
const apiAssumptions = assumptions;

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await internal_bootstrap(t);
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [["agent@acme.ug", "sales_agent"], ["tech@acme.ug", "technician"]] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const make = async (key: string, sku: string, specValues: Record<string, number | string | boolean>) => {
    const category = cats.find((c) => c.key === key)!;
    await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: category.id, name: sku, brand: "B", model: sku, sku, specValues
    });
  };
  await make("inverter", "INV-3K", { ...inverterSpecs, output_voltage: 230 });
  await make("battery", "BAT-4.8", batterySpecs);
  await make("pv_panel", "PV-550", panelSpecs);

  const agent = as("agent@acme.ug");
  const { customerId } = await agent.mutation(api.customers.createCustomer, {
    tenantId, name: "Farm", phone: "+256 700 000111", type: "agricultural"
  });
  const { siteId } = await agent.mutation(api.customers.createSite, {
    customerId, name: "Main", address: "A", region: "R", gpsConsent: false, gridAvailability: "none"
  });
  const { assessmentId } = await agent.mutation(api.assessments.createAssessment, { customerId, siteId });
  return { t, tenantId, asOwner, agent, tech: as("tech@acme.ug"), assessmentId };
}
const internal_bootstrap = (t: T) =>
  t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug" });

describe("sizing runs", () => {
  test("need a completed assessment, store everything, and flag stale runs", async () => {
    const c = await setup();
    await expect(
      c.agent.mutation(api.sizing.runSizing, { assessmentId: c.assessmentId, assumptions: apiAssumptions })
    ).rejects.toThrow(/Complete the assessment/);

    await c.agent.mutation(api.assessments.saveAssessment, {
      assessmentId: c.assessmentId, expectedRevision: 1,
      inputs: { systemType: "off_grid", autonomyDays: 1, lines: [apiLine(fridge), apiLine(lights)].map((l) => ({
        ...l, dutyJustification: l.dutyFactor ? "Compressor cycles" : undefined
      })) }
    });
    await c.agent.mutation(api.assessments.completeAssessment, { assessmentId: c.assessmentId });

    await expect(
      c.agent.mutation(api.sizing.runSizing, {
        assessmentId: c.assessmentId, assumptions: { ...apiAssumptions, peakSunHours: 20 }
      })
    ).rejects.toThrow(/sun hours/);

    const { runId, status } = await c.agent.mutation(api.sizing.runSizing, {
      assessmentId: c.assessmentId, assumptions: apiAssumptions
    });
    expect(status).toBe("ok");

    const view = await c.agent.query(api.sizing.getSizing, { assessmentId: c.assessmentId });
    expect(view.run?.id).toBe(runId);
    expect(view.run?.requirements.pvWp).toBe(590);
    expect(view.run?.outcome.candidates[0].status).toBe("requires_review");
    expect(view.run?.products.map((p) => p.sku).sort()).toEqual(["BAT-4.8", "INV-3K", "PV-550"]);
    expect(view.run?.stale).toBe(false);
    expect(view.canResolve).toBe(false);

    // Reopening and saving a new revision leaves the earlier run, marked stale.
    await c.agent.mutation(api.assessments.reopenAssessment, { assessmentId: c.assessmentId });
    await c.agent.mutation(api.assessments.saveAssessment, {
      assessmentId: c.assessmentId, expectedRevision: 2,
      inputs: { systemType: "off_grid", autonomyDays: 2, lines: [apiLine(lights)] }
    });
    expect((await c.agent.query(api.sizing.getSizing, { assessmentId: c.assessmentId })).run?.stale).toBe(true);
  });

  test("only technicians resolve checks that need review, once, with a note", async () => {
    const c = await setup();
    // A single-phase check passes, so force a review via a three-phase inverter.
    await c.t.run(async (ctx) => {
      const inverter = (await ctx.db.query("products").collect()).find((p) => p.sku === "INV-3K")!;
      await ctx.db.patch(inverter._id, { specValues: { ...inverter.specValues, phase: "Three-phase" } });
    });
    await c.agent.mutation(api.assessments.saveAssessment, {
      assessmentId: c.assessmentId, expectedRevision: 1,
      inputs: { systemType: "off_grid", autonomyDays: 1, lines: [apiLine(lights)] }
    });
    await c.agent.mutation(api.assessments.completeAssessment, { assessmentId: c.assessmentId });
    const { runId } = await c.agent.mutation(api.sizing.runSizing, {
      assessmentId: c.assessmentId, assumptions: apiAssumptions
    });

    const view = await c.tech.query(api.sizing.getSizing, { assessmentId: c.assessmentId });
    expect(view.run?.outcome.candidates[0].status).toBe("requires_review");
    expect(view.canResolve).toBe(true);

    const args = { runId, candidateIndex: 0, checkId: "phase", note: "Site is three-phase; confirmed on survey." };
    await expect(c.agent.mutation(api.sizing.resolveCheck, args)).rejects.toThrow(/role/);
    await expect(c.tech.mutation(api.sizing.resolveCheck, { ...args, note: " " })).rejects.toThrow(/required/);
    await expect(c.tech.mutation(api.sizing.resolveCheck, { ...args, checkId: "topology" })).rejects.toThrow(/need review/);
    await c.tech.mutation(api.sizing.resolveCheck, args);
    await expect(c.tech.mutation(api.sizing.resolveCheck, args)).rejects.toThrow(/already/);

    const after = await c.tech.query(api.sizing.getSizing, { assessmentId: c.assessmentId });
    expect(after.run?.resolutions).toHaveLength(1);
  });
});
