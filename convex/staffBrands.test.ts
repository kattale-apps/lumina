/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

/** A company selling Lumina, STAR and Felicity, with a manager, an agent on the manager's team, and a technician. */
async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug" });
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [["mgr@acme.ug", "sales_manager"], ["agent@acme.ug", "sales_agent"], ["tech@acme.ug", "technician"]] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });

  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const panel = cats.find((c) => c.key === "pv_panel")!.id;
  for (const [sku, brand] of [["LUM-1", "LUMINA"], ["LUM-2", "Lumina"], ["STAR-1", "STAR"], ["FEL-1", "Felicity"]]) {
    await asOwner.mutation(api.products.createProduct, {
      tenantId, categoryId: panel, name: `Panel ${sku}`, brand, model: sku, sku,
      specValues: { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 }
    });
  }
  const staff = await asOwner.query(api.staff.listStaff, { tenantId });
  const row = (email: string) => staff.find((s) => s.email === email)!;
  await asOwner.mutation(api.staff.setManager, { membershipId: row("agent@acme.ug").membershipId, managerUserId: row("mgr@acme.ug").userId });
  return {
    t, tenantId, asOwner, mgr: as("mgr@acme.ug"), agent: as("agent@acme.ug"), tech: as("tech@acme.ug"),
    mgrMembership: row("mgr@acme.ug").membershipId as Id<"memberships">,
    agentMembership: row("agent@acme.ug").membershipId as Id<"memberships">,
    techMembership: row("tech@acme.ug").membershipId as Id<"memberships">
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const skusSeenBy = async (who: Ctx["agent"], c: Ctx) =>
  (await who.query(api.products.productIndex, { tenantId: c.tenantId })).products.map((p: { sku: string }) => p.sku).sort();

describe("brands managers and agents can see", () => {
  test("managers and agents start on Lumina only; technicians and admins see everything", async () => {
    const c = await setup();
    expect(await skusSeenBy(c.mgr, c)).toEqual(["LUM-1", "LUM-2"]);
    expect(await skusSeenBy(c.agent, c)).toEqual(["LUM-1", "LUM-2"]);
    expect(await skusSeenBy(c.tech, c)).toEqual(["FEL-1", "LUM-1", "LUM-2", "STAR-1"]);
    expect(await skusSeenBy(c.asOwner, c)).toEqual(["FEL-1", "LUM-1", "LUM-2", "STAR-1"]);
  });

  test("the brand list merges spellings and the staff list shows each person's brands", async () => {
    const c = await setup();
    const choices = await c.asOwner.query(api.staff.brandChoices, { tenantId: c.tenantId });
    expect(choices.brands.map((b) => [b.key, b.products])).toEqual([["felicity", 1], ["lumina", 2], ["star", 1]]);
    const staff = await c.asOwner.query(api.staff.listStaff, { tenantId: c.tenantId });
    expect(staff.find((s) => s.email === "mgr@acme.ug")!.brands).toEqual({ chosen: null, effective: ["lumina"] });
    expect(staff.find((s) => s.email === "tech@acme.ug")!.brands).toBeNull();
    await expect(c.mgr.query(api.staff.brandChoices, { tenantId: c.tenantId })).rejects.toThrow();
  });

  test("an agent follows the manager's brands, and can be narrowed but not widened", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.staff.setBrands, { membershipId: c.mgrMembership, brands: ["Lumina", "STAR"] });
    expect(await skusSeenBy(c.mgr, c)).toEqual(["LUM-1", "LUM-2", "STAR-1"]);
    expect(await skusSeenBy(c.agent, c)).toEqual(["LUM-1", "LUM-2", "STAR-1"]);

    await c.asOwner.mutation(api.staff.setBrands, { membershipId: c.agentMembership, brands: ["star"] });
    expect(await skusSeenBy(c.agent, c)).toEqual(["STAR-1"]);
    await expect(
      c.asOwner.mutation(api.staff.setBrands, { membershipId: c.agentMembership, brands: ["star", "felicity"] })
    ).rejects.toThrow(/manager does not have felicity/);

    // Taking STAR from the manager takes it from the team too.
    await c.asOwner.mutation(api.staff.setBrands, { membershipId: c.mgrMembership, brands: ["lumina"] });
    expect(await skusSeenBy(c.agent, c)).toEqual([]);

    // Back to the default: the agent follows the manager again.
    await c.asOwner.mutation(api.staff.setBrands, { membershipId: c.agentMembership, brands: null });
    expect(await skusSeenBy(c.agent, c)).toEqual(["LUM-1", "LUM-2"]);
  });

  test("only the super admin sets brands, only for managers and agents, and never none", async () => {
    const c = await setup();
    await expect(c.mgr.mutation(api.staff.setBrands, { membershipId: c.agentMembership, brands: ["star"] })).rejects.toThrow();
    await expect(c.asOwner.mutation(api.staff.setBrands, { membershipId: c.techMembership, brands: ["star"] })).rejects.toThrow(/Only sales managers and sales agents/);
    await expect(c.asOwner.mutation(api.staff.setBrands, { membershipId: c.mgrMembership, brands: ["  "] })).rejects.toThrow(/at least one brand/);
  });

  test("the invoice item list and the shop follow the same brands", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.staff.setBrands, { membershipId: c.mgrMembership, brands: ["felicity"] });
    await c.asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId: c.tenantId, enabled: true, tariffPerKwh: 800 });
    const setup2 = await c.mgr.query(api.salesDocuments.formSetup, { tenantId: c.tenantId });
    expect(setup2.products.map((p: { sku: string }) => p.sku)).toEqual(["FEL-1"]);
    const shop = await c.agent.query(api.shop.catalogue, {});
    expect(shop.products.map((p: { brand: string }) => p.brand)).toEqual(["Felicity"]);
  });
});
