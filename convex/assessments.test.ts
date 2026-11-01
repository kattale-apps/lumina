/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { computeLoad, validateLine, type LoadLine } from "./lib/load";
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

type Role = "sales_agent" | "technician" | "sales_manager" | "inventory_admin";

async function setup(extra: { email: string; role: Role }[] = []) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const { email, role } of extra) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  const asOwner = t.withIdentity({ subject: owner.subject });
  return { t, tenantId, asOwner, as };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type Client = Ctx["asOwner"];

const customerArgs = (tenantId: Ctx["tenantId"], name = "Mukasa Farm") => ({
  tenantId, name, phone: "+256 700 000111", type: "agricultural" as const
});

async function customerWithSite(client: Client, tenantId: Ctx["tenantId"], name?: string) {
  const { customerId } = await client.mutation(api.customers.createCustomer, customerArgs(tenantId, name));
  const { siteId } = await client.mutation(api.customers.createSite, {
    customerId, name: "Main farm", address: "Plot 4, Mityana Rd", region: "Central",
    gpsConsent: false, gridAvailability: "unreliable"
  });
  return { customerId, siteId };
}

const fridge = {
  name: "Fridge", quantity: 1, powerW: 150, powerSource: "nameplate" as const, powerFactor: 0.7,
  surgeW: 750, dutyFactor: 0.4, dutyJustification: "Compressor cycles about 40% of the time",
  currentType: "ac" as const, critical: true, windows: [{ start: 0, end: 24 }]
};
const lights = {
  name: "LED lights", quantity: 5, powerW: 9, powerSource: "estimate" as const,
  currentType: "ac" as const, critical: false, windows: [{ start: 18, end: 23 }]
};

describe("load calculation", () => {
  const line = (over: Partial<LoadLine> = {}): LoadLine => ({
    name: "Light", quantity: 1, powerW: 100, currentType: "ac", critical: false,
    windows: [{ start: 18, end: 22 }], ...over
  });

  test("energy is quantity x power x scheduled hours x duty factor", () => {
    const r = computeLoad([line({ quantity: 2, powerW: 50, windows: [{ start: 6, end: 8 }, { start: 18, end: 21 }] })]);
    expect(r.dailyEnergyWh).toBe(2 * 50 * 5);
    expect(r.daytimeEnergyWh).toBe(200);
    expect(r.nighttimeEnergyWh).toBe(300);

    expect(computeLoad([line({ dutyFactor: 0.5 })]).dailyEnergyWh).toBe(100 * 4 * 0.5);
  });

  test("peak demand comes from the hours loads actually overlap", () => {
    const r = computeLoad([
      line({ powerW: 100, windows: [{ start: 8, end: 10 }] }),
      line({ powerW: 400, windows: [{ start: 9, end: 12 }] })
    ]);
    expect(r.connectedLoadW).toBe(500);
    expect(r.coincidentPeakW).toBe(500);
    expect(computeLoad([
      line({ powerW: 100, windows: [{ start: 1, end: 2 }] }),
      line({ powerW: 400, windows: [{ start: 3, end: 4 }] })
    ]).coincidentPeakW).toBe(400);
  });

  test("surge adds only the largest start-up excess among loads running together", () => {
    const r = computeLoad([
      line({ powerW: 150, surgeW: 750, windows: [{ start: 0, end: 24 }] }),
      line({ powerW: 100, surgeW: 400, windows: [{ start: 0, end: 24 }] })
    ]);
    expect(r.coincidentPeakW).toBe(250);
    expect(r.peakWithSurgeW).toBe(250 + 600);
  });

  test("splits AC/DC and critical energy, and warns about missing power factor", () => {
    const r = computeLoad([
      line({ currentType: "dc", critical: true, windows: [{ start: 0, end: 2 }] }),
      line({ windows: [{ start: 0, end: 1 }] })
    ]);
    expect(r.dcEnergyWh).toBe(200);
    expect(r.acEnergyWh).toBe(100);
    expect(r.criticalEnergyWh).toBe(200);
    expect(r.warnings.join(" ")).toMatch(/power factor/);
  });

  test("apparent power divides AC running power by the power factor", () => {
    expect(computeLoad([line({ powerFactor: 0.8 })]).peakApparentVA).toBe(125);
  });

  test("rejects impossible lines", () => {
    expect(validateLine(line({ quantity: 0 }))).toMatch(/quantity/);
    expect(validateLine(line({ powerW: -5 }))).toMatch(/power/);
    expect(validateLine(line({ surgeW: 50 }))).toMatch(/starting/);
    expect(validateLine(line({ dutyFactor: 1.5 }))).toMatch(/duty/);
    expect(validateLine(line({ windows: [] }))).toMatch(/window/);
    expect(validateLine(line({ windows: [{ start: 5, end: 25 }] }))).toMatch(/window/);
    expect(validateLine(line({ windows: [{ start: 1, end: 5 }, { start: 4, end: 8 }] }))).toMatch(/overlap/);
    expect(validateLine(line())).toBeNull();
  });
});

