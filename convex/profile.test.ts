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
    const profileId = await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active",
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session`, profileId };
  });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const tech = await registerUser(t, "tech@acme.ug");
  await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "tech@acme.ug", role: "technician" });
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  return { t, tenantId, asOwner, owner, asTech: t.withIdentity({ subject: tech.subject }), tech };
}

const upload = (t: T, bytes: Uint8Array) => t.run((ctx) => ctx.storage.store(new Blob([bytes as BlobPart])));

describe("profiles", () => {
  test("a person sets their name, phone and photo; replacing the photo removes the old one", async () => {
    const { t, asTech } = await setup();
    let me = await asTech.query(api.profile.myProfile, {});
    expect(me).toMatchObject({ displayName: "tech", saved: false, complete: false, photoUrl: null });

    await expect(asTech.mutation(api.profile.updateProfile, { displayName: " ", phone: "" })).rejects.toThrow(/full name/);
    await expect(asTech.mutation(api.profile.updateProfile, { displayName: "Tom Okello", phone: "abc" })).rejects.toThrow(/phone/i);
    await asTech.mutation(api.profile.updateProfile, { displayName: "  Tom   Okello ", phone: "+256 700 123456" });
    me = await asTech.query(api.profile.myProfile, {});
    expect(me).toMatchObject({ displayName: "Tom Okello", saved: true, complete: false });

    const first = await upload(t, PNG);
    await asTech.action(api.profile.setPhoto, { storageId: first });
    me = await asTech.query(api.profile.myProfile, {});
    expect(me!.complete).toBe(true);
    expect(me!.photoUrl).toBeTruthy();

    const second = await upload(t, PNG);
    await asTech.action(api.profile.setPhoto, { storageId: second });
    expect(await t.run((ctx) => ctx.storage.get(first))).toBeNull();

    // Not a photo: refused and thrown away.
    const text = await upload(t, new TextEncoder().encode("hello, not an image at all"));
    await expect(asTech.action(api.profile.setPhoto, { storageId: text })).rejects.toThrow(/photo/);
    expect(await t.run((ctx) => ctx.storage.get(text))).toBeNull();

    await asTech.mutation(api.profile.removePhoto, {});
    expect((await asTech.query(api.profile.myProfile, {}))!.complete).toBe(false);
  });

  test("a customer's account follows their profile name and phone", async () => {
    const { t } = await setup();
    const buyer = await registerUser(t, "kats@mail.com");
    const asBuyer = t.withIdentity({ subject: buyer.subject });
    await asBuyer.mutation(api.shop.registerCustomer, { name: "Kats", phone: "+256 782 872796" });
    expect((await asBuyer.query(api.profile.myProfile, {}))!.phone).toBe("+256 782 872796");
    await asBuyer.mutation(api.profile.updateProfile, { displayName: "Kats Musumba", phone: "+256 701 000111" });
    const account = await t.run((ctx) => ctx.db.query("customerAccounts").first());
    expect(account).toMatchObject({ name: "Kats Musumba", phone: "+256 701 000111" });
  });
});

describe("all users for the super administrator", () => {
  test("lists staff, customers and people waiting, but not other companies' staff", async () => {
    const { t, tenantId, asOwner, asTech } = await setup();
    const buyer = await registerUser(t, "kats@mail.com");
    await t.withIdentity({ subject: buyer.subject }).mutation(api.shop.registerCustomer, { name: "Kats", phone: "+256 782 872796" });
    await registerUser(t, "newbie@mail.com");
    // Someone who works only for another company.
    await registerUser(t, "boss@other.ug");
    await t.mutation(internal.admin.bootstrapTenant, { companyName: "Other", slug: "other", adminEmail: "boss@other.ug" });

    const people = await asOwner.query(api.users.listAllUsers, { tenantId });
    const byEmail = Object.fromEntries(people.map((p) => [p.email, p]));
    expect(byEmail["owner@acme.ug"]).toMatchObject({ kind: "staff", role: "super_admin" });
    expect(byEmail["tech@acme.ug"]).toMatchObject({ kind: "staff", role: "technician" });
    expect(byEmail["kats@mail.com"]).toMatchObject({ kind: "customer", phone: "+256 782 872796" });
    expect(byEmail["newbie@mail.com"]).toMatchObject({ kind: "waiting" });
    expect(byEmail["boss@other.ug"]).toBeUndefined();

    await expect(asTech.query(api.users.listAllUsers, { tenantId })).rejects.toThrow(/role/);
  });
});

describe("certificate", () => {
  test("prints the holder's current profile name and photo", async () => {
    const { t, tenantId, asTech, tech } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("academyCertificates", {
        tenantId, userId: tech.profileId, number: "SSA-2026-1", holderName: "tech", companyName: "Acme Solar",
        modules: [], issuedAt: Date.now()
      })
    );
    let cert = (await asTech.query(api.academy.overview, { tenantId })).certificate!;
    expect(cert).toMatchObject({ holderName: "tech", photoUrl: null });

    await asTech.mutation(api.profile.updateProfile, { displayName: "Tom Okello", phone: "" });
    await asTech.action(api.profile.setPhoto, { storageId: await upload(t, PNG) });
    const overview = await asTech.query(api.academy.overview, { tenantId });
    cert = overview.certificate!;
    expect(cert.holderName).toBe("Tom Okello");
    expect(cert.photoUrl).toBeTruthy();
    expect(overview.profileComplete).toBe(true);
  });
});
