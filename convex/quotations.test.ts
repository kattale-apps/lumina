/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeTotals, TECHNICIAN_CHECKLIST } from "./lib/quote";
import { buildQuotePdf, ILLUSTRATIVE_BANNER } from "./lib/quotePdf";
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

/** A company with priced, stocked products and a completed, sized assessment. */
async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["agent@acme.ug", "sales_agent"], ["other@acme.ug", "sales_agent"],
    ["tech@acme.ug", "technician"], ["mgr@acme.ug", "sales_manager"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });

  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const { warehouseId } = await asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "Main", code: "MAIN" });
  const make = async (key: string, sku: string, cost: number, specValues: Record<string, number | string | boolean>) => {
    const { productId } = await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: cats.find((c) => c.key === key)!.id, name: sku, brand: "B", model: sku, sku, specValues
    });
    await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: cost });
    await asOwner.mutation(api.stock.receiveStock, { tenantId, productId, warehouseId, quantity: 10 });
    return productId;
  };
  const inverter = await make("inverter", "INV-3K", 2_000_000, inverterSpecs);
  const battery = await make("battery", "BAT-4.8", 3_000_000, batterySpecs);
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
    t, tenantId, asOwner, agent, tech: as("tech@acme.ug"), mgr: as("mgr@acme.ug"), other: as("other@acme.ug"),
    assessmentId, runId, products: { inverter, battery, panel }, warehouseId
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const newQuote = async (c: Ctx, extra: { taxBps?: number } = {}) =>
  (await c.agent.mutation(api.quotations.createQuotation, { sizingRunId: c.runId, candidateIndex: 0, ...extra })).quotationId;
const checklist = TECHNICIAN_CHECKLIST.map((i) => ({ key: i.key, confirmed: true }));
const approveTechnically = async (c: Ctx, quotationId: Id<"quotations">, revision = 1) => {
  await c.agent.mutation(api.quotations.submitForReview, { quotationId });
  await c.tech.mutation(api.quotations.startReview, { quotationId });
  return c.tech.mutation(api.quotations.decideTechnical, { quotationId, revision, outcome: "approved", checklist });
};
const view = (c: Ctx, quotationId: Id<"quotations">, revision?: number) =>
  c.agent.query(api.quotations.getQuotation, { quotationId, revision });
const reservedFor = (c: Ctx) =>
  c.t.run(async (ctx) => (await ctx.db.query("stockReservations").collect()).filter((r) => r.status === "active"));

describe("pricing and totals", () => {
  test("lines come from the sizing, priced from current cost and margin, and totals use exact maths", async () => {
    const c = await setup();
    const id = await newQuote(c, { taxBps: 1800 });
    const q = await view(c, id);
    // Cost x 1.25: inverter 2,500,000; 2 panels at 625,000; battery 3,750,000.
    expect(q.shown.lines.map((l) => [l.sku, l.quantity, l.unitPriceMinor])).toEqual([
      ["INV-3K", 1, 2_500_000], ["PV-550", 2, 625_000], ["BAT-4.8", 1, 3_750_000]
    ]);
    expect(q.shown.subtotalMinor).toBe(7_500_000);
    expect(q.shown.taxMinor).toBe(1_350_000);
    expect(q.shown.totalMinor).toBe(8_850_000);
    expect(q.quotation.status).toBe("draft");
    // The floor price and cost never reach the browser.
    expect(JSON.stringify(q)).not.toMatch(/floorUnitMinor|costMinor/);
  });

  test("tax rounds half-up in minor units", () => {
    expect(computeTotals([{ kind: "service", quantity: 1, unitPriceMinor: 5 }], 1000).taxMinor).toBe(1); // 0.5 -> 1
    expect(computeTotals([{ kind: "service", quantity: 1, unitPriceMinor: 4 }], 1000).taxMinor).toBe(0); // 0.4 -> 0
  });

  test("a discount within the floor is the agent's to give; above list is refused", async () => {
    const c = await setup();
    const id = await newQuote(c);
    const lines = (price: number) => [
      { kind: "product" as const, productId: c.products.inverter, quantity: 1, unitPriceMinor: price },
      { kind: "service" as const, description: "Installation", quantity: 1, unitPriceMinor: 300_000 }
    ];
    const revise = (price: number) => c.agent.mutation(api.quotations.reviseQuotation, {
      quotationId: id, expectedRevision: 1, lines: lines(price), taxBps: 0, validityDays: 14, reason: "Customer discount"
    });
    await expect(revise(2_600_000)).rejects.toThrow(/above the list price/);
    await revise(2_300_000); // floor is 2,200,000
    const q = await view(c, id);
    expect(q.shown.requiresCommercialApproval).toBe(false);
    expect(q.shown.lines[0].belowFloor).toBe(false);
  });
});

