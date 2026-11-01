/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["a1@acme.ug", "sales_agent"], ["a2@acme.ug", "sales_agent"], ["tech@acme.ug", "technician"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  return { t, tenantId, asOwner: t.withIdentity({ subject: owner.subject }), a1: as("a1@acme.ug"), a2: as("a2@acme.ug"), tech: as("tech@acme.ug") };
}

const line = {
  name: "Fridge", quantity: 1, powerW: 150, powerSource: "nameplate" as const, currentType: "ac" as const,
  critical: true, windows: [{ start: 0, end: 24 }]
};
const inputs = (lines = [line]) => ({ systemType: "off_grid" as const, autonomyDays: 1, lines });

const customerOp = (opId: string, clientId: string) => ({
  opId, type: "customer.create" as const, clientId,
  payload: { name: "Field Customer", phone: "+256 700 000333", type: "residential" }
});
const siteOp = (opId: string, clientId: string, customerClientId: string) => ({
  opId, type: "site.create" as const, clientId, customer: { clientId: customerClientId },
  payload: { name: "House", address: "Plot 1", region: "Central", gpsConsent: false, gridAvailability: "unreliable" }
});
const createOp = (opId: string, clientId: string, customerClientId: string, siteClientId: string) => ({
  opId, type: "assessment.create" as const, clientId,
  customer: { clientId: customerClientId }, site: { clientId: siteClientId }
});
const saveOp = (opId: string, assessmentClientId: string, baseRevision: number, payload: unknown = inputs()) => ({
  opId, type: "assessment.save" as const, assessment: { clientId: assessmentClientId }, baseRevision, payload
});

describe("pushing offline work", () => {
  test("a customer, site, assessment and its edits created offline arrive in order", async () => {
    const c = await setup();
    const { outcomes } = await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [
        customerOp("op-1", "cust-1"), siteOp("op-2", "site-1", "cust-1"),
        createOp("op-3", "asmt-1", "cust-1", "site-1"), saveOp("op-4", "asmt-1", 1)
      ]
    });
    expect(outcomes.map((o) => o.status)).toEqual(["applied", "applied", "applied", "applied"]);
    expect(outcomes[3].revision).toBe(2);

    const list = await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId });
    expect(list.assessments).toHaveLength(1);
    const view = await c.a1.query(api.assessments.getAssessment, { assessmentId: list.assessments[0].id });
    expect(view.shown.results.dailyEnergyWh).toBe(3600);
  });

  test("sending the same batch again changes nothing", async () => {
    const c = await setup();
    const operations = [customerOp("op-1", "cust-1"), siteOp("op-2", "site-1", "cust-1")];
    await c.a1.mutation(api.sync.push, { tenantId: c.tenantId, operations });
    const again = await c.a1.mutation(api.sync.push, { tenantId: c.tenantId, operations });
    expect(again.outcomes.every((o) => o.duplicate && o.status === "applied")).toBe(true);
    expect((await c.a1.query(api.customers.listCustomers, { tenantId: c.tenantId })).customers).toHaveLength(1);
  });

  test("a change that fails validation is rejected without blocking independent changes", async () => {
    const c = await setup();
    const { outcomes } = await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [
        { ...customerOp("op-1", "bad"), payload: { name: "X", phone: "abc", type: "residential" } },
        customerOp("op-2", "good")
      ]
    });
    expect(outcomes[0]).toMatchObject({ status: "rejected" });
    expect(outcomes[0].message).toMatch(/phone/);
    expect(outcomes[1].status).toBe("applied");
  });

  test("a change that depends on a rejected one is rejected, not guessed", async () => {
    const c = await setup();
    const { outcomes } = await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [
        { ...customerOp("op-1", "bad"), payload: { name: "X", phone: "abc", type: "residential" } },
        siteOp("op-2", "site-1", "bad")
      ]
    });
    expect(outcomes[1].status).toBe("rejected");
    expect(outcomes[1].message).toMatch(/earlier change/);
  });

  test("offline work never completes an assessment or creates a quotation", async () => {
    const c = await setup();
    await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [customerOp("op-1", "c"), siteOp("op-2", "s", "c"), createOp("op-3", "a", "c", "s"), saveOp("op-4", "a", 1)]
    });
    const { assessments } = await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId });
    expect(assessments[0].status).toBe("draft");
    expect(await c.t.run(async (ctx) => (await ctx.db.query("quotations").collect()).length)).toBe(0);
  });

  test("roles and ownership still apply", async () => {
    const c = await setup();
    await expect(c.tech.mutation(api.sync.push, { tenantId: c.tenantId, operations: [customerOp("op-1", "c")] })).rejects.toThrow(/role/);

    await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [customerOp("op-1", "c"), siteOp("op-2", "s", "c"), createOp("op-3", "a", "c", "s")]
    });
    const { assessments } = await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId });
    const { outcomes } = await c.a2.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [{ opId: "op-9", type: "assessment.save", assessment: { serverId: assessments[0].id }, baseRevision: 1, payload: inputs() }]
    });
    expect(outcomes[0].status).toBe("rejected");
    // Another person cannot replay or read the first person's change ids.
    const replay = await c.a2.mutation(api.sync.push, { tenantId: c.tenantId, operations: [customerOp("op-1", "c")] });
    expect(replay.outcomes[0]).toMatchObject({ status: "rejected", message: "Invalid change id." });
  });
});