describe("customers and sites", () => {
  test("agents see only their own customers; manager and technician see all", async () => {
    const c = await setup([
      { email: "a1@acme.ug", role: "sales_agent" },
      { email: "a2@acme.ug", role: "sales_agent" },
      { email: "mgr@acme.ug", role: "sales_manager" },
      { email: "tech@acme.ug", role: "technician" }
    ]);
    const { customerId } = await c.as("a1@acme.ug").mutation(api.customers.createCustomer, customerArgs(c.tenantId));

    const list = (e: string) => c.as(e).query(api.customers.listCustomers, { tenantId: c.tenantId });
    expect((await list("a1@acme.ug")).customers).toHaveLength(1);
    expect((await list("a2@acme.ug")).customers).toHaveLength(0);
    expect((await list("mgr@acme.ug")).customers).toHaveLength(1);
    const tech = await list("tech@acme.ug");
    expect(tech.customers).toHaveLength(1);
    expect(tech.canWrite).toBe(false);

    await expect(c.as("a2@acme.ug").query(api.customers.getCustomer, { customerId })).rejects.toThrow(/not found/);
    await expect(
      c.as("a2@acme.ug").mutation(api.customers.updateCustomer, {
        customerId, name: "Hijack", phone: "+256 700 000111", type: "residential", status: "active"
      })
    ).rejects.toThrow(/not found/);
    await expect(
      c.as("tech@acme.ug").mutation(api.customers.createCustomer, customerArgs(c.tenantId, "X"))
    ).rejects.toThrow(/role/);
  });

  test("inventory administrators have no access to customers", async () => {
    const c = await setup([{ email: "inv@acme.ug", role: "inventory_admin" }]);
    await expect(c.as("inv@acme.ug").query(api.customers.listCustomers, { tenantId: c.tenantId })).rejects.toThrow(/role/);
  });

  test("validates contact details and GPS consent", async () => {
    const c = await setup();
    await expect(
      c.asOwner.mutation(api.customers.createCustomer, { ...customerArgs(c.tenantId), phone: "abc" })
    ).rejects.toThrow(/phone/);
    await expect(
      c.asOwner.mutation(api.customers.createCustomer, { ...customerArgs(c.tenantId), email: "nope" })
    ).rejects.toThrow(/email/);

    const { customerId } = await c.asOwner.mutation(api.customers.createCustomer, customerArgs(c.tenantId));
    const site = { customerId, name: "S", address: "A", region: "R", gridAvailability: "none" as const };
    await expect(
      c.asOwner.mutation(api.customers.createSite, { ...site, gpsConsent: false, gps: { lat: 0.3, lng: 32.5 } })
    ).rejects.toThrow(/consent/);
    await expect(
      c.asOwner.mutation(api.customers.createSite, { ...site, gpsConsent: true, gps: { lat: 95, lng: 32.5 } })
    ).rejects.toThrow(/range/);
    await c.asOwner.mutation(api.customers.createSite, { ...site, gpsConsent: true, gps: { lat: 0.3, lng: 32.5 } });
    const detail = await c.asOwner.query(api.customers.getCustomer, { customerId });
    expect(detail.sites[0].gps).toEqual({ lat: 0.3, lng: 32.5 });
  });

  test("changes are audited", async () => {
    const c = await setup();
    const { customerId } = await c.asOwner.mutation(api.customers.createCustomer, customerArgs(c.tenantId));
    await c.asOwner.mutation(api.customers.updateCustomer, {
      customerId, name: "Mukasa Farms Ltd", phone: "+256 700 000111", type: "commercial", status: "active"
    });
    const actions = await c.t.run(async (ctx) =>
      (await ctx.db.query("auditEvents").collect()).map((e) => e.action)
    );
    expect(actions).toEqual(expect.arrayContaining(["customer.created", "customer.updated"]));
  });
});

