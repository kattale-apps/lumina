/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { applyMarginBps, formatMinorUnits, toMinorUnits } from "./lib/money";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId,
      email,
      displayName: email.split("@")[0],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

type ExtraRole = "inventory_admin" | "sales_agent" | "technician" | "sales_manager";

/** A company with the standard catalogue loaded and optional extra staff. */
async function setup(extra: { email: string; role: ExtraRole }[] = []) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug",
    supportedCurrencies: ["USD"]
  });
  const people: Record<string, { subject: string }> = {};
  for (const { email, role } of extra) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  // Sales managers and agents see only their chosen brands; give them the brand these tests use.
  await t.run(async (ctx) => {
    for (const m of await ctx.db.query("memberships").collect()) {
      if (m.role === "sales_manager" || m.role === "sales_agent") await ctx.db.patch(m._id, { allowedBrands: ["jinko"] });
    }
  });
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const { categories } = await asOwner.query(api.catalogue.listCategories, { tenantId });
  const panel = categories.find((c) => c.key === "pv_panel")!;
  const battery = categories.find((c) => c.key === "battery")!;
  return { t, tenantId, asOwner, people, panel, battery };
}

const panelSpecs = { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function panelArgs(tenantId: never, categoryId: never, over: Record<string, unknown> = {}): any {
  return {
    tenantId, categoryId, name: "Jinko 550W", brand: "Jinko", model: "JKM550", sku: "pv-550",
    warrantyMonths: 120, specValues: panelSpecs, ...over
  };
}

describe("money arithmetic", () => {
  test("converts to minor units and refuses silent rounding", () => {
    expect(toMinorUnits(1500000, "UGX")).toBe(1500000);
    expect(toMinorUnits(19.99, "USD")).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2, "USD")).toBe(30);
    expect(() => toMinorUnits(10.5, "UGX")).toThrow(/whole numbers/);
    expect(() => toMinorUnits(1.005, "USD")).toThrow(/2 decimal/);
    expect(() => toMinorUnits(-1, "USD")).toThrow(/zero or more/);
    expect(() => toMinorUnits(Number.NaN, "USD")).toThrow();
    expect(() => toMinorUnits(1e15, "USD")).toThrow(/too large/);
    expect(formatMinorUnits(1999, "USD")).toBe("19.99");
    expect(formatMinorUnits(1500000, "UGX")).toBe("1500000");
  });

  test("applies margins with half-up rounding and exact large values", () => {
    expect(applyMarginBps(1_000_000, 2500)).toBe(1_250_000);
    expect(applyMarginBps(333, 1250)).toBe(375); // 374.625
    expect(applyMarginBps(1, 5000)).toBe(2); // 1.5 rounds up
    expect(applyMarginBps(3, 1667)).toBe(4); // 3.5001
    expect(applyMarginBps(999_999_999_999, 10_000)).toBe(1_999_999_999_998);
    expect(applyMarginBps(500, 0)).toBe(500);
  });
});

