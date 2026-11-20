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

const appliances = {
  mode: "appliances" as const,
  category: "residential" as const,
  items: [
    { name: "LED bulb", quantity: 5, hoursPerDay: 5 },
    { name: "Refrigerator (medium)", quantity: 1, hoursPerDay: 24 }
  ]
};
const person = { name: "Kats", phone: "+256 782 872796", location: "Town" };

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const as: Record<string, ReturnType<T["withIdentity"]>> = {};
  for (const [email, role] of [["agent@acme.ug", "sales_agent"], ["tech@acme.ug", "technician"]] as const) {
    const u = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
    as[role] = t.withIdentity({ subject: u.subject });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  const buyer = t.withIdentity({ subject: (await registerUser(t, "kats@mail.com")).subject });
  return { t, tenantId, asOwner, tech: as.technician, agent: as.sales_agent, buyer };
}

const option = (key: string, extra: Partial<{ title: string; price: number }> = {}) => ({
  key,
  title: extra.title ?? "3 kVA hybrid with 5 kWh battery",
  description: "Runs the fridge, lights and TV through outages.",
  components: [{ name: "550 W solar panel", quantity: 6 }, { name: "3 kVA hybrid inverter", quantity: 1 }],
  price: extra.price
});

describe("technician responses to quote requests", () => {
  test("a technician sees the full specs and the customer gets the response after signing up", async () => {
    const { t, tenantId, tech, agent, buyer } = await setup();
    const sent = await t.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", ...person
    });
    expect(sent.hasAccount).toBe(false);
    expect(sent.claimToken).toMatch(/^[0-9a-f]{32}$/);
    const leadId = sent.requestId as Id<"quoteRequests">;

    const lead = await tech.query(api.responses.getLead, { leadId });
    expect(lead).toMatchObject({ name: "Kats", category: "residential", gridAvailability: "unreliable", canRespond: true, hasAccount: false });
    expect(lead.appliances.map((a) => a.name)).toEqual(expect.arrayContaining(["LED bulb"]));
    expect(lead.load.peakW).toBeGreaterThan(0);
    expect(lead.response).toBeNull();
    // A sales agent sees only requests assigned to them.
    await expect(agent.query(api.responses.getLead, { leadId })).rejects.toThrow(/not found/);
    await expect(agent.mutation(api.responses.saveResponse, { leadId, message: "x", options: [], send: false })).rejects.toThrow(/role/);

    // Sending needs a message and at least one option with parts.
    await expect(tech.mutation(api.responses.saveResponse, { leadId, message: "Hello", options: [], send: true })).rejects.toThrow(/at least one option/);
    await tech.mutation(api.responses.saveResponse, {
      leadId, message: "", options: [option("opta1", { price: 9_500_000 })], send: false
    });

    // The customer signs up and claims the request from the code kept on the phone.
    await buyer.mutation(api.shop.registerCustomer, { name: "Kats", phone: "+256 782 872796" });
    expect((await buyer.mutation(api.responses.claimRequests, { tokens: [sent.claimToken!] })).claimed).toBe(1);
    expect((await buyer.mutation(api.responses.claimRequests, { tokens: [sent.claimToken!] })).claimed).toBe(0);
    let mine = await buyer.query(api.responses.myRequests, {});
    expect(mine!.requests).toHaveLength(1);
    // Drafts stay with staff.
    expect(mine!.requests[0].response).toBeNull();

    await tech.mutation(api.responses.saveResponse, {
      leadId, message: "Here are two systems that fit.", send: true,
      options: [option("opta1", { price: 9_500_000 }), option("optb2", { title: "5 kVA off-grid" })]
    });
    mine = await buyer.query(api.responses.myRequests, {});
    const response = mine!.requests[0].response!;
    expect(response.message).toBe("Here are two systems that fit.");
    expect(response.options).toHaveLength(2);
    expect(response.options[0].priceMinor).toBe(9_500_000);
    expect(response.options[1].priceMinor).toBeNull();

    await buyer.mutation(api.responses.chooseOption, { requestId: leadId, optionKey: "optb2" });
    const list = await tech.query(api.leads.listLeads, { tenantId });
    expect(list.leads[0]).toMatchObject({ hasAccount: true, responseStatus: "sent", customerChose: true });
  });

  test("a signed-in customer's request goes straight to their account", async () => {
    const { t, buyer } = await setup();
    await buyer.mutation(api.shop.registerCustomer, { name: "Kats", phone: "+256 782 872796" });
    const sent = await buyer.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "none", optionKey: "recommendation", ...person
    });
    expect(sent).toMatchObject({ hasAccount: true, claimToken: null });
    expect((await buyer.query(api.responses.myRequests, {}))!.requests).toHaveLength(1);
    // Someone else cannot pick an option on it.
    const stranger = t.withIdentity({ subject: (await registerUser(t, "x@mail.com")).subject });
    await stranger.mutation(api.shop.registerCustomer, { name: "X", phone: "+256 700 000001" });
    await expect(
      stranger.mutation(api.responses.chooseOption, { requestId: sent.requestId as Id<"quoteRequests">, optionKey: "a" })
    ).rejects.toThrow(/not found/);
  });

  test("removing an option removes its photos", async () => {
    const { t, tech } = await setup();
    const sent = await t.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", ...person
    });
    const leadId = sent.requestId as Id<"quoteRequests">;
    await tech.mutation(api.responses.saveResponse, { leadId, message: "", options: [option("opta1"), option("optb2")], send: false });
    await t.run(async (ctx) => {
      const lead = (await ctx.db.get(leadId))!;
      for (const key of ["opta1", "optb2"]) {
        const storageId = await ctx.storage.store(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]));
        await ctx.db.insert("responseImages", {
          tenantId: lead.tenantId, requestId: leadId, optionKey: key, storageId, contentType: "image/png", size: 4, createdAt: Date.now()
        });
      }
    });
    expect((await tech.query(api.responses.getLead, { leadId })).response!.options.flatMap((o) => o.images)).toHaveLength(2);
    await tech.mutation(api.responses.saveResponse, { leadId, message: "", options: [option("opta1")], send: false });
    const left = await t.run((ctx) => ctx.db.query("responseImages").collect());
    expect(left.map((i) => i.optionKey)).toEqual(["opta1"]);
  });
});