describe("conflicts", () => {
  async function conflicted() {
    const c = await setup();
    await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId, operations: [customerOp("op-1", "c"), siteOp("op-2", "s", "c"), createOp("op-3", "a", "c", "s")]
    });
    const { assessments } = await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId });
    const assessmentId = assessments[0].id;
    // The device synced at revision 1; meanwhile the web app saved revision 2.
    await c.a1.mutation(api.assessments.saveAssessment, {
      assessmentId, expectedRevision: 1, inputs: inputs([{ ...line, name: "Freezer", powerW: 200 }])
    });
    const mine = inputs([line, { ...line, name: "Lights", powerW: 20, critical: false }]);
    const { outcomes } = await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [{ opId: "op-5", type: "assessment.save", assessment: { serverId: assessmentId }, baseRevision: 1, payload: mine }]
    });
    return { c, assessmentId, outcome: outcomes[0], mine };
  }

  test("an edit based on an old revision is held, not applied or lost", async () => {
    const { c, assessmentId, outcome } = await conflicted();
    expect(outcome.status).toBe("conflict");
    const view = await c.a1.query(api.assessments.getAssessment, { assessmentId });
    expect(view.assessment.currentRevision).toBe(2);
    expect(view.shown.inputs.lines[0].name).toBe("Freezer"); // the server copy is untouched

    const { conflicts } = await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ mine: { lines: 2 }, server: { revision: 2, lines: 1 } });
    expect((await c.a2.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts).toEqual([]);
  });

  test("the person chooses: use mine creates a new revision on top; use server discards", async () => {
    const { c, assessmentId, mine } = await conflicted();
    const id = (await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts[0].id;
    await expect(c.a2.mutation(api.sync.resolveConflict, { conflictId: id, choice: "use_mine" })).rejects.toThrow(/not found/);

    await c.a1.mutation(api.sync.resolveConflict, { conflictId: id, choice: "use_mine" });
    const view = await c.a1.query(api.assessments.getAssessment, { assessmentId });
    expect(view.assessment.currentRevision).toBe(3);
    expect(view.shown.inputs.lines).toHaveLength(mine.lines.length);
    await expect(c.a1.mutation(api.sync.resolveConflict, { conflictId: id, choice: "use_server" })).rejects.toThrow(/already/);
    expect((await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts).toEqual([]);
  });

  test("keeping the server copy leaves it unchanged", async () => {
    const { c, assessmentId } = await conflicted();
    const id = (await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts[0].id;
    await c.a1.mutation(api.sync.resolveConflict, { conflictId: id, choice: "use_server" });
    expect((await c.a1.query(api.assessments.getAssessment, { assessmentId })).assessment.currentRevision).toBe(2);
  });

  test("an edit to an assessment completed on the server is held too", async () => {
    const c = await setup();
    await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId, operations: [customerOp("op-1", "c"), siteOp("op-2", "s", "c"), createOp("op-3", "a", "c", "s")]
    });
    const assessmentId = (await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId })).assessments[0].id;
    await c.a1.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs: inputs() });
    await c.a1.mutation(api.assessments.completeAssessment, { assessmentId });
    const { outcomes } = await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [{ opId: "op-7", type: "assessment.save", assessment: { serverId: assessmentId }, baseRevision: 2, payload: inputs() }]
    });
    expect(outcomes[0]).toMatchObject({ status: "conflict" });
    expect(outcomes[0].message).toMatch(/completed/);
    const id = (await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts[0].id;
    await expect(c.a1.mutation(api.sync.resolveConflict, { conflictId: id, choice: "use_mine" })).rejects.toThrow(/Reopen/);
  });
});

describe("snapshot", () => {
  test("carries only what the person may see, including their open drafts", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.appliances.loadStandardAppliances, { tenantId: c.tenantId });
    await c.a1.mutation(api.sync.push, {
      tenantId: c.tenantId,
      operations: [customerOp("op-1", "c"), siteOp("op-2", "s", "c"), createOp("op-3", "a", "c", "s"), saveOp("op-4", "a", 1)]
    });
    const mine = await c.a1.query(api.sync.snapshot, { tenantId: c.tenantId });
    expect(mine.customers).toHaveLength(1);
    expect(mine.sites).toHaveLength(1);
    expect(mine.assessments).toHaveLength(1);
    expect(mine.assessments[0].revision).toBe(2);
    expect(mine.appliances.length).toBeGreaterThan(5);
    expect(mine.company.role).toBe("sales_agent");

    const theirs = await c.a2.query(api.sync.snapshot, { tenantId: c.tenantId });
    expect(theirs.customers).toEqual([]);
    expect(theirs.assessments).toEqual([]);
    expect(JSON.stringify(mine)).not.toMatch(/costMinor|floor/);
  });
});
