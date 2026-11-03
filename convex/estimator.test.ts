/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { summariseAppliances, summariseBill, windowsForHours } from "./lib/estimate";
import { APPLIANCE_GUIDE, searchGuide } from "./lib/applianceGuide";
import { DEFAULT_ASSUMPTIONS } from "./lib/sizing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
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

async function setup(withCatalogue = true) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["agent@acme.ug", "sales_agent"], ["other@acme.ug", "sales_agent"],
    ["mgr@acme.ug", "sales_manager"], ["tech@acme.ug", "technician"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });

  if (withCatalogue) {
    await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
    const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
    const make = async (key: string, sku: string, cost: number, specValues: Record<string, number | string | boolean>) => {
      const { productId } = await asOwner.mutation(api.products.createProduct, {
        tenantId, categoryId: cats.find((c) => c.key === key)!.id, name: sku, brand: "Brand", model: sku, sku, specValues
      });
      await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: cost });
    };
    await make("inverter", "INV-3K", 2_000_000, inverterSpecs);
    await make("battery", "BAT-4.8", 3_000_000, batterySpecs);
    await make("pv_panel", "PV-550", 500_000, panelSpecs);
    await asOwner.mutation(api.margins.setMarginRule, { tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10 });
  }
  await asOwner.mutation(api.estimator.updateEstimatorSettings, {
    tenantId, enabled: true, tariffPerKwh: 800, contactPhone: "+256 700 000000"
  });
  return {
    t, tenantId, asOwner, agent: as("agent@acme.ug"), other: as("other@acme.ug"),
    mgr: as("mgr@acme.ug"), tech: as("tech@acme.ug"), people
  };
}

const bill = { mode: "bill" as const, units: 300, days: 30, amount: 240_000 };
const applianceInput = {
  mode: "appliances" as const,
  items: [
    { name: "LED bulb", quantity: 5, hoursPerDay: 5 },
    { name: "Refrigerator (medium)", quantity: 1, hoursPerDay: 24 }
  ]
};
const person = { name: "Amina K", phone: "+256 700 111222", location: "Kampala, Ntinda" };

describe("estimate maths", () => {
  test("a bill gives daily units, the rate actually paid and the monthly cost", () => {
    const { summary } = summariseBill({ units: 300, days: 30, amountMinor: 240_000 }, 1000);
    expect(summary.dailyKwh).toBe(10);
    expect(summary.ratePerKwhMinor).toBe(800); // the customer's own rate beats the company tariff
    expect(summary.costPerDayMinor).toBe(8000);
    expect(summary.costPerMonthMinor).toBe(240_000);
  });

  test("a bill without an amount falls back to the company tariff", () => {
    const { summary } = summariseBill({ units: 150, days: 30 }, 800);
    expect(summary.dailyKwh).toBe(5);
    expect(summary.costPerDayMinor).toBe(4000);
  });

  test("appliance energy is quantity x watts x hours", () => {
    const { summary } = summariseAppliances(
      [{ name: "Lights", quantity: 5, powerW: 9, hoursPerDay: 5, currentType: "ac" }], 800
    );
    expect(summary.dailyKwh).toBe(0.23); // 225 Wh
    expect(summary.costPerDayMinor).toBe(180);
  });

  test("part-hours and long hours keep their energy", () => {
    const { summary } = summariseAppliances(
      [{ name: "Router", quantity: 1, powerW: 12, hoursPerDay: 24, currentType: "ac" },
       { name: "Iron", quantity: 1, powerW: 1000, hoursPerDay: 0.5, currentType: "ac" }], null
    );
    expect(summary.dailyKwh).toBe(0.79); // 288 Wh + 500 Wh
    expect(summary.costPerDayMinor).toBeNull();
    expect(windowsForHours(24)).toEqual([{ start: 0, end: 24 }]);
  });
});

