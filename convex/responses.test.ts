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