describe("appliance library", () => {
  test("standard library loads once; agents can read but not edit it", async () => {
    const c = await setup([{ email: "a1@acme.ug", role: "sales_agent" }]);
    const first = await c.asOwner.mutation(api.appliances.loadStandardAppliances, { tenantId: c.tenantId });
    expect(first.added).toBeGreaterThan(5);
    expect((await c.asOwner.mutation(api.appliances.loadStandardAppliances, { tenantId: c.tenantId })).added).toBe(0);

    const view = await c.as("a1@acme.ug").query(api.appliances.listAppliances, { tenantId: c.tenantId });
    expect(view.canManage).toBe(false);
    expect(view.appliances.length).toBe(first.added);
    await expect(
      c.as("a1@acme.ug").mutation(api.appliances.createAppliance, {
        tenantId: c.tenantId, name: "Custom", category: "Other", powerW: 10, typicalHoursPerDay: 1, currentType: "ac"
      })
    ).rejects.toThrow(/role/);
  });

  test("rejects a starting power below running power and duplicate names", async () => {
    const c = await setup();
    const base = { tenantId: c.tenantId, name: "Pump", category: "Pumping", powerW: 300, typicalHoursPerDay: 2, currentType: "ac" as const };
    await expect(c.asOwner.mutation(api.appliances.createAppliance, { ...base, surgeW: 100 })).rejects.toThrow(/Starting/);
    await c.asOwner.mutation(api.appliances.createAppliance, base);
    await expect(c.asOwner.mutation(api.appliances.createAppliance, base)).rejects.toThrow(/already exists/);
  });
});