describe("products", () => {
  test("creates a product with a normalised SKU and reports missing critical specs", async () => {
    const { t, tenantId, asOwner, panel } = await setup();
    const result = await asOwner.mutation(api.products.createProduct, {
      ...panelArgs(tenantId as never, panel.id as never),
      specValues: { ...panelSpecs, voc_temp_coeff: undefined, efficiency: 21.3 }
    } as never);
    expect(result.missingCritical).toEqual(["Voc temperature coefficient", "Maximum system voltage"]);

    const { products } = await asOwner.query(api.products.listProducts, { tenantId });
    expect(products[0]).toMatchObject({
      sku: "PV-550", categoryName: "Solar panels", specSchemaVersion: panel.schemaVersion, specsOutOfDate: false
    });
    expect(products[0].specValues).toMatchObject({ rated_power: 550, efficiency: 21.3 });

    const events = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(events.map((e) => e.action)).toContain("product.created");
  });

  test("enforces unique SKUs, required specs and spec types", async () => {
    const { tenantId, asOwner, panel, battery } = await setup();
    await asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never));

    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "PV-550" }))
    ).rejects.toThrow(/already exists/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "bad sku!" }))
    ).rejects.toThrow(/SKU must be/);

    const missing = { ...panelSpecs } as Record<string, unknown>;
    delete missing.rated_power;
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "A1", specValues: missing }))
    ).rejects.toThrow(/Rated power.*required/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "A2", specValues: { ...panelSpecs, voc: "high" } }))
    ).rejects.toThrow(/must be a number in V/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "A3", specValues: { ...panelSpecs, cell_type: "Quantum" } }))
    ).rejects.toThrow(/must be one of/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "A4", specValues: { ...panelSpecs, nonsense: 1 } }))
    ).rejects.toThrow(/not a specification/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, battery.id as never, { sku: "B1", specValues: { chemistry: "LiFePO4" } }))
    ).rejects.toThrow(/required/);
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never, { sku: "A5", warrantyMonths: 1.5 }))
    ).rejects.toThrow(/Warranty/);
  });

  test("cannot add products to an archived category or another company's category", async () => {
    const { t, tenantId, asOwner, panel } = await setup();
    await asOwner.mutation(api.catalogue.updateCategory, { categoryId: panel.id, name: panel.name, status: "archived" });
    await expect(
      asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never))
    ).rejects.toThrow(/archived/);

    const rival = await registerUser(t, "rival@other.ug");
    const { tenantId: otherTenant } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    await expect(
      t.withIdentity({ subject: rival.subject }).mutation(
        api.products.createProduct, panelArgs(otherTenant as never, panel.id as never)
      )
    ).rejects.toThrow(/Category not found/);
  });

  test("updates re-validate, refresh the spec version, and flag outdated specs", async () => {
    const { tenantId, asOwner, panel } = await setup();
    const { productId } = await asOwner.mutation(api.products.createProduct, panelArgs(tenantId as never, panel.id as never));

    // The category gains a field after the product was entered.
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId: panel.id, key: "bifacial", label: "Bifacial", type: "boolean", required: false, critical: false
    });
    let product = (await asOwner.query(api.products.listProducts, { tenantId })).products[0];
    expect(product.specsOutOfDate).toBe(true);

    const update = {
      productId, name: "Jinko 550W Tiger", brand: "Jinko", model: "JKM550", sku: "pv-550",
      warrantyMonths: 120, specValues: { ...panelSpecs, bifacial: true }, status: "active" as const
    };
    expect((await asOwner.mutation(api.products.updateProduct, update)).changed).toBe(true);
    product = (await asOwner.query(api.products.listProducts, { tenantId })).products[0];
    expect(product).toMatchObject({ name: "Jinko 550W Tiger", specsOutOfDate: false });
    expect((await asOwner.mutation(api.products.updateProduct, update)).changed).toBe(false);

    await expect(
      asOwner.mutation(api.products.updateProduct, { ...update, specValues: { ...panelSpecs, voc: -1 as number, bifacial: "yes" as never } })
    ).rejects.toThrow(/must be yes or no/);
  });
});

