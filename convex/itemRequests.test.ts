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
    await ctx.db.insert("userProfiles", { authSubject: userId, email, displayName: email.split("@")[0], status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    return { subject: `${userId}|s` };
  });
}

async function setup(open = true) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug" });
  const as: Record<string, ReturnType<T["withIdentity"]>> = {};
  for (const [email, role] of [["tech@acme.ug", "technician"], ["stock@acme.ug", "inventory_admin"]] as const) {
    const u = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
    as[role] = t.withIdentity({ subject: u.subject });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  await t.mutation(internal.catalogueImport.importProducts, {
    tenantSlug: "acme", source: "test",
    items: [
      { categoryKey: "battery", sku: "B-1", name: "Lithium battery 12V 200Ah", brand: "DEYE", model: "X",
        specValues: { chemistry: "LiFePO4", nominal_voltage: 12.8, capacity_ah: 200, usable_energy: 2.56, has_bms: true }, cost: 1_000_000 },
      { categoryKey: "battery", sku: "B-2", name: "Lithium battery 12V 200Ah", brand: "SRNE", model: "Y",
        specValues: { chemistry: "LiFePO4", nominal_voltage: 12.8, capacity_ah: 200, usable_energy: 2.56, has_bms: true } }
    ]
  });
  if (open) await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800, whatsappNumber: "0782 000123" });
  return { t, tenantId, asOwner, tech: as.technician, stock: as.inventory_admin };
}

const battery = { type: "battery", subtype: "lithium", specs: [{ key: "voltage", value: "12" }, { key: "capacity", value: "200 ah" }], quantity: 2 };
const person = { name: "Kats", phone: "+256 782 872796", location: "Kampala" };

describe("request an item", () => {
  test("the page gets product names to suggest, without prices, only while requests are open", async () => {
    const closed = await setup(false);
    expect(await closed.t.query(api.itemRequests.publicHints, {})).toEqual({ open: false });

    const { t } = await setup();
    const hints = await t.query(api.itemRequests.publicHints, {});
    expect(hints).toMatchObject({ open: true, companyName: "Acme Solar", whatsappNumber: "256782000123" });
    if (!hints.open) throw new Error("closed");
    expect(hints.products).toEqual([{ name: "Lithium battery 12V 200Ah", categoryKey: "battery", part: "Lithium batteries", brands: ["DEYE", "SRNE"] }]);
    expect(JSON.stringify(hints)).not.toMatch(/cost|price|Minor/i);
  });

  test("a request is checked, tidied and kept for sales staff and technicians", async () => {
    const { t, tenantId, tech, stock } = await setup();
    await expect(t.mutation(api.itemRequests.submit, { ...person, items: [] })).rejects.toThrow(/at least one item/);
    await expect(t.mutation(api.itemRequests.submit, { ...person, items: [{ ...battery, type: "spaceship" }] })).rejects.toThrow(/kind of item/);
    await expect(t.mutation(api.itemRequests.submit, { ...person, items: [{ type: "battery", specs: [], quantity: 1 }] })).rejects.toThrow(/choose a size or describe/);
    await expect(t.mutation(api.itemRequests.submit, { ...person, items: [{ ...battery, quantity: 0 }] })).rejects.toThrow(/quantity/);

    const sent = await t.mutation(api.itemRequests.submit, {
      ...person, note: "Deliver on Saturday",
      items: [battery, { type: "other", specs: [{ key: "power", value: "5" }], description: "Mounting rails for 6 panels", quantity: 1 }]
    });
    expect(sent.requestId).toBeTruthy();

    const rows = await tech.query(api.itemRequests.list, { tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].items[0]).toEqual({ type: "battery", subtype: "lithium", specs: [{ key: "voltage", value: "12", unit: "V" }, { key: "capacity", value: "200", unit: "Ah" }], quantity: 2 });
    // A size that does not belong to the kind of item is dropped; the description stays.
    expect(rows[0].items[1]).toMatchObject({ type: "other", specs: [], description: "Mounting rails for 6 panels" });
    expect(rows[0]).toMatchObject({ name: "Kats", location: "Kampala", note: "Deliver on Saturday", status: "new" });
    // Every staff role handles them, the inventory and pricing administrator included.
    expect(await stock.query(api.itemRequests.list, { tenantId })).toHaveLength(1);

    // A technician's menu shows it as new until someone handles it.
    expect((await tech.query(api.inbox.myInbox, {}))?.items).toBe(1);
    await tech.mutation(api.itemRequests.setStatus, { requestId: rows[0].id, status: "contacted" });
    expect((await tech.query(api.inbox.myInbox, {}))?.items).toBe(0);
    expect(await tech.query(api.itemRequests.list, { tenantId, status: "new" })).toHaveLength(0);
    expect((await tech.query(api.itemRequests.list, { tenantId, status: "contacted" }))[0].handledBy).toBe("tech");
  });

  test("one phone can send a few requests a day, and bots filling the hidden box are ignored", async () => {
    const { t, tenantId, tech } = await setup();
    expect(await t.mutation(api.itemRequests.submit, { ...person, items: [battery], website: "http://spam" })).toEqual({ requestId: null, whatsappNumber: null });
    for (let i = 0; i < 5; i++) await t.mutation(api.itemRequests.submit, { ...person, items: [battery] });
    await expect(t.mutation(api.itemRequests.submit, { ...person, items: [battery] })).rejects.toThrow(/already have your requests/);
    expect(await tech.query(api.itemRequests.list, { tenantId })).toHaveLength(5);
  });

  test("a signed-in person's request goes to their account", async () => {
    const { t, tenantId, tech } = await setup();
    const buyer = t.withIdentity({ subject: (await registerUser(t, "buyer@mail.com")).subject });
    await buyer.mutation(api.itemRequests.submit, { name: "Buyer", phone: "+256 701 000001", location: "Gulu", items: [battery] });
    expect((await buyer.query(api.shop.myAccount, {})).account).toMatchObject({ name: "Buyer" });
    expect((await tech.query(api.itemRequests.list, { tenantId }))[0].hasAccount).toBe(true);
  });
});