describe("appliance guide", () => {
  test("search finds appliances by the words people type", () => {
    expect(searchGuide("fridge")[0].key).toBe("fridge");
    expect(searchGuide("tv")[0].key).toBe("tv");
    expect(searchGuide("borehole")[0].key).toBe("borehole_pump");
    expect(searchGuide("")).toEqual([]);
  });

  test("every guide entry has a valid default size and sane numbers", () => {
    for (const g of APPLIANCE_GUIDE) {
      expect(g.sizes[g.defaultSize]).toBeDefined();
      for (const s of g.sizes) expect(s.powerW).toBeGreaterThan(0);
      expect(g.defaultHours).toBeGreaterThan(0);
      expect(g.defaultHours).toBeLessThanOrEqual(24);
      if (g.duty !== undefined) expect(g.duty).toBeGreaterThan(0);
    }
  });

  test("a fridge on 24 hours counts only its running share", () => {
    const { summary } = summariseAppliances(
      [{ name: "Fridge", quantity: 1, powerW: 150, hoursPerDay: 24, currentType: "ac", duty: 0.4 }], null
    );
    expect(summary.dailyKwh).toBe(1.44);
  });
});

describe("public power check", () => {
  test("is closed until a company switches it on", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.estimator.publicConfig, {})).toEqual({ enabled: false });
    await expect(t.query(api.estimator.recommend, { input: bill, grid: "reliable" })).rejects.toThrow(/not available/);
  });

  test("anyone can read the config and get options without signing in", async () => {
    const { t } = await setup();
    const config = await t.query(api.estimator.publicConfig, {});
    expect(config).toMatchObject({ enabled: true, companyName: "Acme Solar", currency: "UGX", exponent: 0, tariffMinorPerKwh: 800 });
    if (!config.enabled) throw new Error("expected enabled");
    expect(config.appliances.length).toBeGreaterThan(10);

    const result = await t.query(api.estimator.recommend, { input: applianceInput, grid: "unreliable" });
    expect(result.summary.dailyKwh).toBeGreaterThan(0);
    expect(result.summary.costPerMonthMinor).toBeGreaterThan(0);
    expect(result.options.length).toBeGreaterThan(0);
    const first = result.options[0];
    expect(first.components.map((c) => c.role)).toContain("Inverter");
    expect(first.components.every((c) => c.quantity >= 1)).toBe(true);
  });

  test("no option or request ever carries a price", async () => {
    const { t } = await setup();
    const result = await t.query(api.estimator.recommend, { input: bill, grid: "unreliable" });
    expect(result.options.length).toBeGreaterThan(0);
    // offsetPerMonthMinor is the customer's own electricity cost, never a system price.
    const optionsJson = JSON.stringify(result.options).replace(/offsetPerMonthMinor/g, "").toLowerCase();
    for (const word of ["price", "margin", "floor", "unitlist", "costrecord", "ugx"]) {
      expect(optionsJson).not.toContain(word);
    }
    await t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: result.options[0].key, ...person });
    const rows = await t.run((ctx) => ctx.db.query("quoteRequests").collect());
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].components).toLowerCase()).not.toMatch(/price|margin|floor/);
  });

  test("asks a technician to recommend a system when no option is shown", async () => {
    const { t, tenantId, tech, agent } = await setup(false);
    const result = await t.query(api.estimator.recommend, { input: bill, grid: "none" });
    expect(result.options).toEqual([]);
    await t.mutation(api.estimator.submitRequest, { input: bill, grid: "none", optionKey: "recommendation", ...person });
    const [row] = await t.run((ctx) => ctx.db.query("quoteRequests").collect());
    expect(row).toMatchObject({ optionKey: "recommendation", systemType: "off_grid", components: [], status: "new" });

    // Technicians see it to design a system, but do not convert or assign it.
    const forTech = await tech.query(api.leads.listLeads, { tenantId });
    expect(forTech.leads[0]).toMatchObject({ isRecommendation: true });
    expect(forTech).toMatchObject({ canAct: false, canAssign: false });
    await expect(tech.mutation(api.leads.convertLead, { leadId: row._id })).rejects.toThrow();
    // An unassigned agent still sees only their own requests.
    expect((await agent.query(api.leads.listLeads, { tenantId })).leads).toHaveLength(0);
    await expect(
      t.mutation(api.estimator.submitRequest, { input: bill, grid: "none", optionKey: "made_up", ...person })
    ).rejects.toThrow(/Choose one/);
  });

  test("shows no options rather than failing when the catalogue is empty", async () => {
    const { t } = await setup(false);
    const result = await t.query(api.estimator.recommend, { input: bill, grid: "reliable" });
    expect(result.options).toEqual([]);
    expect(result.unavailable.length).toBeGreaterThan(0);
  });

  test("uses the chosen size, the customer's own watts, and accepts appliances not on the list", async () => {
    const { t } = await setup();
    const run = (items: object[]) =>
      t.query(api.estimator.recommend, { input: { mode: "appliances", items: items as never, ratePerKwh: 1000 }, grid: "reliable" });
    // 55 in TV is 120 W typical: 120 W x 4 h = 0.48 kWh.
    const sized = await run([{ name: "Television", guideKey: "tv", size: "55 in", quantity: 1, hoursPerDay: 4 }]);
    expect(sized.summary.dailyKwh).toBe(0.48);
    // The label says 90 W: 90 W x 4 h = 0.36 kWh.
    const own = await run([{ name: "Television", guideKey: "tv", size: "55 in", powerW: 90, quantity: 1, hoursPerDay: 4 }]);
    expect(own.summary.dailyKwh).toBe(0.36);
    // Two TVs of different sizes are fine, and so is something we have never heard of.
    const mixed = await run([
      { name: "Television", guideKey: "tv", size: "32 in", quantity: 1, hoursPerDay: 2 },
      { name: "Television", guideKey: "tv", size: "65 in", quantity: 1, hoursPerDay: 2 },
      { name: "Popcorn machine", powerW: 500, quantity: 1, hoursPerDay: 2 }
    ]);
    expect(mixed.summary.dailyKwh).toBe(1.42); // 0.1 + 0.32 + 1.0
  });

  test("asks for watts on unknown appliances and rejects bad numbers", async () => {
    const { t } = await setup();
    const call = (input: object) => t.query(api.estimator.recommend, { input: input as never, grid: "reliable" });
    await expect(call({ mode: "appliances", items: [{ name: "Death ray", quantity: 1, hoursPerDay: 1 }] })).rejects.toThrow(/watts/);
    await expect(call({ mode: "appliances", items: [{ name: "Death ray", quantity: 1, hoursPerDay: 1, powerW: 999_999 }] })).rejects.toThrow(/power/);
    await expect(call({ mode: "appliances", items: [] })).rejects.toThrow(/at least one/);
    await expect(call({ mode: "appliances", items: [{ name: "LED bulb", quantity: 0, hoursPerDay: 1 }] })).rejects.toThrow(/how many/);
    await expect(call({ mode: "appliances", items: [{ name: "LED bulb", quantity: 1, hoursPerDay: 30 }] })).rejects.toThrow(/hours/);
    await expect(call({ mode: "bill", units: -5, days: 30 })).rejects.toThrow(/Units/);
    await expect(call({ mode: "bill", units: 100, days: 0 })).rejects.toThrow(/days/);
  });

  test("a request needs a valid phone and a real option, and is recomputed on the server", async () => {
    const { t } = await setup();
    const result = await t.query(api.estimator.recommend, { input: bill, grid: "unreliable" });
    const key = result.options[0].key;
    await expect(t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: key, ...person, phone: "abc" })).rejects.toThrow(/phone/);
    await expect(t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: "free_solar", ...person })).rejects.toThrow(/option/);
    // An option that exists in general but is not offered for this grid answer is refused.
    await expect(t.mutation(api.estimator.submitRequest, { input: bill, grid: "none", optionKey: "bill_saver", ...person })).rejects.toThrow(/not available/);
    const ok = await t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: key, ...person });
    expect(ok.ok).toBe(true);
  });

  test("abuse limits: the honeypot is ignored and a phone is capped per day", async () => {
    const { t } = await setup();
    const result = await t.query(api.estimator.recommend, { input: bill, grid: "unreliable" });
    const key = result.options[0].key;
    const submit = () => t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: key, ...person });
    await t.mutation(api.estimator.submitRequest, { input: bill, grid: "unreliable", optionKey: key, ...person, website: "http://spam" });
    expect(await t.run((ctx) => ctx.db.query("quoteRequests").collect())).toHaveLength(0);
    await submit(); await submit(); await submit();
    await expect(submit()).rejects.toThrow(/already have your requests/);
    expect(await t.run((ctx) => ctx.db.query("quoteRequests").collect())).toHaveLength(3);
  });

  test("only the company owner changes settings", async () => {
    const { t, tenantId, mgr, agent } = await setup();
    const args = { tenantId, enabled: true, tariffPerKwh: 900 };
    await expect(mgr.mutation(api.estimator.updateEstimatorSettings, args)).rejects.toThrow(/role/);
    await expect(agent.query(api.estimator.getEstimatorSettings, { tenantId })).rejects.toThrow(/role/);
    expect((await mgr.query(api.estimator.getEstimatorSettings, { tenantId })).tariffMinorPerKwh).toBe(800);
    const stranger = t.withIdentity({ subject: (await registerUser(t, "x@x.ug")).subject });
    await expect(stranger.mutation(api.estimator.updateEstimatorSettings, args)).rejects.toThrow();
  });
});

