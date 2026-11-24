/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addMonths, applyBps, buildInstallmentPlan } from "./lib/finance";
import { TECHNICIAN_CHECKLIST } from "./lib/quote";
import { DEFAULT_ASSUMPTIONS } from "./lib/sizing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

afterEach(() => vi.useRealTimers());

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
  topology: "Off-grid", rated_output_power: 3000, rated_output_apparent: 3000, surge_power: 6000,
  surge_duration: 5, phase: "Single-phase", battery_voltage: 48, max_pv_input_power: 4000,
  max_pv_voltage: 450, mppt_min_voltage: 60, mppt_max_voltage: 400, max_pv_current: 18,
  mppt_count: 1, max_charge_current: 60, output_voltage: 230
};
const batterySpecs = {
  chemistry: "LiFePO4", nominal_voltage: 48, capacity_ah: 100, max_discharge_current: 100,
  max_charge_current: 60, recommended_dod: 80, has_bms: true
};
const panelSpecs = {
  rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2, voc_temp_coeff: -0.27, max_system_voltage: 1500
};
const lights = {
  name: "Lights", quantity: 5, powerW: 9, powerSource: "nameplate" as const, currentType: "ac" as const,
  critical: false, windows: [{ start: 18, end: 23 }]
};
const assumptions = { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "Survey" };
const checklist = TECHNICIAN_CHECKLIST.map((i) => ({ key: i.key, confirmed: true }));

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["agent@acme.ug", "sales_agent"], ["other@acme.ug", "sales_agent"],
    ["tech@acme.ug", "technician"], ["tech2@acme.ug", "technician"], ["mgr@acme.ug", "sales_manager"],
    ["inv@acme.ug", "inventory_admin"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  // Every agent here reports to the sales manager, who therefore sees their work.
  await t.run(async (ctx) => {
    const mgr = (await ctx.db.query("userProfiles").collect()).find((p) => p.email === "mgr@acme.ug");
    if (!mgr) return;
    for (const m of await ctx.db.query("memberships").collect()) if (m.role === "sales_agent") await ctx.db.patch(m._id, { managerUserId: mgr._id });
  });
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });

  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const { warehouseId } = await asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "Main", code: "MAIN" });
  const make = async (key: string, sku: string, cost: number, specValues: Record<string, number | string | boolean>, warrantyMonths?: number) => {
    const { productId } = await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: cats.find((c) => c.key === key)!.id, name: sku, brand: "B", model: sku, sku, specValues, warrantyMonths
    });
    await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: cost });
    await asOwner.mutation(api.stock.receiveStock, { tenantId, productId, warehouseId, quantity: 10 });
    return productId;
  };
  const inverter = await make("inverter", "INV-3K", 2_000_000, inverterSpecs, 60);
  const battery = await make("battery", "BAT-4.8", 3_000_000, batterySpecs, 24);
  const panel = await make("pv_panel", "PV-550", 500_000, panelSpecs);
  await asOwner.mutation(api.margins.setMarginRule, { tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10 });

  const agent = as("agent@acme.ug");
  const { customerId } = await agent.mutation(api.customers.createCustomer, {
    tenantId, name: "Farm", phone: "+256 700 000111", type: "agricultural"
  });
  const { siteId } = await agent.mutation(api.customers.createSite, {
    customerId, name: "Main", address: "A", region: "R", gpsConsent: false, gridAvailability: "none"
  });
  const { assessmentId } = await agent.mutation(api.assessments.createAssessment, { customerId, siteId });
  await agent.mutation(api.assessments.saveAssessment, {
    assessmentId, expectedRevision: 1, inputs: { systemType: "off_grid", autonomyDays: 1, lines: [lights] }
  });
  await agent.mutation(api.assessments.completeAssessment, { assessmentId });
  const { runId } = await agent.mutation(api.sizing.runSizing, { assessmentId, assumptions });

  return {
    t, tenantId, asOwner, agent, other: as("other@acme.ug"), tech: as("tech@acme.ug"), tech2: as("tech2@acme.ug"),
    mgr: as("mgr@acme.ug"), inv: as("inv@acme.ug"), runId, warehouseId, people, products: { inverter, battery, panel }
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** An officially issued quotation, ready to be answered. */
async function issued(c: Ctx) {
  const { quotationId } = await c.agent.mutation(api.quotations.createQuotation, { sizingRunId: c.runId, candidateIndex: 0 });
  await c.agent.mutation(api.quotations.submitForReview, { quotationId });
  await c.tech.mutation(api.quotations.startReview, { quotationId });
  await c.tech.mutation(api.quotations.decideTechnical, { quotationId, revision: 1, outcome: "approved", checklist });
  await c.agent.mutation(api.quotations.issueQuotation, { quotationId });
  return quotationId;
}
const profileId = (c: Ctx, email: string) =>
  c.t.run(async (ctx) => (await ctx.db.query("userProfiles").withIndex("by_email", (q) => q.eq("email", email)).unique())!._id);
const onHand = (c: Ctx, productId: Id<"products">) =>
  c.t.run(async (ctx) => (await ctx.db.query("stockBalances").collect()).filter((b) => b.productId === productId).reduce((s, b) => s + b.onHand, 0));

describe("instalment plans", () => {
  const base = { priceMinor: 1_200_000, depositMinor: 0, termMonths: 12, annualRateBps: 0, method: "reducing" as const };

  test("a 0% plan splits the price evenly and repays exactly the amount financed", () => {
    const plan = buildInstallmentPlan(base);
    expect(plan.totalInterestMinor).toBe(0);
    expect(plan.rows.every((r) => r.paymentMinor === 100_000)).toBe(true);
    expect(plan.rows.at(-1)!.balanceMinor).toBe(0);
  });

  test("flat interest is financed x rate x years, spread evenly", () => {
    const plan = buildInstallmentPlan({ ...base, depositMinor: 200_000, annualRateBps: 1200, method: "flat" });
    expect(plan.financedMinor).toBe(1_000_000);
    expect(plan.totalInterestMinor).toBe(120_000);
    expect(plan.totalPayableMinor).toBe(1_120_000);
    expect(plan.rows.reduce((s, r) => s + r.paymentMinor, 0)).toBe(1_120_000);
  });

  test("reducing balance charges interest on what is still owed and always ends at zero", () => {
    const plan = buildInstallmentPlan({ ...base, termMonths: 7, priceMinor: 1_000_003, annualRateBps: 1800, method: "reducing" });
    expect(plan.rows[0].interestMinor).toBe(Math.round(1_000_003 * 0.015));
    expect(plan.rows.at(-1)!.balanceMinor).toBe(0);
    expect(plan.rows.reduce((s, r) => s + r.principalMinor, 0)).toBe(1_000_003);
    expect(plan.rows.every((r) => Number.isInteger(r.paymentMinor) && r.paymentMinor > 0)).toBe(true);
    // Reducing balance costs less than flat at the same quoted rate.
    const flat = buildInstallmentPlan({ ...base, termMonths: 7, priceMinor: 1_000_003, annualRateBps: 1800, method: "flat" });
    expect(plan.totalInterestMinor).toBeLessThan(flat.totalInterestMinor);
  });

  test("bad inputs are refused", () => {
    expect(() => buildInstallmentPlan({ ...base, depositMinor: 1_200_000 })).toThrow(/less than the price/);
    expect(() => buildInstallmentPlan({ ...base, termMonths: 61 })).toThrow(/1 to 60/);
    expect(() => buildInstallmentPlan({ ...base, annualRateBps: 10_001 })).toThrow(/0% and 100%/);
    expect(() => buildInstallmentPlan({ ...base, priceMinor: 10.5 })).toThrow();
  });

  test("percentages round half-up and months clamp to the end of short months", () => {
    expect(applyBps(5, 1000)).toBe(1);
    expect(applyBps(4, 1000)).toBe(0);
    expect(new Date(addMonths(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonths(Date.UTC(2026, 10, 1), 24)).toISOString().slice(0, 10)).toBe("2028-11-01");
  });

  test("the quotation preview uses the issued total and respects ownership", async () => {
    const c = await setup();
    const id = await issued(c);
    const args = { quotationId: id, depositMinor: 1_000_000, termMonths: 6, annualRateBps: 0, method: "reducing" as const };
    const plan = await c.agent.query(api.operations.previewInstallments, args);
    expect(plan.priceMinor).toBe(7_500_000);
    expect(plan.financedMinor).toBe(6_500_000);
    await expect(c.other.query(api.operations.previewInstallments, args)).rejects.toThrow(/not found/);
    await expect(c.inv.query(api.operations.previewInstallments, args)).rejects.toThrow();
  });
});

describe("deal outcomes and commissions", () => {
  test("only an issued quotation can be answered, and only once", async () => {
    const c = await setup();
    const { quotationId } = await c.agent.mutation(api.quotations.createQuotation, { sizingRunId: c.runId, candidateIndex: 0 });
    await expect(c.agent.mutation(api.operations.recordOutcome, { quotationId, outcome: "won" })).rejects.toThrow(/officially issued/);
    const id = await issued(c);
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" });
    await expect(c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "lost", reason: "x" })).rejects.toThrow(/already has an outcome/);
  });

  test("another agent and inventory admins cannot answer someone else's quotation", async () => {
    const c = await setup();
    const id = await issued(c);
    await expect(c.other.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" })).rejects.toThrow(/not found/);
    await expect(c.inv.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" })).rejects.toThrow();
    await expect(c.tech.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" })).rejects.toThrow();
  });

  test("a lost deal needs a reason and releases the held stock", async () => {
    const c = await setup();
    const id = await issued(c);
    await expect(c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "lost" })).rejects.toThrow(/reason/i);
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "lost", reason: "Went with a competitor" });
    const holds = await c.t.run((ctx) => ctx.db.query("stockReservations").collect());
    expect(holds.every((h) => h.status === "released")).toBe(true);
    expect(await c.t.run((ctx) => ctx.db.query("installations").collect())).toHaveLength(0);
    expect(await c.t.run((ctx) => ctx.db.query("commissions").collect())).toHaveLength(0);
  });

  test("winning opens an installation and accrues commission at the rate in force, on the pre-tax value", async () => {
    const c = await setup();
    await expect(c.agent.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 500 })).rejects.toThrow(/role/i);
    await expect(c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 5001 })).rejects.toThrow(/50%/);
    await c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 250 });

    const id = await issued(c);
    const result = await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" });
    expect(result.commissionMinor).toBe(187_500); // 2.5% of 7,500,000
    expect(result.installationId).toBeTruthy();

    // A later change of policy does not rewrite history.
    await c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 1000 });
    const mine = await c.agent.query(api.operations.listCommissions, { tenantId: c.tenantId });
    expect(mine.commissions).toHaveLength(1);
    expect(mine.commissions[0]).toMatchObject({ amountMinor: 187_500, rateBps: 250, status: "accrued" });
    expect(mine.commissions[0].canDecide).toBe(false);
    expect(mine.canManage).toBe(false);
  });

  test("with no rate configured nothing accrues", async () => {
    const c = await setup();
    const id = await issued(c);
    const result = await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" });
    expect(result.commissionMinor).toBe(0);
    expect(await c.t.run((ctx) => ctx.db.query("commissions").collect())).toHaveLength(0);
  });

  test("agents see only their own commissions; a manager approves then pays with a reference", async () => {
    const c = await setup();
    await c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 500 });
    const id = await issued(c);
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" });

    expect((await c.other.query(api.operations.listCommissions, { tenantId: c.tenantId })).commissions).toHaveLength(0);
    await expect(c.inv.query(api.operations.listCommissions, { tenantId: c.tenantId })).rejects.toThrow();
    const all = await c.mgr.query(api.operations.listCommissions, { tenantId: c.tenantId });
    const commissionId = all.commissions[0].id;
    expect(all.commissions[0].canDecide).toBe(true);

    await expect(c.agent.mutation(api.operations.decideCommission, { commissionId, action: "approve" })).rejects.toThrow(/role/i);
    await expect(c.mgr.mutation(api.operations.decideCommission, { commissionId, action: "pay", paymentReference: "X" })).rejects.toThrow(/Approve/);
    await c.mgr.mutation(api.operations.decideCommission, { commissionId, action: "approve" });
    await expect(c.mgr.mutation(api.operations.decideCommission, { commissionId, action: "pay" })).rejects.toThrow(/reference/i);
    await c.mgr.mutation(api.operations.decideCommission, { commissionId, action: "pay", paymentReference: "MM-1001" });
    await expect(c.mgr.mutation(api.operations.decideCommission, { commissionId, action: "cancel", reason: "oops" })).rejects.toThrow(/unpaid/);
    expect((await c.agent.query(api.operations.listCommissions, { tenantId: c.tenantId })).commissions[0]).toMatchObject({ status: "paid", paymentReference: "MM-1001" });
  });

  test("nobody approves their own commission", async () => {
    const c = await setup();
    await c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 500 });
    // The manager sells and wins a quotation of their own.
    const { customerId } = await c.mgr.mutation(api.customers.createCustomer, { tenantId: c.tenantId, name: "M", phone: "+256 700 000222", type: "residential" });
    const { siteId } = await c.mgr.mutation(api.customers.createSite, { customerId, name: "S", address: "A", region: "R", gpsConsent: false, gridAvailability: "none" });
    const { assessmentId } = await c.mgr.mutation(api.assessments.createAssessment, { customerId, siteId });
    await c.mgr.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs: { systemType: "off_grid", autonomyDays: 1, lines: [lights] } });
    await c.mgr.mutation(api.assessments.completeAssessment, { assessmentId });
    const { runId } = await c.mgr.mutation(api.sizing.runSizing, { assessmentId, assumptions });
    const { quotationId } = await c.mgr.mutation(api.quotations.createQuotation, { sizingRunId: runId, candidateIndex: 0 });
    await c.mgr.mutation(api.quotations.submitForReview, { quotationId });
    await c.tech.mutation(api.quotations.startReview, { quotationId });
    await c.tech.mutation(api.quotations.decideTechnical, { quotationId, revision: 1, outcome: "approved", checklist });
    await c.mgr.mutation(api.quotations.issueQuotation, { quotationId });
    await c.mgr.mutation(api.operations.recordOutcome, { quotationId, outcome: "won" });
    const row = (await c.mgr.query(api.operations.listCommissions, { tenantId: c.tenantId })).commissions[0];
    expect(row.canDecide).toBe(false);
    await expect(c.mgr.mutation(api.operations.decideCommission, { commissionId: row.id, action: "approve" })).rejects.toThrow(/your own/);
  });

  test("a won quotation is not expired by the hourly job, but an unanswered one is", async () => {
    const c = await setup();
    const won = await issued(c);
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: won, outcome: "won" });
    const open = await issued(c);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20 * 86_400_000);
    await c.t.mutation(internal.quotations.expireDue, {});
    const status = (id: Id<"quotations">) => c.t.run(async (ctx) => (await ctx.db.get(id))!.status);
    expect(await status(won)).toBe("officially_issued");
    expect(await status(open)).toBe("expired");
    const holds = await c.t.run((ctx) => ctx.db.query("stockReservations").collect());
    expect(holds.filter((h) => h.status === "active").length).toBeGreaterThan(0);
  });

  test("a quotation past its validity cannot be marked won", async () => {
    const c = await setup();
    const id = await issued(c);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20 * 86_400_000);
    await expect(c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" })).rejects.toThrow(/validity/);
  });
});