describe("app icon badge", () => {
  const ask = (t: T, key: string) =>
    t.fetch("/app-inbox", { method: "POST", body: JSON.stringify({ key }) }).then((r) => r.json());

  test("technicians are counted for new requests and choices, customers for recommendations, and opening clears it", async () => {
    const { t, tech, buyer } = await setup();
    const techDevice = await tech.mutation(api.inbox.registerDevice, {});
    expect(await ask(t, techDevice.key)).toMatchObject({ count: 0 });

    await buyer.mutation(api.shop.registerCustomer, { name: "Kats", phone: "+256 782 872796" });
    const buyerDevice = await buyer.mutation(api.inbox.registerDevice, {});
    const sent = await buyer.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", ...person
    });
    const leadId = sent.requestId as Id<"quoteRequests">;
    expect(await ask(t, techDevice.key)).toMatchObject({ count: 1, path: "/dashboard/leads" });
    expect((await ask(t, buyerDevice.key)).count).toBe(0);

    await tech.mutation(api.inbox.markSeen, { kind: "staff" });
    expect((await ask(t, techDevice.key)).count).toBe(0);

    await tech.mutation(api.responses.saveResponse, { leadId, message: "Here you go.", options: [option("opta1")], send: true });
    expect(await ask(t, buyerDevice.key)).toMatchObject({ count: 1, path: "/my-requests" });
    expect((await buyer.query(api.inbox.myInbox, {}))!.customer).toBe(1);
    await buyer.mutation(api.inbox.markSeen, { kind: "customer" });
    expect((await ask(t, buyerDevice.key)).count).toBe(0);

    // The customer picking an option shows up for the technician.
    await buyer.mutation(api.responses.chooseOption, { requestId: leadId, optionKey: "opta1" });
    expect((await ask(t, techDevice.key)).count).toBe(1);
  });

  test("a replaced or unknown key stops the phone checking", async () => {
    const { t, tech, buyer } = await setup();
    const first = await tech.mutation(api.inbox.registerDevice, {});
    // Someone else signs in on the same phone: the old key is dropped.
    await buyer.mutation(api.inbox.registerDevice, { previousKey: first.key });
    expect(await ask(t, first.key)).toMatchObject({ count: 0, stop: true });
    const bad = await t.fetch("/app-inbox", { method: "POST", body: JSON.stringify({ key: "nope" }) });
    expect(bad.status).toBe(400);
  });
});