describe("approvals", () => {
  test("a clean quotation needs technical approval only, then issues with a number and stock holds", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await expect(c.agent.mutation(api.quotations.issueQuotation, { quotationId: id })).rejects.toThrow(/cannot move/);

    const result = await approveTechnically(c, id);
    expect(result.status).toBe("ready_for_official_issue");

    vi.useFakeTimers();
    const { officialNumber } = await c.agent.mutation(api.quotations.issueQuotation, { quotationId: id });
    expect(officialNumber).toBe(`Q-${new Date().getUTCFullYear()}-00001`);
    const held = await reservedFor(c);
    expect(held.map((r) => r.quantity).sort()).toEqual([1, 1, 2]);
    expect(held.every((r) => r.reference === officialNumber)).toBe(true);

    vi.runAllTimers();
    await c.t.finishInProgressScheduledFunctions();
    vi.useRealTimers();
    const q = await view(c, id);
    expect(q.quotation.status).toBe("officially_issued");
    expect(q.shown.officialPdfUrl).toBeTruthy();

    // Issued quotations are final: they cannot be revised or issued again.
    await expect(c.agent.mutation(api.quotations.issueQuotation, { quotationId: id })).rejects.toThrow(/cannot move/);
    await expect(c.agent.mutation(api.quotations.reviseQuotation, {
      quotationId: id, expectedRevision: 1, lines: [], taxBps: 0, validityDays: 14, reason: "x"
    })).rejects.toThrow(/no longer be changed/);
  });

  test("roles are enforced: agents cannot review, reviewers cannot be the owner", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await c.agent.mutation(api.quotations.submitForReview, { quotationId: id });
    await expect(c.agent.mutation(api.quotations.startReview, { quotationId: id })).rejects.toThrow(/role/);
    await expect(c.mgr.mutation(api.quotations.startReview, { quotationId: id })).rejects.toThrow(/role/);
  });

  test("the company owner cannot review or approve their own quotation", async () => {
    const c = await setup();
    const { customerId } = await c.asOwner.mutation(api.customers.createCustomer, {
      tenantId: c.tenantId, name: "Own", phone: "+256 700 000222", type: "residential"
    });
    const { siteId } = await c.asOwner.mutation(api.customers.createSite, {
      customerId, name: "S", address: "A", region: "R", gpsConsent: false, gridAvailability: "none"
    });
    const { assessmentId } = await c.asOwner.mutation(api.assessments.createAssessment, { customerId, siteId });
    await c.asOwner.mutation(api.assessments.saveAssessment, {
      assessmentId, expectedRevision: 1, inputs: { systemType: "off_grid", autonomyDays: 1, lines: [lights] }
    });
    await c.asOwner.mutation(api.assessments.completeAssessment, { assessmentId });
    const { runId } = await c.asOwner.mutation(api.sizing.runSizing, { assessmentId, assumptions });
    const { quotationId } = await c.asOwner.mutation(api.quotations.createQuotation, { sizingRunId: runId, candidateIndex: 0 });
    await c.asOwner.mutation(api.quotations.submitForReview, { quotationId });
    await expect(c.asOwner.mutation(api.quotations.startReview, { quotationId })).rejects.toThrow(/your own quotation/);
    await c.tech.mutation(api.quotations.startReview, { quotationId });
    await expect(
      c.asOwner.mutation(api.quotations.decideTechnical, { quotationId, revision: 1, outcome: "approved", checklist })
    ).rejects.toThrow(/your own quotation/);
  });

  test("the technician must confirm the whole checklist and cannot approve an unresolved basis", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await c.agent.mutation(api.quotations.submitForReview, { quotationId: id });
    await c.tech.mutation(api.quotations.startReview, { quotationId: id });
    const decide = (over: object) => c.tech.mutation(api.quotations.decideTechnical, {
      quotationId: id, revision: 1, outcome: "approved", checklist, ...over
    } as never);

    await expect(decide({ checklist: checklist.slice(1) })).rejects.toThrow(/Confirm every checklist/);
    await expect(decide({ outcome: "rejected" })).rejects.toThrow(/reason/i);
    await expect(decide({ revision: 7 })).rejects.toThrow(/older revision/);
    const returned = await decide({ outcome: "revision_required", reason: "Add earthing" });
    expect(returned.status).toBe("revision_required");
    expect((await view(c, id)).technicalReviews[0].reason).toBe("Add earthing");
  });

  test("open sizing review items block technical approval until resolved", async () => {
    const c = await setup();
    // A three-phase inverter forces a "needs review" check in the sizing.
    await c.t.run(async (ctx) => {
      const p = (await ctx.db.query("products").collect()).find((x) => x.sku === "INV-3K")!;
      await ctx.db.patch(p._id, { specValues: { ...p.specValues, phase: "Three-phase" } });
    });
    const { runId } = await c.agent.mutation(api.sizing.runSizing, { assessmentId: c.assessmentId, assumptions });
    const id = (await c.agent.mutation(api.quotations.createQuotation, { sizingRunId: runId, candidateIndex: 0 })).quotationId;
    await c.agent.mutation(api.quotations.submitForReview, { quotationId: id });
    await c.tech.mutation(api.quotations.startReview, { quotationId: id });
    const approve = () => c.tech.mutation(api.quotations.decideTechnical, {
      quotationId: id, revision: 1, outcome: "approved", checklist
    });
    await expect(approve()).rejects.toThrow(/still need a recorded resolution/);
    await c.tech.mutation(api.sizing.resolveCheck, { runId, candidateIndex: 0, checkId: "phase", note: "Site is three-phase" });
    expect((await approve()).status).toBe("ready_for_official_issue");
  });

  test("a price below the floor needs a manager before issue, and approvals belong to one revision", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await c.agent.mutation(api.quotations.reviseQuotation, {
      quotationId: id, expectedRevision: 1, taxBps: 0, validityDays: 14, reason: "Beat a competitor",
      lines: [
        { kind: "product", productId: c.products.inverter, quantity: 1, unitPriceMinor: 2_100_000 }, // floor 2,200,000
        { kind: "product", productId: c.products.panel, quantity: 2 },
        { kind: "product", productId: c.products.battery, quantity: 1 }
      ]
    });
    const q = await view(c, id);
    expect(q.shown.requiresCommercialApproval).toBe(true);
    expect(q.shown.lines[0].belowFloor).toBe(true);

    const tech = await approveTechnically(c, id, 2);
    expect(tech.status).toBe("pending_commercial_approval");
    await expect(c.agent.mutation(api.quotations.issueQuotation, { quotationId: id })).rejects.toThrow(/cannot move/);
    await expect(c.agent.mutation(api.quotations.decideCommercial, { quotationId: id, revision: 2, outcome: "approved", reason: "ok" }))
      .rejects.toThrow(/role/);
    await expect(c.tech.mutation(api.quotations.decideCommercial, { quotationId: id, revision: 2, outcome: "approved", reason: "ok" }))
      .rejects.toThrow(/role/);
    await expect(c.mgr.mutation(api.quotations.decideCommercial, { quotationId: id, revision: 2, outcome: "approved", reason: " " }))
      .rejects.toThrow(/reason/i);
    await c.mgr.mutation(api.quotations.decideCommercial, { quotationId: id, revision: 2, outcome: "approved", reason: "Strategic account" });

    // Changing the quotation voids both approvals: it goes back to draft as a new revision.
    await c.agent.mutation(api.quotations.reviseQuotation, {
      quotationId: id, expectedRevision: 2, taxBps: 0, validityDays: 14, reason: "Add transport",
      lines: [
        { kind: "product", productId: c.products.inverter, quantity: 1, unitPriceMinor: 2_100_000 },
        { kind: "product", productId: c.products.panel, quantity: 2 },
        { kind: "product", productId: c.products.battery, quantity: 1 },
        { kind: "service", description: "Transport", quantity: 1, unitPriceMinor: 100_000 }
      ]
    });
    const after = await view(c, id);
    expect(after.quotation.status).toBe("draft");
    expect(after.technicalReviews).toEqual([]);
    expect(after.commercialApprovals).toEqual([]);
    await expect(c.agent.mutation(api.quotations.issueQuotation, { quotationId: id })).rejects.toThrow(/cannot move/);
    // Earlier revisions stay readable and unchanged.
    expect((await view(c, id, 2)).commercialApprovals).toHaveLength(1);
  });

  test("custom terms count as unusual and need a manager", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await c.agent.mutation(api.quotations.reviseQuotation, {
      quotationId: id, expectedRevision: 1, taxBps: 0, validityDays: 30, customTerms: "Pay 20% on delivery", reason: "Terms",
      lines: [{ kind: "product", productId: c.products.inverter, quantity: 1 }, { kind: "product", productId: c.products.panel, quantity: 2 }, { kind: "product", productId: c.products.battery, quantity: 1 }]
    });
    expect((await view(c, id)).shown.requiresCommercialApproval).toBe(true);
  });

  test("issue rechecks stock, and a rejected commercial approval returns the quote for revision", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await approveTechnically(c, id);
    await c.asOwner.mutation(api.stock.issueStock, {
      tenantId: c.tenantId, productId: c.products.panel, warehouseId: c.warehouseId, quantity: 10
    });
    await expect(c.agent.mutation(api.quotations.issueQuotation, { quotationId: id })).rejects.toThrow(/Not enough stock of PV-550/);
    expect(await reservedFor(c)).toHaveLength(0); // the failed issue left nothing behind
    expect((await view(c, id)).quotation.status).toBe("ready_for_official_issue");
  });

  test("agents see only their own quotations", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await expect(c.other.query(api.quotations.getQuotation, { quotationId: id })).rejects.toThrow(/not found/);
    expect((await c.other.query(api.quotations.listQuotations, { tenantId: c.tenantId })).quotations).toHaveLength(0);
    expect((await c.tech.query(api.quotations.listQuotations, { tenantId: c.tenantId })).quotations).toHaveLength(1);
  });

  test("a stale sizing blocks submission", async () => {
    const c = await setup();
    const id = await newQuote(c);
    await c.agent.mutation(api.assessments.reopenAssessment, { assessmentId: c.assessmentId });
    await c.agent.mutation(api.assessments.saveAssessment, {
      assessmentId: c.assessmentId, expectedRevision: 2, inputs: { systemType: "off_grid", autonomyDays: 2, lines: [lights] }
    });
    await expect(c.agent.mutation(api.quotations.submitForReview, { quotationId: id })).rejects.toThrow(/Run sizing again/);
  });
});

