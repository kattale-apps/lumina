/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const battery = (brand: string, sku: string, cost?: number) => ({
  categoryKey: "battery",
  sku,
  name: "Lithium battery 12V 100Ah",
  brand,
  model: "100AH-12V",
  specValues: { chemistry: "LiFePO4", nominal_voltage: 12.8, capacity_ah: 100, usable_energy: 1.28, has_bms: true },
  cost
});

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "owner@acme.ug" });
    await ctx.db.insert("userProfiles", {
      authSubject: userId, email: "owner@acme.ug", displayName: "owner", status: "active", createdAt: Date.now(), updatedAt: Date.now()
    });
    return `${userId}|s`;
  });
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug" });
  return { t, tenantId, asOwner: t.withIdentity({ subject: owner }) };
}

describe("price list import", () => {
  test("creates categories, products, costs and a 20% default margin; re-running only records changed prices", async () => {
    const { t, tenantId, asOwner } = await setup();
    const first = await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "test", items: [battery("Lumina", "LUM-007", 472_500), battery("LC Star", "LCS-004", 400_000)]
    });
    expect(first).toEqual({ created: 2, updated: 0, costsSet: 2, categoriesUpdated: 0 });

    const list = await asOwner.query(api.products.listProducts, { tenantId });
    const lumina = list.products.find((p) => p.sku === "LUM-007")!;
    expect(lumina.brand).toBe("Lumina");
    expect(lumina.pricing?.marginPercent).toBe(20);
    expect(lumina.listPrice?.amount).toMatch(/567,?000/);

    const again = await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "test", items: [battery("Lumina", "LUM-007", 472_500), battery("LC Star", "LCS-004", 390_000)]
    });
    expect(again).toEqual({ created: 0, updated: 2, costsSet: 1, categoriesUpdated: 0 });
    const categories = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories.map((c) => c.key);
    expect(categories).toEqual(expect.arrayContaining(["portable_power", "battery_charger", "solar_lighting"]));
  });

  test("older standard categories gain the new fields and options, and price-list gaps stop blocking products", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
    // Wind the panel, cable and protection definitions back to how they were first shipped.
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("productCategories").collect()) {
        if (c.key === "pv_panel") await ctx.db.patch(c._id, { specFields: c.specFields.map((f) => (["voc", "vmp", "isc", "imp"].includes(f.key) ? { ...f, required: true } : f)) });
        if (c.key === "cable") await ctx.db.patch(c._id, { specFields: c.specFields.filter((f) => f.key !== "awg").map((f) => (f.key === "cable_type" ? { ...f, options: ["DC solar", "AC", "Battery"] } : f)) });
      }
    });
    const res = await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "t",
      items: [
        { categoryKey: "pv_panel", sku: "P-50", name: "Solar panel 50W", brand: "X", model: "50W", specValues: { rated_power: 50 }, cost: 50_000 },
        { categoryKey: "cable", sku: "C-6", name: "Cable 6 mm²", brand: "X", model: "6", specValues: { cable_type: "General purpose", conductor_size: 6, awg: 10, length: 1 }, cost: 19_950 }
      ]
    });
    expect(res).toMatchObject({ created: 2, categoriesUpdated: 2 });
    const panel = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories.find((c) => c.key === "pv_panel")!;
    expect(panel.specFields.find((f) => f.key === "voc")).toMatchObject({ required: false, critical: true });
    expect(panel.schemaVersion).toBe(2);
    // Nothing more to change the second time.
    const again = await t.mutation(internal.catalogueImport.importProducts, { tenantSlug: "acme", source: "t", items: [] });
    expect(again.categoriesUpdated).toBe(0);
  });

  test("products carry the date added and when and where their price was set; bulk updates are all-or-nothing", async () => {
    const { t, tenantId, asOwner } = await setup();
    await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "LUMINA price list", items: [battery("LUMINA", "LUM-007", 472_500), battery("LC STAR", "LCS-004", 400_000)]
    });
    const before = (await asOwner.query(api.products.listProducts, { tenantId })).products;
    const lum = before.find((p) => p.sku === "LUM-007")!;
    const lcs = before.find((p) => p.sku === "LCS-004")!;
    expect(lum.addedAt).toBeGreaterThan(0);
    expect(lum.pricing?.cost).toMatchObject({ source: "LUMINA price list" });
    expect(lum.pricing!.cost!.since).toBeGreaterThan(0);

    // One bad line stops the lot.
    await expect(
      asOwner.mutation(api.products.setCosts, {
        tenantId, currency: "UGX", note: "Bulk +5%",
        changes: [{ productId: lum.id, amount: 496_000 }, { productId: lcs.id, amount: 0 }]
      })
    ).rejects.toThrow(/greater than zero/);
    const res = await asOwner.mutation(api.products.setCosts, {
      tenantId, currency: "UGX", note: "Bulk +5%",
      changes: [{ productId: lum.id, amount: 496_000 }, { productId: lcs.id, amount: 400_000 }]
    });
    expect(res).toEqual({ changed: 1, unchanged: 1 });
    const after = (await asOwner.query(api.products.listProducts, { tenantId })).products.find((p) => p.sku === "LUM-007")!;
    expect(after.pricing?.cost).toMatchObject({ amount: "496000", source: "Bulk +5%" });

    // Only pricing administrators may do it.
    const agent = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "agent@acme.ug" });
      await ctx.db.insert("userProfiles", { authSubject: userId, email: "agent@acme.ug", displayName: "agent", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
      return `${userId}|s`;
    });
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "agent@acme.ug", role: "sales_agent" });
    await expect(
      t.withIdentity({ subject: agent }).mutation(api.products.setCosts, { tenantId, currency: "UGX", changes: [{ productId: lum.id, amount: 1 }] })
    ).rejects.toThrow(/role/);
  });

  test("prices are dated to the price list, and the supplier is shown only to pricing administrators", async () => {
    const { t, tenantId, asOwner } = await setup();
    const listDate = Date.UTC(2025, 3, 1);
    await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "Felicity 2025", priceDate: listDate,
      items: [{ ...battery("DEYE", "BW-SE-G5.1", 2_600_000), supplier: "BATTERY WORLD" }]
    });
    const owned = (await asOwner.query(api.products.listProducts, { tenantId })).products[0];
    expect(owned.supplier).toBe("BATTERY WORLD");
    expect(owned.pricing?.cost?.since).toBe(listDate);

    // A date in the future is pulled back to now, so the price applies straight away.
    await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "later", priceDate: Date.now() + 30 * 86_400_000,
      items: [{ ...battery("DEYE", "BW-SE-G5.1", 2_700_000), supplier: "BATTERY WORLD" }]
    });
    const repriced = (await asOwner.query(api.products.listProducts, { tenantId })).products[0];
    expect(repriced.pricing?.cost?.amount).toBe("2700000");

    const agent = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "agent@acme.ug" });
      await ctx.db.insert("userProfiles", { authSubject: userId, email: "agent@acme.ug", displayName: "agent", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
      return `${userId}|s`;
    });
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "agent@acme.ug", role: "sales_agent" });
    // Agents see Lumina only until given more brands.
    const asAgent = t.withIdentity({ subject: agent });
    expect((await asAgent.query(api.products.listProducts, { tenantId })).products).toEqual([]);
    await t.run(async (ctx) => {
      const m = (await ctx.db.query("memberships").collect()).find((x) => x.role === "sales_agent")!;
      await ctx.db.patch(m._id, { allowedBrands: ["deye"] });
    });
    const seen = (await asAgent.query(api.products.listProducts, { tenantId })).products[0];
    expect(seen.brand).toBe("DEYE");
    expect(seen.supplier).toBe("");
  });

  test("the catalogue can be read as a light index, page by page, or as details for chosen products", async () => {
    const { t, tenantId, asOwner } = await setup();
    await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "t",
      items: [battery("A", "A-1", 100_000), battery("B", "B-1", 200_000), { ...battery("C", "C-1"), supplier: "SUP" }]
    });
    const index = await asOwner.query(api.products.productIndex, { tenantId });
    expect(index.products.map((p) => p.sku).sort()).toEqual(["A-1", "B-1", "C-1"]);
    expect(index.products.find((p) => p.sku === "B-1")!.pricing?.cost?.amount).toBe("200000");
    expect(index.products.find((p) => p.sku === "C-1")!.supplier).toBe("SUP");

    const first = await asOwner.query(api.products.listProducts, { tenantId, pageSize: 2 });
    expect(first.products).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const rest = await asOwner.query(api.products.listProducts, { tenantId, pageSize: 2, cursor: first.continueCursor });
    expect(rest.products).toHaveLength(1);
    expect(rest.isDone).toBe(true);

    const ids = index.products.map((p) => p.id).reverse();
    const details = await asOwner.query(api.products.productDetails, { tenantId, ids });
    expect(details.products.map((p) => p.id)).toEqual(ids);
    expect(details.products.find((p) => p.sku === "A-1")!.listPrice?.amount).toMatch(/120,?000/);
  });

  test("a product with an unknown category or a missing required spec is refused", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(internal.catalogueImport.importProducts, { tenantSlug: "acme", source: "t", items: [{ ...battery("X", "X-1"), categoryKey: "nope" }] })
    ).rejects.toThrow(/Unknown category/);
    await expect(
      t.mutation(internal.catalogueImport.importProducts, { tenantSlug: "acme", source: "t", items: [{ ...battery("X", "X-1"), specValues: { chemistry: "LiFePO4" } }] })
    ).rejects.toThrow(/required/);
  });
});