describe("staff leads", () => {
  async function withLead() {
    const c = await setup();
    const result = await c.t.query(api.estimator.recommend, { input: applianceInput, grid: "unreliable" });
    await c.t.mutation(api.estimator.submitRequest, {
      input: applianceInput, grid: "unreliable", optionKey: result.options[0].key, ...person
    });
    return c;
  }

  test("managers see every request; agents only the ones assigned to them", async () => {
    const { mgr, agent, other, tenantId } = await withLead();
    const all = await mgr.query(api.leads.listLeads, { tenantId });
    expect(all.canAssign).toBe(true);
    expect(all.leads).toHaveLength(1);
    expect(all.leads[0]).toMatchObject({ name: "Amina K", status: "new", location: "Kampala, Ntinda" });
    expect((await agent.query(api.leads.listLeads, { tenantId })).leads).toHaveLength(0);

    const agentUser = (await mgr.query(api.leads.listAssignees, { tenantId })).find((a) => a.name === "agent")!;
    await mgr.mutation(api.leads.assignLead, { leadId: all.leads[0].id, assigneeUserId: agentUser.userId as never });
    expect((await agent.query(api.leads.listLeads, { tenantId })).leads).toHaveLength(1);
    expect((await other.query(api.leads.listLeads, { tenantId })).leads).toHaveLength(0);
    await expect(
      agent.mutation(api.leads.assignLead, { leadId: all.leads[0].id, assigneeUserId: agentUser.userId as never })
    ).rejects.toThrow(/role/);
  });

  test("converting creates a customer, site and completed assessment that can be sized", async () => {
    const { mgr, agent, other, tenantId } = await withLead();
    const lead = (await mgr.query(api.leads.listLeads, { tenantId })).leads[0];
    const agentUser = (await mgr.query(api.leads.listAssignees, { tenantId })).find((a) => a.name === "agent")!;
    await mgr.mutation(api.leads.assignLead, { leadId: lead.id, assigneeUserId: agentUser.userId as never });

    await expect(other.mutation(api.leads.convertLead, { leadId: lead.id })).rejects.toThrow(/not found/);
    const { assessmentId, customerId } = await agent.mutation(api.leads.convertLead, { leadId: lead.id });
    await expect(agent.mutation(api.leads.convertLead, { leadId: lead.id })).rejects.toThrow(/already converted/);

    // The agent owns the new customer and the staff sizing flow works from it unchanged.
    const customers = await agent.query(api.customers.listCustomers, { tenantId });
    expect(JSON.stringify(customers)).toContain(customerId);
    const { status } = await agent.mutation(api.sizing.runSizing, {
      assessmentId, assumptions: { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "Survey" }
    });
    expect(["ok", "no_candidates", "blocked"]).toContain(status);
    expect((await mgr.query(api.leads.listLeads, { tenantId })).leads[0]).toMatchObject({ status: "converted" });
  });

  test("a request can be closed and then cannot be assigned", async () => {
    const { mgr, tenantId } = await withLead();
    const lead = (await mgr.query(api.leads.listLeads, { tenantId })).leads[0];
    await mgr.mutation(api.leads.closeLead, { leadId: lead.id });
    const agentUser = (await mgr.query(api.leads.listAssignees, { tenantId })).find((a) => a.name === "agent")!;
    await expect(
      mgr.mutation(api.leads.assignLead, { leadId: lead.id, assigneeUserId: agentUser.userId as never })
    ).rejects.toThrow(/finished/);
  });
});
