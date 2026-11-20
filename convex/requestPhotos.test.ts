/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
// A tiny JPEG header is enough for the type check.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "owner@acme.ug" });
    await ctx.db.insert("userProfiles", { authSubject: userId, email: "owner@acme.ug", displayName: "owner", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    return `${userId}|s`;
  });
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, { companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug" });
  const asOwner = t.withIdentity({ subject: owner });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  return { t, asOwner };
}

async function upload(t: ReturnType<typeof convexTest>, body: Uint8Array<ArrayBuffer>) {
  const res = await t.fetch("/request-photo", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body });
  return { status: res.status, json: (await res.json()) as { photoId: string; token: string } };
}

const appliances = { mode: "appliances" as const, category: "residential" as const, items: [{ name: "Refrigerator (medium)", quantity: 1, hoursPerDay: 24 }] };
const person = { name: "Kats", phone: "+256 782 872796", location: "Kampala" };

describe("nameplate photos", () => {
  test("photos upload without an account, attach to the request, and staff see them labelled", async () => {
    const { t, asOwner } = await setup();
    expect((await upload(t, new TextEncoder().encode("not a photo"))).status).toBe(400);
    const fridge = (await upload(t, JPEG)).json;
    const stolen = (await upload(t, JPEG)).json;
    expect(fridge.token).toMatch(/^[0-9a-f]{32}$/);

    const sent = await t.mutation(api.estimator.submitRequest, {
      input: appliances, grid: "unreliable", optionKey: "recommendation", ...person,
      photos: [
        { ...fridge, part: "appliance", label: "Fridge, Medium" },
        // A wrong token is ignored; the request still goes through.
        { photoId: stolen.photoId, token: "0".repeat(32), part: "appliance", label: "Other" }
      ]
    });
    const lead = await asOwner.query(api.responses.getLead, { leadId: sent.requestId as Id<"quoteRequests"> });
    expect(lead.photos).toHaveLength(1);
    expect(lead.photos[0]).toMatchObject({ part: "appliance", label: "Fridge, Medium", extracted: null });
    expect(lead.photos[0].url).toBeTruthy();
  });

  test("the upgrade check takes photos of its parts too", async () => {
    const { t, asOwner } = await setup();
    const inverter = (await upload(t, JPEG)).json;
    const sent = await t.mutation(api.upgrades.submitUpgradeRequest, {
      system: { systemType: "hybrid", systemVoltage: 24, inverter: { ratedW: 3000, hasSolarInput: true } },
      needs: { goals: ["battery"] }, grid: "unreliable", optionKeys: [], ...person,
      photos: [{ ...inverter, part: "inverter", label: "Inverter" }]
    });
    const lead = await asOwner.query(api.responses.getLead, { leadId: sent.requestId as Id<"quoteRequests"> });
    expect(lead.photos.map((p) => p.label)).toEqual(["Inverter"]);
  });

  test("photos never sent with a request are deleted after a few hours", async () => {
    vi.useFakeTimers();
    const { t } = await setup();
    await upload(t, JPEG);
    expect(await t.run((ctx) => ctx.db.query("requestPhotos").collect())).toHaveLength(1);
    vi.advanceTimersByTime(5 * 60 * 60 * 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("requestPhotos").collect())).toHaveLength(0);
  });
});
