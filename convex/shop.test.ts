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

describe("customer shop", () => {
  test("only registered customers see the catalogue", async () => {
    const { t, asCustomer } = await setup();
    await expect(t.query(api.shop.catalogue, {})).rejects.toThrow();
    await expect(asCustomer.query(api.shop.catalogue, {})).rejects.toThrow(/account/i);
    await asCustomer.mutation(api.shop.registerCustomer, { name: "Buyer", phone: "+256 700 000000" });
    const cat = await asCustomer.query(api.shop.catalogue, {});
    expect(cat.products).toHaveLength(1);
    const details = await asCustomer.query(api.shop.catalogueDetails, { ids: [cat.products[0].id] });
    expect(details[0].priceMinor).toBe(125_000);
    expect(JSON.stringify(cat) + JSON.stringify(details)).not.toMatch(/cost|margin|floor/i);
    await expect(t.query(api.shop.catalogueDetails, { ids: [cat.products[0].id] })).rejects.toThrow();
  });

  test("an order is priced by the server and staff can confirm it", async () => {
    const { asCustomer, asOwner, tenantId, productId } = await setup();
    await asCustomer.mutation(api.shop.registerCustomer, { name: "Buyer", phone: "+256 700 000000" });
    await asCustomer.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 2 }], deliveryLocation: "Kampala" });
    const mine = await asCustomer.query(api.shop.myOrders, {});
    expect(mine[0].totalMinor).toBe(250_000);

    const staff = await asOwner.query(api.shop.listOrders, { tenantId });
    expect(staff).toHaveLength(1);
    await asOwner.mutation(api.shop.setOrderStatus, { tenantId, orderId: staff[0].id, status: "confirmed" });
    expect((await asCustomer.query(api.shop.myOrders, {}))[0].status).toBe("confirmed");
    // A customer is not staff.
    await expect(asCustomer.query(api.shop.listOrders, { tenantId })).rejects.toThrow();
    await expect(
      asCustomer.mutation(api.shop.placeOrder, { items: [{ productId, quantity: 0 }], deliveryLocation: "x" })
    ).rejects.toThrow();
  });
});
