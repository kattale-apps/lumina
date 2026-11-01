/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { isStale, MemoryBackend, OfflineStore, pendingCount, STALE_AFTER_MS, type Push, type SnapshotShape } from "./store";
import type { Inputs } from "../../app/dashboard/assessments/AssessmentForm";

const modules = import.meta.glob("../../../convex/**/*.*s");
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
  for (const email of ["a1@acme.ug", "a2@acme.ug"]) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role: "sales_agent" });
  }
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.appliances.loadStandardAppliances, { tenantId });
  return { t, tenantId, a1: as("a1@acme.ug"), a2: as("a2@acme.ug") };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type Client = Ctx["a1"];

const snapshotOf = async (client: Client, tenantId: Ctx["tenantId"]) =>
  (await client.query(api.sync.snapshot, { tenantId })) as unknown as SnapshotShape;
const pushVia = (client: Client): Push => async (tenantId, operations) =>
  (await client.mutation(api.sync.push, { tenantId: tenantId as never, operations: operations as never })).outcomes;

const line = {
  name: "Fridge", quantity: 1, powerW: 150, powerSource: "nameplate" as const, currentType: "ac" as const,
  critical: true, windows: [{ start: 0, end: 24 }]
};
const inputs = (n = 1): Inputs => ({
  systemType: "off_grid", autonomyDays: 1, lines: Array.from({ length: n }, (_, i) => ({ ...line, name: `Load ${i}` }))
});

let counter = 0;
const newStore = () => new OfflineStore(new MemoryBackend(), { uuid: () => `id-${++counter}`, now: () => 1_000_000 });

async function ready(c: Ctx, client: Client = c.a1) {
  const store = newStore();
  await store.applySnapshot(await snapshotOf(client, c.tenantId));
  return store;
}