describe("costs and pricing", () => {
  async function priced() {
    const ctx = await setup();
    const { productId } = await ctx.asOwner.mutation(
      api.products.createProduct, panelArgs(ctx.tenantId as never, ctx.panel.id as never)
    );
    return { ...ctx, productId };
  }
  const row = async (c: Awaited<ReturnType<typeof priced>>) =>
    (await c.asOwner.query(api.products.listProducts, { tenantId: c.tenantId })).products[0];

  test("an unpriced product has no list price until it has both a cost and a rule", async () => {
    const c = await priced();
    expect((await row(c)).listPrice).toBeNull();
    await c.asOwner.mutation(api.products.setCost, { productId: c.productId, currency: "UGX", amount: 1_000_000 });
    expect((await row(c)).listPrice).toBeNull();
    await c.asOwner.mutation(api.margins.setMarginRule, {
      tenantId: c.tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10
    });
    expect((await row(c)).listPrice).toEqual({ currency: "UGX", amount: "1250000" });
  });

  test("margin rules resolve product over category over default, with floor prices", async () => {
    const c = await priced();
    await c.asOwner.mutation(api.products.setCost, { productId: c.productId, currency: "UGX", amount: 1_000_000 });
    const rule = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.margins.setMarginRule, { tenantId: c.tenantId, ...over } as never);

    await rule({ scope: "default", marginPercent: 20, floorMarginPercent: 5 });
    expect((await row(c)).pricing).toMatchObject({ ruleSource: "default", marginPercent: 20, floorPrice: { amount: "1050000" } });

    await rule({ scope: "category", categoryId: c.panel.id, marginPercent: 30, floorMarginPercent: 12.5 });
    expect((await row(c)).pricing).toMatchObject({ ruleSource: "category", floorPrice: { amount: "1125000" } });
    expect((await row(c)).listPrice?.amount).toBe("1300000");

    await rule({ scope: "product", productId: c.productId, marginPercent: 40, floorMarginPercent: 40 });
    expect((await row(c)).pricing).toMatchObject({ ruleSource: "product", marginPercent: 40 });
    expect((await row(c)).listPrice?.amount).toBe("1400000");

    // Removing the product rule falls back to the category rule.
    const rules = await c.asOwner.query(api.margins.listMarginRules, { tenantId: c.tenantId });
    expect(rules.map((r) => r.scope)).toEqual(["default", "category", "product"]);
    await c.asOwner.mutation(api.margins.removeMarginRule, { ruleId: rules[2].id });
    expect((await row(c)).pricing?.ruleSource).toBe("category");
  });

  test("margin rule validation", async () => {
    const c = await priced();
    const rule = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.margins.setMarginRule, {
        tenantId: c.tenantId, scope: "default", marginPercent: 20, floorMarginPercent: 5, ...over
      } as never);

    await expect(rule({ floorMarginPercent: 25 })).rejects.toThrow(/floor margin cannot be higher/);
    await expect(rule({ marginPercent: -1 })).rejects.toThrow(/between 0%/);
    await expect(rule({ marginPercent: 1001 })).rejects.toThrow(/between 0%/);
    await expect(rule({ marginPercent: 20.123 })).rejects.toThrow(/two decimal/);
    await expect(rule({ scope: "category" })).rejects.toThrow(/Choose a category/);
    await expect(rule({ scope: "product" })).rejects.toThrow(/Choose a product/);

    await rule({});
    expect(await rule({})).toMatchObject({ changed: false });
    const [defaultRule] = await c.asOwner.query(api.margins.listMarginRules, { tenantId: c.tenantId });
    await expect(c.asOwner.mutation(api.margins.removeMarginRule, { ruleId: defaultRule.id })).rejects.toThrow(/cannot be removed/);
  });

  test("costs: currency must be supported, amounts exact, future costs wait their turn", async () => {
    const c = await priced();
    const set = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.products.setCost, { productId: c.productId, currency: "UGX", amount: 100, ...over } as never);

    await expect(set({ currency: "EUR" })).rejects.toThrow(/not a supported currency/);
    await expect(set({ amount: 10.5 })).rejects.toThrow(/whole numbers/);
    await expect(set({ amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(set({ effectiveFrom: Date.now() + 400 * 24 * 3600 * 1000 })).rejects.toThrow(/year in the future/);

    await c.asOwner.mutation(api.margins.setMarginRule, {
      tenantId: c.tenantId, scope: "default", marginPercent: 10, floorMarginPercent: 0
    });
    await set({ amount: 1000 });
    await set({ amount: 9999, effectiveFrom: Date.now() + 30 * 24 * 3600 * 1000 }); // next month
    expect((await row(c)).pricing?.cost).toMatchObject({ currency: "UGX", amount: "1000" });

    await set({ currency: "USD", amount: 19.99 });
    expect((await row(c)).listPrice).toEqual({ currency: "USD", amount: "21.99" });

    const history = await c.asOwner.query(api.products.costHistory, { productId: c.productId });
    expect(history).toHaveLength(3); // rejected attempts leave no record
    expect(history.filter((h) => h.inForce)).toHaveLength(1);
    expect(history.find((h) => h.inForce)).toMatchObject({ currency: "USD", amount: "19.99" });
  });
});

