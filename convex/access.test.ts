/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { acceptInvites, assertSignUpAllowed } from "./access";

const modules = import.meta.glob("./**/*.*s");

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
  return { t, tenantId, asOwner };
}

/** What account creation does: check, make the profile, take up invitations. */
async function signUp(t: ReturnType<typeof convexTest>, email: string) {
  return await t.run(async (ctx) => {
    await assertSignUpAllowed(ctx, email);
    const id = await ctx.db.insert("userProfiles", { authSubject: `user-${email}`, email, displayName: email, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    await acceptInvites(ctx, (await ctx.db.get(id))!);
    return id;
  });
}

describe("accounts are for invited staff only", () => {
  test("a stranger cannot create an account; an invited email can, and gets its access straight away", async () => {
    const { t, tenantId, asOwner } = await setup();
    expect(await t.query(api.access.signUpStatus, {})).toEqual({ publicSignUpOpen: false });
    await expect(signUp(t, "stranger@mail.com")).rejects.toThrow(/staff only/);

    await asOwner.mutation(api.staff.grantAccess, { tenantId, email: "new.tech@acme.ug", role: "technician" });
    const profileId = await signUp(t, "new.tech@acme.ug");
    const memberships = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", profileId)).collect());
    expect(memberships).toMatchObject([{ tenantId, role: "technician", status: "active" }]);
    // The invitation is used up.
    expect(await asOwner.query(api.access.listInvites, { tenantId })).toEqual([]);
  });

  test("a cancelled invitation no longer lets the email sign up", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.staff.grantAccess, { tenantId, email: "temp@acme.ug", role: "sales_agent" });
    const [invite] = await asOwner.query(api.access.listInvites, { tenantId });
    await asOwner.mutation(api.access.cancelInvite, { inviteId: invite.id });
    await expect(signUp(t, "temp@acme.ug")).rejects.toThrow(/staff only/);
  });

  test("switching public sign-up on lets anyone create an account again", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800, publicSignUp: true });
    expect(await t.query(api.access.signUpStatus, {})).toEqual({ publicSignUpOpen: true });
    await expect(signUp(t, "customer@mail.com")).resolves.toBeTruthy();
  });

  test("the very first account, before any company exists, is allowed", async () => {
    const t = convexTest(schema, modules);
    await expect(signUp(t, "founder@acme.ug")).resolves.toBeTruthy();
  });
});
