/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TECHNICIAN_CHECKLIST } from "./lib/quote";
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
  topology: "Hybrid", rated_output_power: 5000, rated_output_apparent: 5000, surge_power: 10000,
  surge_duration: 5, phase: "Single-phase", output_voltage: 230, battery_voltage: 48, max_pv_input_power: 6000,
  max_pv_voltage: 500, mppt_min_voltage: 120, mppt_max_voltage: 450, max_pv_current: 27,
  mppt_count: 1, max_charge_current: 100, efficiency: 97
};
const batterySpecs = {
  chemistry: "LiFePO4", nominal_voltage: 51.2, capacity_ah: 100, max_discharge_current: 100,
  max_charge_current: 50, recommended_dod: 90, has_bms: true, cycle_life: 6000
};
const panelSpecs = {
  rated_power: 330, voc: 45.5, vmp: 37.6, isc: 9.3, imp: 8.8, voc_temp_coeff: -0.3, max_system_voltage: 1000
};
const controllerSpecs = {
  technology: "MPPT", battery_voltage: 48, max_pv_voltage: 150, max_pv_power: 3400, max_charge_current: 60
};

/** An older off-grid home: PWM controller, 4 x 330 W panels, 4 x 12 V 200 Ah lead-acid, 3 kW inverter. */
const system = {
  systemType: "off_grid" as const,
  systemVoltage: 48,
  inverter: { ratedW: 3000, hasSolarInput: false, maxChargeA: 40 },
  controller: { technology: "PWM" as const, maxChargeA: 40, maxPvVoltage: 150 },
  panels: { count: 4, wp: 330, voc: 45.5, vmp: 37.6, isc: 9.3, perString: 2 },
  batteries: { count: 4, nominalV: 12, ah: 200, chemistry: "lead_acid" as const, ageYears: 3 }
};
const needs = {
  goals: ["battery" as const, "panels" as const, "inverter" as const],
  dailyKwh: 8, peakLoadW: 3500, backupHours: 8, backupLoadW: 800
};
const BATTERY = "battery:replace:";
const CONTROLLER = "controller:replace:";

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["agent@acme.ug", "sales_agent"], ["other@acme.ug", "sales_agent"], ["mgr@acme.ug", "sales_manager"],
    ["tech@acme.ug", "technician"], ["stock@acme.ug", "inventory_admin"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });

  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const make = async (key: string, sku: string, cost: number, specValues: Record<string, number | string | boolean>) => {
    const { productId } = await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: cats.find((c) => c.key === key)!.id, name: sku, brand: "Brand", model: sku, sku, specValues
    });
    await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: cost });
    return productId;
  };
  const products = {
    inverter: await make("inverter", "INV-5K", 4_000_000, inverterSpecs),
    battery: await make("battery", "BAT-LI", 3_000_000, batterySpecs),
    panel: await make("pv_panel", "PV-330", 400_000, panelSpecs),
    controller: await make("charge_controller", "MPPT-60", 800_000, controllerSpecs)
  };
  await asOwner.mutation(api.margins.setMarginRule, { tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10 });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });

  const agent = as("agent@acme.ug");
  const { customerId } = await agent.mutation(api.customers.createCustomer, {
    tenantId, name: "Nakato", phone: "+256 700 000111", type: "residential"
  });
  const { siteId } = await agent.mutation(api.customers.createSite, {
    customerId, name: "Home", address: "Kamuli", region: "Busoga", gpsConsent: false, gridAvailability: "none"
  });
  return {
    t, tenantId, asOwner, agent, other: as("other@acme.ug"), mgr: as("mgr@acme.ug"), tech: as("tech@acme.ug"),
    stock: as("stock@acme.ug"), customerId, siteId, products
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const save = async (c: Ctx) =>
  (await c.agent.mutation(api.upgrades.saveStudy, { customerId: c.customerId, siteId: c.siteId, system, needs })).studyId;
const quote = (c: Ctx, studyId: Id<"upgradeStudies">, optionKeys: string[]) =>
  c.agent.mutation(api.quotations.createFromUpgradeStudy, { studyId, optionKeys });
const checklist = TECHNICIAN_CHECKLIST.map((i) => ({ key: i.key, confirmed: true }));

describe("running an upgrade check", () => {
  test("staff see today's list prices; the public never sees a price", async () => {
    const c = await setup();
    const report = await c.agent.query(api.upgrades.simulate, { tenantId: c.tenantId, system, needs });
    expect(report.blockers).toEqual([]);
    expect(report.sections.map((s) => s.area)).toEqual(["battery", "panels", "inverter", "controller"]);
    const battery = report.sections[0].options.find((o) => o.key === BATTERY + c.products.battery)!;
    // Two 51.2 V 100 Ah batteries for 8 h at 800 W; cost 3,000,000 x 1.25 each.
    expect(battery.quantity).toBe(2);
    expect(battery.sku).toBe("BAT-LI");
    expect(battery.unitListMinor).toBe(3_750_000);
    expect(battery.totalMinor).toBe(7_500_000);
    // Cost and floor prices never reach the browser.
    expect(JSON.stringify(report)).not.toMatch(/floor|costMinor|amountMinor/);

    const open = await c.t.query(api.upgrades.publicSimulate, { system, needs });
    const shown = open.sections.flatMap((s) => s.options);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((o) => o.unitListMinor === null && o.totalMinor === null)).toBe(true);
  });

  test("an impossible description is refused with the reason", async () => {
    const c = await setup();
    await expect(
      c.agent.query(api.upgrades.simulate, { tenantId: c.tenantId, system: { systemType: "off_grid" }, needs })
    ).rejects.toThrow(/at least one part/);
  });

  test("stock staff have no access to customer studies", async () => {
    const c = await setup();
    await expect(c.stock.query(api.upgrades.simulate, { tenantId: c.tenantId, system, needs })).rejects.toThrow();
    await expect(c.stock.query(api.upgrades.listStudies, { tenantId: c.tenantId })).rejects.toThrow();
  });
});