describe("pricing visibility and permissions", () => {
  async function withAgent() {
    const c = await setup([
      { email: "agent@acme.ug", role: "sales_agent" },
      { email: "stock@acme.ug", role: "inventory_admin" },
      { email: "mgr@acme.ug", role: "sales_manager" }
    ]);
    const { productId } = await c.asOwner.mutation(
      api.products.createProduct, panelArgs(c.tenantId as never, c.panel.id as never)
    );
    await c.asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: 1_000_000 });
    await c.asOwner.mutation(api.margins.setMarginRule, {
      tenantId: c.tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10
    });
    const as = (email: string) => c.t.withIdentity({ subject: c.people[email].subject });
    return { ...c, productId, asAgent: as("agent@acme.ug"), asStock: as("stock@acme.ug"), asMgr: as("mgr@acme.ug") };
  }

  test("non-admins see the list price but never cost, margin or floor", async () => {
    const c = await withAgent();
    for (const who of [c.asAgent, c.asMgr]) {
      const view = await who.query(api.products.listProducts, { tenantId: c.tenantId });
      expect(view.canManage).toBe(false);
      expect(view.products[0].listPrice).toEqual({ currency: "UGX", amount: "1250000" });
      expect(view.products[0].pricing).toBeNull();
      const json = JSON.stringify(view);
      expect(json).not.toContain("1000000");
      expect(json).not.toContain("1100000");
    }
    const stock = await c.asStock.query(api.products.listProducts, { tenantId: c.tenantId });
    expect(stock.canManage).toBe(true);
    expect(stock.products[0].pricing?.cost).toMatchObject({ currency: "UGX", amount: "1000000" });
  });

  test("non-admins cannot change products, costs or margin rules, or read them", async () => {
    const c = await withAgent();
    await expect(
      c.asAgent.mutation(api.products.createProduct, panelArgs(c.tenantId as never, c.panel.id as never, { sku: "X1" }))
    ).rejects.toThrow(/role does not permit/);
    await expect(
      c.asMgr.mutation(api.products.setCost, { productId: c.productId, currency: "UGX", amount: 1 })
    ).rejects.toThrow(/role does not permit/);
    await expect(
      c.asMgr.mutation(api.margins.setMarginRule, { tenantId: c.tenantId, scope: "default", marginPercent: 1, floorMarginPercent: 0 })
    ).rejects.toThrow(/role does not permit/);
    await expect(c.asAgent.query(api.margins.listMarginRules, { tenantId: c.tenantId })).rejects.toThrow(/role does not permit/);
    await expect(c.asAgent.query(api.products.costHistory, { productId: c.productId })).rejects.toThrow(/role does not permit/);
  });

  test("archived products and categories are hidden from non-admins only", async () => {
    const c = await withAgent();
    await c.asStock.mutation(api.products.updateProduct, {
      productId: c.productId, name: "Jinko 550W", brand: "Jinko", model: "JKM550", sku: "PV-550",
      warrantyMonths: 120, specValues: panelSpecs, status: "archived"
    });
    expect((await c.asAgent.query(api.products.listProducts, { tenantId: c.tenantId })).products).toHaveLength(0);
    expect((await c.asStock.query(api.products.listProducts, { tenantId: c.tenantId })).products).toHaveLength(1);
  });

  test("companies cannot see or price each other's products", async () => {
    const c = await withAgent();
    const rival = await registerUser(c.t, "rival@other.ug");
    const { tenantId: otherTenant } = await c.t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    const asRival = c.t.withIdentity({ subject: rival.subject });
    expect((await asRival.query(api.products.listProducts, { tenantId: otherTenant })).products).toEqual([]);
    await expect(asRival.query(api.products.listProducts, { tenantId: c.tenantId })).rejects.toThrow(/access/);
    await expect(asRival.mutation(api.products.setCost, { productId: c.productId, currency: "UGX", amount: 1 })).rejects.toThrow(/access/);
    await expect(asRival.query(api.products.costHistory, { productId: c.productId })).rejects.toThrow(/access/);
  });
});
