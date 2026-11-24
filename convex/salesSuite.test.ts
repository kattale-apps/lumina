/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildCandidates, computeRequirements, DEFAULT_ASSUMPTIONS, type CatalogueItem } from "./lib/sizing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    const profileId = await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active", createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|s`, profileId };
  });
}

type Role = "sales_manager" | "sales_agent" | "inventory_admin" | "technician";

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug" });
  const people: Record<string, { subject: string; profileId: Id<"userProfiles"> }> = {};
  const staff: [string, Role][] = [
    ["mgr@acme.ug", "sales_manager"], ["mgr2@acme.ug", "sales_manager"],
    ["a1@acme.ug", "sales_agent"], ["a2@acme.ug", "sales_agent"], ["inv@acme.ug", "inventory_admin"]
  ];
  for (const [email, role] of staff) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800, whatsappNumber: "+256 781 580495" });
  const membershipOf = async (email: string) =>
    (await asOwner.query(api.staff.listStaff, { tenantId })).find((s) => s.email === email)!.membershipId;
  return { t, tenantId, asOwner, as, people, owner, membershipOf };
}

const person = { name: "Kats", phone: "+256 782 872796", location: "Kampala" };
const fridge = { mode: "appliances" as const, category: "residential" as const, items: [{ name: "Refrigerator (medium)", quantity: 1, hoursPerDay: 24 }] };

describe("agents under managers", () => {
  test("a manager sees their own and their agents' customers, not other agents'", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.staff.setManager, { membershipId: await c.membershipOf("a1@acme.ug"), managerUserId: c.people["mgr@acme.ug"].profileId });
    for (const email of ["a1@acme.ug", "a2@acme.ug", "mgr@acme.ug"]) {
      await c.as(email).mutation(api.customers.createCustomer, { tenantId: c.tenantId, name: `Customer of ${email}`, phone: "+256 700 000001", type: "residential" });
    }
    const seen = async (email: string) => (await c.as(email).query(api.customers.listCustomers, { tenantId: c.tenantId })).customers.map((x) => x.name).sort();
    expect(await seen("mgr@acme.ug")).toEqual(["Customer of a1@acme.ug", "Customer of mgr@acme.ug"]);
    expect(await seen("mgr2@acme.ug")).toEqual([]);
    expect(await seen("a2@acme.ug")).toEqual(["Customer of a2@acme.ug"]);
    expect((await c.asOwner.query(api.customers.listCustomers, { tenantId: c.tenantId })).customers).toHaveLength(3);
  });

  test("only agents report to managers, only active managers can be chosen, only super admin assigns", async () => {
    const c = await setup();
    await expect(c.asOwner.mutation(api.staff.setManager, { membershipId: await c.membershipOf("mgr2@acme.ug"), managerUserId: c.people["mgr@acme.ug"].profileId })).rejects.toThrow(/Only sales agents/);
    await expect(c.asOwner.mutation(api.staff.setManager, { membershipId: await c.membershipOf("a1@acme.ug"), managerUserId: c.people["a2@acme.ug"].profileId })).rejects.toThrow(/active sales manager/);
    await expect(c.as("mgr@acme.ug").mutation(api.staff.setManager, { membershipId: await c.membershipOf("a1@acme.ug"), managerUserId: c.people["mgr@acme.ug"].profileId })).rejects.toThrow();
    // Promoting an agent clears their manager.
    const m = await c.membershipOf("a1@acme.ug");
    await c.asOwner.mutation(api.staff.setManager, { membershipId: m, managerUserId: c.people["mgr@acme.ug"].profileId });
    await c.asOwner.mutation(api.staff.changeRole, { membershipId: m, role: "sales_manager" });
    expect((await c.asOwner.query(api.staff.listStaff, { tenantId: c.tenantId })).find((s) => s.membershipId === m)!.managerUserId).toBeNull();
  });
});

describe("invoices and receipts", () => {
  test("numbered documents, totals, visibility by team, and payment proofs for instalments", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.staff.setManager, { membershipId: await c.membershipOf("a1@acme.ug"), managerUserId: c.people["mgr@acme.ug"].profileId });
    const make = (email: string, kind: "proforma" | "receipt") =>
      c.as(email).mutation(api.salesDocuments.createDocument, {
        tenantId: c.tenantId, kind, sellerName: "Lumina Solar Power",
        buyer: { name: "Jane Buyer", location: "Mukono", contact: "0782 872796" },
        items: [{ description: "Lithium battery 12V 100Ah", quantity: 2, unitPrice: 472_500 }, { description: "Installation", quantity: 1, unitPrice: 150_000 }],
        paymentMethod: kind === "receipt" ? "Mobile money" : undefined
      });
    expect((await make("a1@acme.ug", "proforma")).number).toBe("PF-0001");
    expect((await make("a2@acme.ug", "proforma")).number).toBe("PF-0002");
    const { documentId, number } = await make("a1@acme.ug", "receipt");
    expect(number).toBe("RC-0001");
    await expect(c.as("inv@acme.ug").mutation(api.salesDocuments.createDocument, {
      tenantId: c.tenantId, kind: "proforma", sellerName: "X", buyer: { name: "a", location: "b", contact: "c" }, items: [{ description: "x", quantity: 1, unitPrice: 1 }]
    })).rejects.toThrow(/role/);

    const doc = await c.as("a1@acme.ug").query(api.salesDocuments.getDocument, { documentId });
    expect(doc.totalMinor).toBe(1_095_000);
    expect(doc.paymentMethod).toBe("Mobile money");
    const count = async (email: string) => (await c.as(email).query(api.salesDocuments.listDocuments, { tenantId: c.tenantId })).length;
    expect(await count("a1@acme.ug")).toBe(2);
    expect(await count("a2@acme.ug")).toBe(1);
    expect(await count("mgr@acme.ug")).toBe(2);
    expect(await count("mgr2@acme.ug")).toBe(0);
    expect((await c.asOwner.query(api.salesDocuments.listDocuments, { tenantId: c.tenantId })).length).toBe(3);
    await expect(c.as("a2@acme.ug").query(api.salesDocuments.getDocument, { documentId })).rejects.toThrow(/not found/);

    // Two instalments with photos.
    const photo = async (type = "image/jpeg") => await c.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type })));
    await c.as("a1@acme.ug").mutation(api.salesDocuments.addProof, { documentId, storageId: await photo(), amount: 500_000, paidAt: Date.UTC(2026, 10, 1), note: "MoMo 1" });
    await c.as("mgr@acme.ug").mutation(api.salesDocuments.addProof, { documentId, storageId: await photo(), amount: 300_000 });
    await expect(c.as("a1@acme.ug").mutation(api.salesDocuments.addProof, { documentId, storageId: await photo("application/pdf") })).rejects.toThrow(/photo/);
    const paid = await c.as("a1@acme.ug").query(api.salesDocuments.getDocument, { documentId });
    expect(paid.paidMinor).toBe(800_000);
    expect(paid.proofs.map((p) => p.addedBy)).toEqual(["a1", "mgr"]);
    // Only who added a proof (or the super admin) removes it.
    await expect(c.as("a1@acme.ug").mutation(api.salesDocuments.removeProof, { proofId: paid.proofs[1].id })).rejects.toThrow(/Only the person/);
    await c.asOwner.mutation(api.salesDocuments.removeProof, { proofId: paid.proofs[1].id });
    expect((await c.as("a1@acme.ug").query(api.salesDocuments.getDocument, { documentId })).paidMinor).toBe(500_000);
  });
});

describe("WhatsApp numbers take turns, and the follow-up is tracked", () => {
  test("requests go to each agent in turn, are assigned to them, and replies are recorded", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.whatsappAgents.setAgents, {
      tenantId: c.tenantId,
      agents: [
        { number: "0700 111111", name: "", userId: c.people["a1@acme.ug"].profileId },
        { number: "+256 700 222222", name: "Desk phone" }
      ]
    });
    await expect(c.as("mgr@acme.ug").mutation(api.whatsappAgents.setAgents, { tenantId: c.tenantId, agents: [] })).rejects.toThrow();
    const numbers = [];
    const ids: Id<"quoteRequests">[] = [];
    for (const phone of ["+256 701 000001", "+256 701 000002", "+256 701 000003"]) {
      const sent = await c.t.mutation(api.estimator.submitRequest, { input: fridge, grid: "unreliable", optionKey: "recommendation", ...person, phone });
      numbers.push(sent.whatsappNumber);
      ids.push(sent.requestId as Id<"quoteRequests">);
    }
    expect(numbers).toEqual(["256700111111", "256700222222", "256700111111"]);
    const lead = await c.asOwner.query(api.responses.getLead, { leadId: ids[0] });
    expect(lead.whatsapp).toMatchObject({ to: "a1", openedAt: null, repliedAt: null });
    // The first agent was assigned it, so it is in their record book.
    const book = await c.as("a1@acme.ug").query(api.salesLog.staffBook, { tenantId: c.tenantId });
    expect(book.entries.filter((e) => e.type === "Inquiry")).toHaveLength(2);

    await c.t.mutation(api.whatsappAgents.opened, { quoteRequestId: ids[0] });
    await c.as("a1@acme.ug").mutation(api.whatsappAgents.markReplied, { quoteRequestId: ids[0] });
    const after = await c.asOwner.query(api.responses.getLead, { leadId: ids[0] });
    expect(after.whatsapp.openedAt).toBeTypeOf("number");
    expect(after.whatsapp.repliedBy).toBe("a1");

    // Item price requests take their turn too, and a reply counts as answered.
    const item = await c.t.mutation(api.itemRequests.submit, { items: [{ type: "battery", specs: [], quantity: 1, description: "200Ah" }], ...person, phone: "+256 701 000009" } as never);
    expect(item.whatsappNumber).toBe("256700222222");
    await c.as("a2@acme.ug").mutation(api.whatsappAgents.markReplied, { itemRequestId: item.requestId as Id<"itemRequests"> });

    const log = await c.asOwner.query(api.salesLog.inquiries, { tenantId: c.tenantId });
    expect(log.total).toBe(4);
    expect(log.answered).toBe(2);
    expect((await c.asOwner.query(api.salesLog.inquiries, { tenantId: c.tenantId, show: "unanswered" })).rows).toHaveLength(2);
    await expect(c.as("mgr@acme.ug").query(api.salesLog.inquiries, { tenantId: c.tenantId })).rejects.toThrow();
  });

  test("checks are logged, and a request links back to its check", async () => {
    const c = await setup();
    const { checkId } = await c.t.mutation(api.checks.logCheck, { kind: "energy", summary: "1 appliance, 1.4 kWh a day" });
    await c.t.mutation(api.checks.logCheck, { kind: "budget", summary: "Budget UGX 5,000,000, nothing fits" });
    const sent = await c.t.mutation(api.estimator.submitRequest, { input: fridge, grid: "unreliable", optionKey: "recommendation", ...person, checkId: checkId! });
    const checks = await c.asOwner.query(api.salesLog.checks, { tenantId: c.tenantId });
    expect(checks.map((x) => [x.kind, x.requestId])).toEqual(expect.arrayContaining([["energy", sent.requestId], ["budget", null]]));
  });

  test("a customer's record book gathers their inquiries and invoices by phone number", async () => {
    const c = await setup();
    await c.t.mutation(api.estimator.submitRequest, { input: fridge, grid: "unreliable", optionKey: "recommendation", ...person });
    await c.as("a1@acme.ug").mutation(api.salesDocuments.createDocument, {
      tenantId: c.tenantId, kind: "receipt", sellerName: "Acme", buyer: { name: "Kats", location: "Kampala", contact: "0782872796" },
      items: [{ description: "Panel", quantity: 1, unitPrice: 300_000 }]
    });
    const book = await c.asOwner.query(api.salesLog.customerBook, { tenantId: c.tenantId, phone: "0782 872 796" });
    expect(book.name).toBe("Kats");
    expect(book.entries.map((e) => e.type).sort()).toEqual(["Inquiry", "Receipt"]);
    // Another agent sees the inquiry but not a1's receipt.
    const other = await c.as("a2@acme.ug").query(api.salesLog.customerBook, { tenantId: c.tenantId, phone: "+256782872796" });
    expect(other.entries.map((e) => e.type)).toEqual(["Inquiry"]);
  });
});

describe("Lumina products first, and the opening stock", () => {
  test("a design made of priority parts comes first when it fits", () => {
    const inverter = (id: string, preferred: boolean): CatalogueItem => ({
      id, sku: id, name: id, categoryKey: "inverter", specSchemaVersion: 1, preferred,
      specValues: { topology: "Hybrid", rated_output_power: 3000, rated_output_apparent: 3000, surge_power: 6000, surge_duration: 5, phase: "Single-phase", output_voltage: 230, battery_voltage: 48, max_pv_input_power: 4000, max_pv_voltage: 450, mppt_min_voltage: 60, mppt_max_voltage: 400, max_pv_current: 18, mppt_count: 1, max_charge_current: 60 }
    });
    const battery: CatalogueItem = { id: "BAT", sku: "BAT", name: "BAT", categoryKey: "battery", specSchemaVersion: 1, specValues: { chemistry: "LiFePO4", nominal_voltage: 48, capacity_ah: 100, max_discharge_current: 100, max_charge_current: 60, recommended_dod: 80, has_bms: true } };
    const inputs = { systemType: "backup_only" as const, backupHours: 2, lines: [{ name: "TV", quantity: 1, powerW: 100, powerSource: "estimate" as const, powerFactor: 0.9, currentType: "ac" as const, critical: false, windows: [{ start: 18, end: 22 }] }] };
    const a = { ...DEFAULT_ASSUMPTIONS, solarResourceSource: "test" };
    const req = computeRequirements(inputs as never, a);
    const plain = buildCandidates(inputs as never, req, a, [inverter("A-OTHER", false), inverter("Z-LUMINA", true), battery]);
    expect(plain.candidates[0].inverterId).toBe("Z-LUMINA");
  });

  test("tops every Lumina product up to the minimum once; running again changes nothing", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId: c.tenantId });
    const cats = (await c.asOwner.query(api.catalogue.listCategories, { tenantId: c.tenantId })).categories;
    const make = async (sku: string, brand: string) => (await c.asOwner.mutation(api.products.createProduct, {
      tenantId: c.tenantId, categoryId: cats.find((x) => x.key === "pv_panel")!.id, name: sku, brand, model: sku, sku,
      specValues: { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 }
    })).productId;
    const lum1 = await make("LUM-1", "LUMINA");
    const lum2 = await make("LUM-2", "Lumina");
    await make("OTHER-1", "Jinko");
    const { warehouseId } = await c.asOwner.mutation(api.settings.createWarehouse, { tenantId: c.tenantId, name: "KYEBANDO", code: "KLA-MAIN" });
    await c.asOwner.mutation(api.stock.receiveStock, { tenantId: c.tenantId, productId: lum2, warehouseId, quantity: 70 });
    const run = () => c.t.mutation(internal.stock.topUpBaseline, { tenantSlug: "acme", warehouseCode: "KLA-MAIN", minimum: 50, actorEmail: "owner@acme.ug" });
    expect(await run()).toEqual({ warehouse: "KYEBANDO", raised: 1, unitsAdded: 50, alreadyEnough: 1 });
    expect(await run()).toEqual({ warehouse: "KYEBANDO", raised: 0, unitsAdded: 0, alreadyEnough: 2 });
    const view = await c.asOwner.query(api.stock.stockOverview, { tenantId: c.tenantId });
    const onHand = (id: Id<"products">) => view.items.find((i) => i.productId === id)!.rows.find((r) => r.warehouseId === warehouseId)!.onHand;
    expect([onHand(lum1), onHand(lum2)]).toEqual([50, 70]);
    await expect(c.t.mutation(internal.stock.topUpBaseline, { tenantSlug: "acme", warehouseCode: "KLA-MAIN", minimum: 50, actorEmail: "a1@acme.ug" })).rejects.toThrow(/super admin or inventory admin/);
  });
});