describe("installations and warranties", () => {
  async function won(c: Ctx) {
    const id = await issued(c);
    const { installationId } = await c.agent.mutation(api.operations.recordOutcome, { quotationId: id, outcome: "won" });
    return { quotationId: id, installationId: installationId! };
  }

  test("a manager schedules a real technician; the job follows the allowed steps", async () => {
    const c = await setup();
    const { installationId } = await won(c);
    const techId = await profileId(c, "tech@acme.ug");
    const when = Date.now() + 3 * 86_400_000;

    await expect(c.agent.mutation(api.operations.scheduleInstallation, { installationId, technicianUserId: techId, scheduledFor: when })).rejects.toThrow(/role/i);
    await expect(c.mgr.mutation(api.operations.scheduleInstallation, { installationId, technicianUserId: await profileId(c, "other@acme.ug"), scheduledFor: when })).rejects.toThrow(/technician/);
    await expect(c.mgr.mutation(api.operations.scheduleInstallation, { installationId, technicianUserId: techId, scheduledFor: Date.now() - 5 * 86_400_000 })).rejects.toThrow(/past/);
    await c.mgr.mutation(api.operations.scheduleInstallation, { installationId, technicianUserId: techId, scheduledFor: when });

    await expect(c.mgr.mutation(api.operations.completeInstallation, { installationId })).rejects.toThrow(/cannot move/);
    const list = await c.tech.query(api.operations.listInstallations, { tenantId: c.tenantId });
    expect(list[0]).toMatchObject({ status: "scheduled", technicianName: "tech", canWork: true, canManage: false });
  });

  test("only the assigned technician (or a manager) can work the job", async () => {
    const c = await setup();
    const { installationId } = await won(c);
    await c.mgr.mutation(api.operations.scheduleInstallation, {
      installationId, technicianUserId: await profileId(c, "tech@acme.ug"), scheduledFor: Date.now() + 86_400_000
    });
    await expect(c.tech2.mutation(api.operations.startInstallation, { installationId })).rejects.toThrow(/assigned technician/);
    await expect(c.agent.mutation(api.operations.startInstallation, { installationId })).rejects.toThrow(/assigned technician/);
    await c.tech.mutation(api.operations.startInstallation, { installationId });
    await expect(c.tech2.mutation(api.operations.completeInstallation, { installationId })).rejects.toThrow(/assigned technician/);
  });

  test("completing issues the held stock once and starts a warranty per quoted product", async () => {
    const c = await setup();
    const { installationId, quotationId } = await won(c);
    await c.mgr.mutation(api.operations.scheduleInstallation, {
      installationId, technicianUserId: await profileId(c, "tech@acme.ug"), scheduledFor: Date.now() + 86_400_000
    });
    await c.tech.mutation(api.operations.startInstallation, { installationId });
    expect(await onHand(c, c.products.inverter)).toBe(10);

    const { warranties } = await c.tech.mutation(api.operations.completeInstallation, { installationId, notes: "Done, customer trained" });
    expect(warranties).toBe(2); // inverter and battery have a warranty; the panel has none

    expect(await onHand(c, c.products.inverter)).toBe(9);
    expect(await onHand(c, c.products.battery)).toBe(9);
    expect(await onHand(c, c.products.panel)).toBe(8);
    const holds = await c.t.run((ctx) => ctx.db.query("stockReservations").collect());
    expect(holds.every((h) => h.status === "fulfilled")).toBe(true);

    await expect(c.tech.mutation(api.operations.completeInstallation, { installationId })).rejects.toThrow(/cannot move/);
    expect(await onHand(c, c.products.inverter)).toBe(9);

    const list = await c.agent.query(api.operations.listWarranties, { tenantId: c.tenantId });
    expect(list.map((w) => [w.sku, w.months, w.state]).sort()).toEqual([["BAT-4.8", 24, "active"], ["INV-3K", 60, "active"]]);
    const inv = list.find((w) => w.sku === "INV-3K")!;
    expect(inv.endsAt).toBe(addMonths(inv.startsAt, 60));
    expect(await c.other.query(api.operations.listWarranties, { tenantId: c.tenantId })).toHaveLength(0);
    expect(quotationId).toBeTruthy();
  });

  test("warranties nearing their end are flagged, and expired ones are shown as expired", async () => {
    const c = await setup();
    const { installationId } = await won(c);
    await c.mgr.mutation(api.operations.startInstallation, { installationId });
    await c.mgr.mutation(api.operations.completeInstallation, { installationId });
    vi.useFakeTimers();
    vi.setSystemTime(addMonths(Date.now(), 24) - 10 * 86_400_000);
    let list = await c.mgr.query(api.operations.listWarranties, { tenantId: c.tenantId });
    expect(list.find((w) => w.sku === "BAT-4.8")!.state).toBe("expiring");
    expect(list.find((w) => w.sku === "INV-3K")!.state).toBe("active");
    vi.setSystemTime(addMonths(Date.now(), 1));
    list = await c.mgr.query(api.operations.listWarranties, { tenantId: c.tenantId });
    expect(list.find((w) => w.sku === "BAT-4.8")!.state).toBe("expired");
  });

  test("cancelling needs a reason, releases the holds and cannot be undone", async () => {
    const c = await setup();
    const { installationId } = await won(c);
    await expect(c.mgr.mutation(api.operations.cancelInstallation, { installationId, reason: " " })).rejects.toThrow();
    await c.mgr.mutation(api.operations.cancelInstallation, { installationId, reason: "Customer postponed" });
    const holds = await c.t.run((ctx) => ctx.db.query("stockReservations").collect());
    expect(holds.every((h) => h.status === "released")).toBe(true);
    await expect(c.mgr.mutation(api.operations.startInstallation, { installationId })).rejects.toThrow(/cannot move/);
  });

  test("an agent sees only their own customers' jobs", async () => {
    const c = await setup();
    await won(c);
    expect(await c.agent.query(api.operations.listInstallations, { tenantId: c.tenantId })).toHaveLength(1);
    expect(await c.other.query(api.operations.listInstallations, { tenantId: c.tenantId })).toHaveLength(0);
    await expect(c.inv.query(api.operations.listInstallations, { tenantId: c.tenantId })).rejects.toThrow();
  });
});