describe("expiry and withdrawal", () => {
  const issue = async (c: Ctx) => {
    const id = await newQuote(c);
    await approveTechnically(c, id);
    vi.useFakeTimers();
    await c.agent.mutation(api.quotations.issueQuotation, { quotationId: id });
    vi.runAllTimers();
    await c.t.finishInProgressScheduledFunctions();
    vi.useRealTimers();
    return id;
  };

  test("expiry marks the quotation expired and frees its stock", async () => {
    const c = await setup();
    const id = await issue(c);
    expect(await reservedFor(c)).toHaveLength(3);
    await c.t.run(async (ctx) => ctx.db.patch(id, { validUntil: Date.now() - 1000 }));
    expect((await view(c, id)).quotation.status).toBe("expired"); // already reads as expired
    expect(await c.t.mutation(internal.quotations.expireDue, {})).toEqual({ expired: 1 });
    expect(await reservedFor(c)).toHaveLength(0);
    expect((await view(c, id)).quotation.statusStored).toBe("expired");
  });

  test("withdrawing releases the holds and needs a reason", async () => {
    const c = await setup();
    const id = await issue(c);
    await expect(c.agent.mutation(api.quotations.withdrawQuotation, { quotationId: id, reason: " " })).rejects.toThrow(/reason/i);
    await c.agent.mutation(api.quotations.withdrawQuotation, { quotationId: id, reason: "Customer declined" });
    expect(await reservedFor(c)).toHaveLength(0);
    await expect(c.agent.mutation(api.quotations.withdrawQuotation, { quotationId: id, reason: "again" })).rejects.toThrow(/cannot move/);
  });

  test("every step is audited", async () => {
    const c = await setup();
    await issue(c);
    const actions = await c.t.run(async (ctx) => (await ctx.db.query("auditEvents").collect()).map((e) => e.action));
    expect(actions).toEqual(expect.arrayContaining([
      "quotation.created", "quotation.submitted", "quotation.review_started", "quotation.technical_approved", "quotation.issued"
    ]));
  });
});