describe("recommendation parts from the catalogue", () => {
  test("a technician finds products with list prices (never cost), links them, and mixes in their own parts", async () => {
    const { t, tenantId, asOwner, tech } = await setup();
    await t.mutation(internal.catalogueImport.importProducts, {
      tenantSlug: "acme", source: "test",
      items: [
        { categoryKey: "battery", sku: "B-1", name: "Lithium battery 48V 100Ah", brand: "DEYE", model: "SE-G5.1",
          specValues: { chemistry: "LiFePO4", nominal_voltage: 51.2, capacity_ah: 100, usable_energy: 5.12, has_bms: true }, cost: 1_000_000 },
        { categoryKey: "battery", sku: "B-2", name: "Lithium battery 12V 100Ah", brand: "YACHU", model: "12.8V 100AH",
          specValues: { chemistry: "LiFePO4", nominal_voltage: 12.8, capacity_ah: 100, usable_energy: 1.28, has_bms: true } }
      ]
    });
    const sent = await t.mutation(api.estimator.submitRequest, { input: appliances, grid: "unreliable", optionKey: "recommendation", ...person });
    const leadId = sent.requestId as Id<"quoteRequests">;

    const found = await tech.query(api.responses.searchCatalogue, { leadId, term: "deye 48v" });
    expect(found.results.map((p) => p.sku)).toEqual(["B-1"]);
    expect(found.results[0].listPriceMinor).toBe(1_200_000); // 20% default margin on top of cost
    expect(JSON.stringify(found)).not.toMatch(/cost|margin|floor/i);
    const all = await tech.query(api.responses.searchCatalogue, { leadId, term: "" });
    expect(all.results.find((p) => p.sku === "B-2")?.listPriceMinor).toBeNull();

    const productId = found.results[0].id;
    await tech.mutation(api.responses.saveResponse, {
      leadId, message: "Hello", send: false,
      options: [{ key: "opta1", title: "5 kWh backup", description: "", price: undefined,
        components: [{ name: "DEYE Lithium battery 48V 100Ah", quantity: 2, productId }, { name: "Installation", quantity: 1 }] }]
    });
    const lead = await tech.query(api.responses.getLead, { leadId });
    expect(lead.response?.options[0].components).toEqual([
      { name: "DEYE Lithium battery 48V 100Ah", quantity: 2, productId },
      { name: "Installation", quantity: 1, productId: null }
    ]);
    expect(await tech.query(api.responses.catalogueParts, { leadId, ids: [productId] })).toEqual({ [productId]: 1_200_000 });

    // A product from another company cannot be linked.
    await registerUser(t, "boss@other.ug");
    const { tenantId: otherTenant } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Other", slug: "other", adminEmail: "boss@other.ug" });
    const other = await t.run(async (ctx) => {
      const tenant = otherTenant;
      const category = await ctx.db.query("productCategories").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first();
      return await ctx.db.insert("products", {
        tenantId: tenant, categoryId: category!._id, name: "X", brand: "X", model: "X", sku: "X-1", specValues: {},
        specSchemaVersion: 1, status: "active", createdAt: Date.now(), createdBy: "x", updatedAt: Date.now()
      });
    });
    await expect(tech.mutation(api.responses.saveResponse, {
      leadId, message: "Hello", send: false,
      options: [{ key: "opta1", title: "T", description: "", components: [{ name: "X", quantity: 1, productId: other }] }]
    })).rejects.toThrow(/not in the catalogue/);
    void asOwner;
  });
});

describe("staff asking for recommendations", () => {
  test("a technician's request reaches their own account, and another technician answers it", async () => {
    const { t, tech } = await setup();
    const second = await registerUser(t, "tech2@acme.ug");
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "tech2@acme.ug", role: "technician" });
    const tech2 = t.withIdentity({ subject: second.subject });

    // Signed in with no customer account yet: a phone is needed, then the account is made.
    await expect(tech.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", name: "Tech One", location: "Mbarara"
    })).rejects.toThrow(/phone/);
    const sent = await tech.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", name: "Tech One", phone: "+256 701 111222", location: "Mbarara"
    });
    expect(sent).toMatchObject({ hasAccount: true, claimToken: null });
    const leadId = sent.requestId as Id<"quoteRequests">;
    expect((await tech.query(api.shop.myAccount, {})).account).toMatchObject({ name: "Tech One", phone: expect.stringContaining("701") });

    // The requester cannot answer it; a colleague can.
    expect(await tech.query(api.responses.getLead, { leadId })).toMatchObject({ canRespond: false, ownRequest: true });
    await expect(tech.mutation(api.responses.saveResponse, {
      leadId, message: "Hello", send: true, options: [option("opta1")]
    })).rejects.toThrow(/your own request/);
    expect(await tech2.query(api.responses.getLead, { leadId })).toMatchObject({ canRespond: true, ownRequest: false });
    await tech2.mutation(api.responses.saveResponse, { leadId, message: "Hello Tech One", send: true, options: [option("opta1")] });

    const mine = await tech.query(api.responses.myRequests, {});
    expect(mine?.requests).toHaveLength(1);
    expect(mine?.requests[0].response?.message).toBe("Hello Tech One");

    // The upgrade check uses the same account from now on.
    const upgrade = await tech.mutation(api.upgrades.submitUpgradeRequest, {
      system: { systemType: "hybrid", systemVoltage: 24, inverter: { ratedW: 3000, hasSolarInput: true } },
      needs: { goals: ["battery"] }, grid: "unreliable", optionKeys: [], location: "Mbarara"
    });
    expect(upgrade.hasAccount).toBe(true);
  });
});