describe("assessments", () => {
  test("saving appends reproducible revisions with stored results", async () => {
    const c = await setup();
    const { customerId, siteId } = await customerWithSite(c.asOwner, c.tenantId);
    const { assessmentId } = await c.asOwner.mutation(api.assessments.createAssessment, { customerId, siteId });

    const inputs = { systemType: "off_grid" as const, autonomyDays: 1, lines: [fridge, lights] };
    const saved = await c.asOwner.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs });
    expect(saved).toEqual({ revision: 2, changed: true });

    const view = await c.asOwner.query(api.assessments.getAssessment, { assessmentId });
    // Fridge: 150 W x 24 h x 0.4 = 1440 Wh; lights: 5 x 9 W x 5 h = 225 Wh.
    expect(view.shown.results.dailyEnergyWh).toBe(1665);
    expect(view.shown.results.criticalEnergyWh).toBe(1440);
    expect(view.history.map((h) => h.revision)).toEqual([2, 1]);

    // Identical inputs make no new revision; the same inputs always give the same results.
    expect(await c.asOwner.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 2, inputs }))
      .toEqual({ revision: 2, changed: false });
    const first = await c.asOwner.query(api.assessments.getAssessment, { assessmentId, revision: 1 });
    expect(first.shown.inputs.lines).toHaveLength(0);
    expect(first.shown.isCurrent).toBe(false);
  });

  test("rejects stale saves, bad inputs and unexplained duty factors", async () => {
    const c = await setup();
    const { customerId, siteId } = await customerWithSite(c.asOwner, c.tenantId);
    const { assessmentId } = await c.asOwner.mutation(api.assessments.createAssessment, { customerId, siteId });
    const save = (expectedRevision: number, lines: unknown[]) =>
      c.asOwner.mutation(api.assessments.saveAssessment, {
        assessmentId, expectedRevision, inputs: { systemType: "hybrid", lines } as never
      });

    await expect(save(7, [lights])).rejects.toThrow(/changed elsewhere/);
    await expect(save(1, [{ ...lights, powerW: 0 }])).rejects.toThrow(/power/);
    await expect(save(1, [{ ...fridge, dutyJustification: undefined }])).rejects.toThrow(/duty factor/);
    await expect(
      c.asOwner.mutation(api.assessments.saveAssessment, {
        assessmentId, expectedRevision: 1,
        inputs: { systemType: "hybrid", budget: { currency: "XYZ", amountMinor: 100 }, lines: [lights] }
      })
    ).rejects.toThrow(/not a currency/);
  });

  test("completed assessments are locked until reopened", async () => {
    const c = await setup();
    const { customerId, siteId } = await customerWithSite(c.asOwner, c.tenantId);
    const { assessmentId } = await c.asOwner.mutation(api.assessments.createAssessment, { customerId, siteId });

    await expect(c.asOwner.mutation(api.assessments.completeAssessment, { assessmentId })).rejects.toThrow(/at least one/);
    await c.asOwner.mutation(api.assessments.saveAssessment, {
      assessmentId, expectedRevision: 1, inputs: { systemType: "off_grid", lines: [lights] }
    });
    await expect(c.asOwner.mutation(api.assessments.completeAssessment, { assessmentId })).rejects.toThrow(/autonomy/);
    await c.asOwner.mutation(api.assessments.saveAssessment, {
      assessmentId, expectedRevision: 2, inputs: { systemType: "off_grid", autonomyDays: 2, lines: [lights] }
    });
    await c.asOwner.mutation(api.assessments.completeAssessment, { assessmentId });

    await expect(
      c.asOwner.mutation(api.assessments.saveAssessment, {
        assessmentId, expectedRevision: 3, inputs: { systemType: "off_grid", autonomyDays: 3, lines: [lights] }
      })
    ).rejects.toThrow(/completed/);
    await c.asOwner.mutation(api.assessments.reopenAssessment, { assessmentId });
    await c.asOwner.mutation(api.assessments.saveAssessment, {
      assessmentId, expectedRevision: 3, inputs: { systemType: "off_grid", autonomyDays: 3, lines: [lights] }
    });
  });

  test("agents cannot see or edit each other's assessments; technicians read only", async () => {
    const c = await setup([
      { email: "a1@acme.ug", role: "sales_agent" },
      { email: "a2@acme.ug", role: "sales_agent" },
      { email: "tech@acme.ug", role: "technician" }
    ]);
    const a1 = c.as("a1@acme.ug");
    const { customerId, siteId } = await customerWithSite(a1, c.tenantId);
    const { assessmentId } = await a1.mutation(api.assessments.createAssessment, { customerId, siteId });
    const inputs = { systemType: "hybrid" as const, lines: [lights] };

    await expect(c.as("a2@acme.ug").query(api.assessments.getAssessment, { assessmentId })).rejects.toThrow(/not found/);
    await expect(
      c.as("a2@acme.ug").mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs })
    ).rejects.toThrow(/not found/);
    expect((await c.as("a2@acme.ug").query(api.assessments.listAssessments, { tenantId: c.tenantId })).assessments).toHaveLength(0);

    const tech = c.as("tech@acme.ug");
    expect((await tech.query(api.assessments.getAssessment, { assessmentId })).canWrite).toBe(false);
    await expect(
      tech.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs })
    ).rejects.toThrow(/role/);
  });

  test("a site must belong to the customer", async () => {
    const c = await setup();
    const a = await customerWithSite(c.asOwner, c.tenantId, "A");
    const b = await customerWithSite(c.asOwner, c.tenantId, "B");
    await expect(
      c.asOwner.mutation(api.assessments.createAssessment, { customerId: a.customerId, siteId: b.siteId })
    ).rejects.toThrow(/does not belong/);
  });
});