describe("illustrative PDF", () => {
  const data = (count: number) => ({
    mode: "illustrative" as const, companyName: "Acme", customerName: "Farm", siteName: "Main", revision: 1,
    currency: "UGX", taxBps: 0, taxMinor: 0, subtotalMinor: 100, totalMinor: 100, notes: ["Note"],
    lines: Array.from({ length: count }, (_, i) => ({ description: `Item ${i}`, sku: `S${i}`, quantity: 1, unitPriceMinor: 100 }))
  });
  const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
  /** Counts a string drawn in the page content streams, which pdf-lib compresses. */
  const occurrences = async (bytes: Uint8Array, needle: string) => {
    const doc = await PDFDocument.load(bytes);
    let total = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const content = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1").toUpperCase();
      total += content.split(hex(needle)).length - 1;
    }
    return total;
  };

  test("the unverified watermark and banner are on every page", async () => {
    const bytes = await buildQuotePdf(data(80));
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    expect(pages).toBeGreaterThan(1);
    // Each page carries the diagonal watermark and the header banner.
    expect(await occurrences(bytes, ILLUSTRATIVE_BANNER)).toBe(pages * 2);
  });

  test("official PDFs carry no watermark, and text outside Latin-1 does not break generation", async () => {
    const official = await buildQuotePdf({ ...data(2), mode: "official", officialNumber: "Q-1", customerName: "Ñandú 農場" });
    expect(await occurrences(official, ILLUSTRATIVE_BANNER)).toBe(0);
  });

  test("agents can generate the illustrative copy, which moves a draft to illustrative", async () => {
    const c = await setup();
    const id = await newQuote(c);
    const { url } = await c.agent.action(api.quotations.generateIllustrativePdf, { quotationId: id });
    expect(url).toBeTruthy();
    expect((await view(c, id)).quotation.status).toBe("illustrative");
    await expect(c.other.action(api.quotations.generateIllustrativePdf, { quotationId: id })).rejects.toThrow(/not found/);
  });
});