describe("manager dashboard", () => {
  test("is for managers only and reports pipeline, wins and losses per currency without mixing them", async () => {
    const c = await setup();
    await c.mgr.mutation(api.operations.setCommissionRate, { tenantId: c.tenantId, commissionBps: 500 });
    const a = await issued(c);
    const b = await issued(c);
    await issued(c); // left unanswered
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: a, outcome: "won" });
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: b, outcome: "lost", reason: "Price" });

    await expect(c.agent.query(api.operations.dashboard, { tenantId: c.tenantId })).rejects.toThrow(/role/i);
    await expect(c.tech.query(api.operations.dashboard, { tenantId: c.tenantId })).rejects.toThrow(/role/i);

    const d = await c.mgr.query(api.operations.dashboard, { tenantId: c.tenantId });
    expect(d.won).toBe(1);
    expect(d.lost).toBe(1);
    expect(d.winRate).toBe(0.5);
    expect(d.wonValueByCurrency).toEqual({ UGX: 7_500_000 });
    expect(d.openValueByCurrency).toEqual({ UGX: 7_500_000 });
    expect(d.agents).toEqual([{ agentName: "agent", won: 1, lost: 1, wonValue: { UGX: 7_500_000 } }]);
    expect(d.commissionByStatus.accrued).toEqual({ UGX: 375_000 });
    expect(d.installationsByStatus).toEqual({ pending: 1 });
    expect(d.quotationsByStatus.officially_issued).toBe(3);
  });

  test("the window limits wins and losses, and an empty window has no win rate", async () => {
    const c = await setup();
    const a = await issued(c);
    await c.agent.mutation(api.operations.recordOutcome, { quotationId: a, outcome: "won" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 40 * 86_400_000);
    const d = await c.mgr.query(api.operations.dashboard, { tenantId: c.tenantId, windowDays: 30 });
    expect(d.won).toBe(0);
    expect(d.winRate).toBeNull();
    expect((await c.mgr.query(api.operations.dashboard, { tenantId: c.tenantId, windowDays: 90 })).won).toBe(1);
  });
});
