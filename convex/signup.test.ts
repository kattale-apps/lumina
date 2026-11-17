/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { STILL_SIGNING_IN } from "./lib/signup";
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
  await t.withIdentity({ subject: owner.subject }).mutation(api.estimator.updateEstimatorSettings, {
    tenantId, enabled: true, tariffPerKwh: 800
  });
  return t;
}

const details = { name: "Tom", phone: "+256 777 184889" };

describe("customer sign-up", () => {
  test("details go to the account that matches the email on the form", async () => {
    const t = await setup();
    const tom = await registerUser(t, "tom@mail.com");
    const asTom = t.withIdentity({ subject: tom.subject });
    await asTom.mutation(api.shop.registerCustomer, { ...details, email: " Tom@Mail.com " });
    const accounts = await t.run((ctx) => ctx.db.query("customerAccounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: "Tom", phone: "+256 777 184889" });
  });

  test("a phone still signed in as someone else never gets another person's details", async () => {
    const t = await setup();
    const previous = await registerUser(t, "previous@mail.com");
    await expect(
      t.withIdentity({ subject: previous.subject }).mutation(api.shop.registerCustomer, { ...details, email: "tom@mail.com" })
    ).rejects.toThrow(STILL_SIGNING_IN);
    expect(await t.run((ctx) => ctx.db.query("customerAccounts").collect())).toHaveLength(0);
  });

  test("the email is optional, so older callers keep working", async () => {
    const t = await setup();
    const tom = await registerUser(t, "tom@mail.com");
    await t.withIdentity({ subject: tom.subject }).mutation(api.shop.registerCustomer, details);
    expect(await t.run((ctx) => ctx.db.query("customerAccounts").collect())).toHaveLength(1);
  });
});