describe("saved studies", () => {
  test("a study belongs to the customer's owner; another agent cannot open it", async () => {
    const c = await setup();
    const studyId = await save(c);
    const study = await c.agent.query(api.upgrades.getStudy, { studyId });
    expect(study.customerName).toBe("Nakato");
    expect(study.verification).toBeNull();
    expect(study.can).toEqual({ quote: true, verify: false });
    expect((await c.agent.query(api.upgrades.listStudies, { tenantId: c.tenantId })).studies).toHaveLength(1);

    await expect(c.other.query(api.upgrades.getStudy, { studyId })).rejects.toThrow(/not found/);
    expect((await c.other.query(api.upgrades.listStudies, { tenantId: c.tenantId })).studies).toHaveLength(0);
    await expect(
      c.other.mutation(api.upgrades.saveStudy, { customerId: c.customerId, siteId: c.siteId, system, needs })
    ).rejects.toThrow(/Customer not found/);
    // Technicians and managers see every study.
    expect((await c.tech.query(api.upgrades.getStudy, { studyId })).can.verify).toBe(true);
  });

  test("only a technician records verification, once, with a note", async () => {
    const c = await setup();
    const studyId = await save(c);
    await expect(c.agent.mutation(api.upgrades.verifyStudy, { studyId, note: "Looks fine" })).rejects.toThrow();
    await expect(c.tech.mutation(api.upgrades.verifyStudy, { studyId, note: "  " })).rejects.toThrow(/required/);
    await c.tech.mutation(api.upgrades.verifyStudy, { studyId, note: "Nameplates photographed on site." });
    const study = await c.agent.query(api.upgrades.getStudy, { studyId });
    expect(study.verification?.note).toBe("Nameplates photographed on site.");
    expect(study.verification?.verifierName).toBe("tech");
    await expect(c.tech.mutation(api.upgrades.verifyStudy, { studyId, note: "Again" })).rejects.toThrow(/already been verified/);
  });
});

