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
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const cats = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories;
  const { productId } = await asOwner.mutation(api.products.createProduct, {
    tenantId, categoryId: cats.find((c) => c.key === "pv_panel")!.id, name: "Panel", brand: "B", model: "M1", sku: "P-1",
    specValues: { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2, voc_temp_coeff: -0.27, max_system_voltage: 1500 }
  });
  await asOwner.mutation(api.products.setCost, { productId, currency: "UGX", amount: 100_000 });
  await asOwner.mutation(api.margins.setMarginRule, { tenantId, scope: "default", marginPercent: 25, floorMarginPercent: 10 });
  const customer = await registerUser(t, "buyer@mail.com");
  return { t, tenantId, asOwner, productId, asCustomer: t.withIdentity({ subject: customer.subject }) };
}

describe("shop (staff only)", () => {
  test("list prices are for staff only: not the public, not customers; never cost or margin", async () => {
    const { t, asOwner, asCustomer, productId } = await setup();
    // Prices are not confirmed until an agent confirms them, so nobody outside the team sees them.
    expect(await t.query(api.shop.shopAccess, {})).toEqual({ staff: false });
    await expect(t.query(api.shop.catalogue, {})).rejects.toThrow(/staff only/);
    await expect(t.query(api.shop.catalogueDetails, { ids: [productId] })).rejects.toThrow(/staff only/);
    await asCustomer.mutation(api.shop.registerCustomer, { name: "Buyer", phone: "+256 700 000000" });
    expect(await asCustomer.query(api.shop.shopAccess, {})).toEqual({ staff: false });
    await expect(asCustomer.query(api.shop.catalogue, {})).rejects.toThrow(/staff only/);
    await expect(asCustomer.query(api.shop.catalogueDetails, { ids: [productId] })).rejects.toThrow(/staff only/);

    expect(await asOwner.query(api.shop.shopAccess, {})).toEqual({ staff: true });
    const cat = await asOwner.query(api.shop.catalogue, {});
    expect(cat.products).toHaveLength(1);
    const details = await asOwner.query(api.shop.catalogueDetails, { ids: [cat.products[0].id] });
    expect(details[0].priceMinor).toBe(125_000);
    expect(JSON.stringify(cat) + JSON.stringify(details)).not.toMatch(/cost|margin|floor/i);
  });

  test("only staff place orders, and the server sets the price", async () => {
    const { t, asOwner, asCustomer, tenantId, productId } = await setup();
    await expect(
      t.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 1 }], deliveryLocation: "Jinja", name: "Guest", phone: "+256 700 000222" })
    ).rejects.toThrow(/staff only/);
    await asCustomer.mutation(api.shop.registerCustomer, { name: "Buyer", phone: "+256 700 000000" });
    await expect(asCustomer.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 1 }], deliveryLocation: "Jinja" })).rejects.toThrow(/staff only/);

    const placed = await asOwner.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 3 }], deliveryLocation: "Jinja", name: "Owner", phone: "+256 700 000222" });
    expect(placed.orderId).toBeTruthy();
    const orders = await asOwner.query(api.shop.listOrders, { tenantId });
    expect(orders[0]).toMatchObject({ deliveryLocation: "Jinja", totalMinor: 375_000 });
    expect(await asOwner.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 1 }], deliveryLocation: "x", website: "spam" })).toEqual({ orderId: null });
    await expect(asOwner.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 0 }], deliveryLocation: "x" })).rejects.toThrow();

    await asOwner.mutation(api.shop.setOrderStatus, { tenantId, orderId: orders[0].id, status: "confirmed" });
    expect((await asOwner.query(api.shop.listOrders, { tenantId }))[0].status).toBe("confirmed");
    // A customer is not staff.
    await expect(asCustomer.query(api.shop.listOrders, { tenantId })).rejects.toThrow();
  });
});