describe("working offline", () => {
  test("a whole field visit is recorded locally, then arrives in order", async () => {
    const c = await setup();
    const store = await ready(c);

    const { clientId: cust } = await store.addCustomer({ name: "Nakato", phone: "+256 700 111222", type: "residential" });
    const { clientId: site } = await store.addSite({ customer: { clientId: cust }, name: "Home", address: "Plot 9", region: "Wakiso", gridAvailability: "unreliable" });
    const { clientId: asmt } = await store.startAssessment({ customer: { clientId: cust }, site: { clientId: site }, customerName: "Nakato", siteName: "Home" });
    await store.saveWork(asmt, inputs(1));
    await store.saveWork(asmt, inputs(2)); // edited again before any signal

    let state = await store.read();
    expect(pendingCount(state)).toBe(4); // one save, not two
    expect(state.outbox.at(-1)?.op).toMatchObject({ type: "assessment.save", baseRevision: 1 });

    const tally = await store.flush(pushVia(c.a1));
    expect(tally).toEqual({ applied: 4, conflicts: 0, rejected: 0 });

    state = await store.read();
    expect(state.outbox).toEqual([]);
    expect(state.work[0]).toMatchObject({ dirty: false, baseRevision: 2, ref: { clientId: asmt } });
    expect(state.work[0].ref.serverId).toBeTruthy();

    const { assessments } = await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId });
    expect(assessments).toHaveLength(1);
    const view = await c.a1.query(api.assessments.getAssessment, { assessmentId: assessments[0].id });
    expect(view.shown.inputs.lines).toHaveLength(2);
    expect(view.assessment.status).toBe("draft");

    // Later edits continue from the new revision, and a refreshed snapshot tidies the local copies.
    await store.saveWork(asmt, inputs(3));
    expect((await store.flush(pushVia(c.a1))).applied).toBe(1);
    await store.applySnapshot(await snapshotOf(c.a1, c.tenantId));
    state = await store.read();
    expect(state.localCustomers).toEqual([]);
    expect(state.work).toHaveLength(1);
    expect(state.work[0].baseRevision).toBe(3);
  });

  test("no connection leaves the queue untouched; a lost response is harmless on retry", async () => {
    const c = await setup();
    const store = await ready(c);
    await store.addCustomer({ name: "Retry", phone: "+256 700 111222", type: "residential" });

    await expect(store.flush(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(pendingCount(await store.read())).toBe(1);

    // The server applies the change but the reply never reaches the device.
    const real = pushVia(c.a1);
    await expect(store.flush(async (t, ops) => { await real(t, ops); throw new Error("connection dropped"); })).rejects.toThrow();
    expect(pendingCount(await store.read())).toBe(1);

    expect((await store.flush(real)).applied).toBe(1);
    expect((await c.a1.query(api.customers.listCustomers, { tenantId: c.tenantId })).customers).toHaveLength(1);
  });

  test("an edit made while the server moved on is held for review, not applied", async () => {
    const c = await setup();
    const seed = newStore();
    await seed.applySnapshot(await snapshotOf(c.a1, c.tenantId));
    await seed.addCustomer({ name: "N", phone: "+256 700 111222", type: "residential" });
    const { clientId: cust } = (await seed.read()).localCustomers[0] ? { clientId: (await seed.read()).localCustomers[0].clientId } : { clientId: "" };
    const { clientId: site } = await seed.addSite({ customer: { clientId: cust }, name: "S", address: "A", region: "R", gridAvailability: "none" });
    await seed.startAssessment({ customer: { clientId: cust }, site: { clientId: site }, customerName: "N", siteName: "S" });
    await seed.flush(pushVia(c.a1));
    const assessmentId = (await c.a1.query(api.assessments.listAssessments, { tenantId: c.tenantId })).assessments[0].id;

    // The device syncs at revision 1 and goes offline.
    const device = await ready(c);
    const key = (await device.read()).work[0].ref.serverId!;
    await device.saveWork(key, inputs(2));

    // Meanwhile the web app saves revision 2.
    await c.a1.mutation(api.assessments.saveAssessment, { assessmentId, expectedRevision: 1, inputs: inputs(1) });

    const tally = await device.flush(pushVia(c.a1));
    expect(tally).toEqual({ applied: 0, conflicts: 1, rejected: 0 });
    const state = await device.read();
    expect(state.outbox).toEqual([]);
    expect(state.work[0].conflict).toBe(true);
    await expect(device.saveWork(key, inputs(4))).rejects.toThrow(/conflict/);

    expect((await c.a1.query(api.sync.listConflicts, { tenantId: c.tenantId })).conflicts).toHaveLength(1);
    const server = await c.a1.query(api.assessments.getAssessment, { assessmentId });
    expect(server.shown.inputs.lines).toHaveLength(1); // the server copy is unchanged

    // Once resolved online, the device lets go of its copy.
    await device.releaseResolvedConflicts([]);
    expect((await device.read()).work).toEqual([]);
  });

  test("a rejected change stays visible with its reason, and discarding it removes what depended on it", async () => {
    const c = await setup();
    const store = await ready(c);
    const { clientId: cust } = await store.addCustomer({ name: "Bad", phone: "abc", type: "residential" });
    const { clientId: site } = await store.addSite({ customer: { clientId: cust }, name: "S", address: "A", region: "R", gridAvailability: "none" });
    await store.startAssessment({ customer: { clientId: cust }, site: { clientId: site }, customerName: "Bad", siteName: "S" });

    const tally = await store.flush(pushVia(c.a1));
    expect(tally.rejected).toBe(3);
    let state = await store.read();
    expect(state.outbox.every((e) => e.state === "rejected")).toBe(true);
    expect(state.outbox[0].message).toMatch(/phone/);
    expect(pendingCount(state)).toBe(0);

    await store.discard(state.outbox[0].opId);
    state = await store.read();
    expect(state.outbox).toEqual([]);
    expect(state.localCustomers).toEqual([]);
    expect(state.localSites).toEqual([]);
    expect(state.work).toEqual([]);
  });

  test("another person on the same device neither sees nor sends the first person's work", async () => {
    const c = await setup();
    const store = await ready(c);
    await store.addCustomer({ name: "Private", phone: "+256 700 111222", type: "residential" });

    await store.applySnapshot(await snapshotOf(c.a2, c.tenantId));
    const state = await store.read();
    expect(state.localCustomers).toEqual([]);
    expect(state.session?.displayName).toBe("a2");
    // The first person's queued change is not sent under the second person's name.
    expect(pendingCount(state)).toBe(0);
    expect((await store.flush(pushVia(c.a2))).applied).toBe(0);
    expect((await c.a2.query(api.customers.listCustomers, { tenantId: c.tenantId })).customers).toEqual([]);
  });

  test("work needs a first online sync, and clearing wipes the device", async () => {
    const store = newStore();
    await expect(store.addCustomer({ name: "X", phone: "+256 700 111222", type: "residential" })).rejects.toThrow(/sync once/);
    const c = await setup();
    const ready1 = await ready(c);
    await ready1.addCustomer({ name: "Y", phone: "+256 700 111222", type: "residential" });
    await ready1.clear();
    expect((await ready1.read()).session).toBeUndefined();
  });

  test("cached prices and stock are marked stale after a day", () => {
    expect(isStale(undefined)).toBe(true);
    expect(isStale(1000, 1000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(1000, 1000 + STALE_AFTER_MS + 1)).toBe(true);
  });
});