describe("quotations from a study", () => {
  test("chosen options become priced lines", async () => {
    const c = await setup();
    const studyId = await save(c);
    const { quotationId } = await quote(c, studyId, [BATTERY + c.products.battery, CONTROLLER + c.products.controller]);
    const q = await c.agent.query(api.quotations.getQuotation, { quotationId });
    expect(q.shown.lines.map((l) => [l.sku, l.quantity, l.unitPriceMinor])).toEqual([
      ["BAT-LI", 2, 3_750_000], ["MPPT-60", 1, 1_000_000]
    ]);
    expect(q.shown.totalMinor).toBe(8_500_000);
    expect(q.quotation.status).toBe("draft");
    expect(q.quotation.upgradeStudyId).toBe(studyId);
    expect(q.quotation.assessmentId).toBeNull();
    expect(q.sizing).toMatchObject({ basis: "upgrade", stale: false, openReviews: 1 });
    expect((await c.agent.query(api.upgrades.getStudy, { studyId })).quotations.map((x) => x.id)).toEqual([quotationId]);
  });

  test("selections are validated against the study", async () => {
    const c = await setup();
    const studyId = await save(c);
    await expect(quote(c, studyId, [])).rejects.toThrow(/at least one option/);
    await expect(quote(c, studyId, ["battery:replace:made-up"])).rejects.toThrow(/not part of this study/);
    const study = await c.agent.query(api.upgrades.getStudy, { studyId });
    const paired = study.report.sections.find((s) => s.area === "panels")!.options.find((o) => o.requires)!;
    // Panels that only fit on the new controller cannot be quoted without it.
    await expect(quote(c, studyId, [paired.key])).rejects.toThrow(/only works together/);
    await quote(c, studyId, [paired.key, paired.requires!]);
    await expect(c.other.mutation(api.quotations.createFromUpgradeStudy, { studyId, optionKeys: [paired.key] })).rejects.toThrow(/not found/);
  });

  test("it cannot be approved until a technician has verified the existing system", async () => {
    const c = await setup();
    const studyId = await save(c);
    const { quotationId } = await quote(c, studyId, [BATTERY + c.products.battery]);
    await c.agent.mutation(api.quotations.submitForReview, { quotationId });
    await c.tech.mutation(api.quotations.startReview, { quotationId });
    const decide = () =>
      c.tech.mutation(api.quotations.decideTechnical, { quotationId, revision: 1, outcome: "approved", checklist });
    await expect(decide()).rejects.toThrow(/ratings were verified/);

    await c.tech.mutation(api.upgrades.verifyStudy, { studyId, note: "Checked the bank and controller on site." });
    expect((await decide()).status).toBe("ready_for_official_issue");
    const q = await c.agent.query(api.quotations.getQuotation, { quotationId });
    expect(q.sizing.openReviews).toBe(0);
  });

});

describe("public upgrade requests", () => {
  const person = { name: "Okello James", phone: "+256 701 222333", location: "Jinja" };

  test("a request stores the described system and becomes a study when converted", async () => {
    const c = await setup();
    const open = await c.t.query(api.upgrades.publicSimulate, { system, needs });
    const paired = open.sections.find((s) => s.area === "panels")!.options.find((o) => o.requires)!;
    const sent = await c.t.mutation(api.upgrades.submitUpgradeRequest, {
      system, needs, grid: "none", optionKeys: [paired.key], ...person
    });
    expect(sent.ok).toBe(true);
    expect(sent.claimToken).toBeTruthy();

    const { leads } = await c.mgr.query(api.leads.listLeads, { tenantId: c.tenantId });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ isUpgrade: true, inputMode: "existing_system", name: "Okello James" });
    // The controller the panels depend on was brought along.
    expect(leads[0].components.map((x) => x.role).sort()).toEqual(["Charge controller", "Solar panel"]);

    const forLead = await c.tech.query(api.upgrades.forLead, { leadId: leads[0].id });
    expect(forLead?.report.sections.length).toBeGreaterThan(0);

    // There is no appliance list, so it cannot become an assessment.
    await expect(c.mgr.mutation(api.leads.convertLead, { leadId: leads[0].id })).rejects.toThrow(/upgrade study/);
    const converted = await c.mgr.mutation(api.leads.convertUpgradeLead, { leadId: leads[0].id });
    const study = await c.mgr.query(api.upgrades.getStudy, { studyId: converted.upgradeStudyId });
    expect(study.customerName).toBe("Okello James");
    expect(study.system.systemVoltage).toBe(48);
    await expect(c.mgr.mutation(api.leads.convertUpgradeLead, { leadId: leads[0].id })).rejects.toThrow(/already converted/);
  });

  test("bots, bad phones and unknown options are turned away", async () => {
    const c = await setup();
    const send = (over: object) =>
      c.t.mutation(api.upgrades.submitUpgradeRequest, { system, needs, grid: "none", optionKeys: [], ...person, ...over });
    expect((await send({ website: "http://spam.example" })).requestId).toBeNull();
    await expect(send({ phone: "abc" })).rejects.toThrow(/phone/);
    await expect(send({ optionKeys: ["battery:replace:nope"] })).rejects.toThrow(/no longer available/);
    expect((await c.mgr.query(api.leads.listLeads, { tenantId: c.tenantId })).leads).toHaveLength(0);
  });

  test("it is closed when the public power check is switched off", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId: c.tenantId, enabled: false, tariffPerKwh: 800 });
    expect((await c.t.query(api.upgrades.publicConfig, {})).enabled).toBe(false);
    await expect(c.t.query(api.upgrades.publicSimulate, { system, needs })).rejects.toThrow(/not available/);
  });
});
