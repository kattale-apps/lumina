/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Simulates a Convex Auth registration: auth user + Lumina profile. */
async function registerUser(t: ReturnType<typeof convexTest>, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    const profileId = await ctx.db.insert("userProfiles", {
      authSubject: userId,
      email,
      displayName: email.split("@")[0],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { userId, profileId, subject: `${userId}|test-session` };
  });
}

describe("admin.bootstrapTenant", () => {
  test("creates a company, a super_admin membership and audit events", async () => {
    const t = convexTest(schema, modules);
    const owner = await registerUser(t, "owner@acme.ug");

    const { tenantId, membershipId } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "  Acme Solar ",
      slug: "Acme-Solar",
      adminEmail: " OWNER@acme.ug "
    });

    await t.run(async (ctx) => {
      const tenant = await ctx.db.get(tenantId);
      expect(tenant).toMatchObject({
        name: "Acme Solar",
        slug: "acme-solar",
        defaultCurrency: "UGX",
        supportedCurrencies: ["UGX"],
        status: "active"
      });
      const membership = await ctx.db.get(membershipId);
      expect(membership).toMatchObject({
        tenantId,
        userId: owner.profileId,
        role: "super_admin",
        status: "active"
      });
      const events = await ctx.db.query("auditEvents").collect();
      expect(events.map((e) => e.action).sort()).toEqual([
        "membership.granted",
        "tenant.created"
      ]);
      expect(events.every((e) => e.tenantId === tenantId && e.actorSubject === "operator:cli")).toBe(true);
    });
  });

  test("normalises and de-duplicates currencies", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "owner@acme.ug");
    const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Acme",
      slug: "acme",
      adminEmail: "owner@acme.ug",
      defaultCurrency: "ugx",
      supportedCurrencies: ["usd", "UGX", "kes"]
    });
    const tenant = await t.run((ctx) => ctx.db.get(tenantId));
    expect(tenant?.supportedCurrencies).toEqual(["UGX", "USD", "KES"]);
  });

  test("rejects a duplicate slug", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "owner@acme.ug");
    const args = { companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug" };
    await t.mutation(internal.admin.bootstrapTenant, args);
    await expect(t.mutation(internal.admin.bootstrapTenant, args)).rejects.toThrow(/already exists/);
  });

  test("requires the admin to have registered first", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.admin.bootstrapTenant, {
        companyName: "Acme",
        slug: "acme",
        adminEmail: "nobody@acme.ug"
      })
    ).rejects.toThrow(/register at \/sign-in first/);
    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(0);
  });

  test("rejects invalid slugs and currencies", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "owner@acme.ug");
    const base = { companyName: "Acme", adminEmail: "owner@acme.ug" };
    await expect(
      t.mutation(internal.admin.bootstrapTenant, { ...base, slug: "acme solar!" })
    ).rejects.toThrow(/Slug/);
    await expect(
      t.mutation(internal.admin.bootstrapTenant, { ...base, slug: "acme", defaultCurrency: "shillings" })
    ).rejects.toThrow(/ISO 4217/);
  });
});

describe("admin.grantMembership", () => {
  test("grants, is idempotent, and audits role changes", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "owner@acme.ug");
    const agent = await registerUser(t, "agent@acme.ug");
    await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Acme",
      slug: "acme",
      adminEmail: "owner@acme.ug"
    });

    const first = await t.mutation(internal.admin.grantMembership, {
      tenantSlug: "acme",
      email: "agent@acme.ug",
      role: "sales_agent"
    });
    expect(first.changed).toBe(true);

    const again = await t.mutation(internal.admin.grantMembership, {
      tenantSlug: "acme",
      email: "agent@acme.ug",
      role: "sales_agent"
    });
    expect(again).toEqual({ membershipId: first.membershipId, changed: false });

    await t.mutation(internal.admin.grantMembership, {
      tenantSlug: "acme",
      email: "agent@acme.ug",
      role: "technician"
    });

    await t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", agent.profileId))
        .collect();
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("technician");

      const update = (await ctx.db.query("auditEvents").collect()).find(
        (e) => e.action === "membership.updated"
      );
      expect(update?.metadata).toEqual({
        before: { role: "sales_agent", status: "active" },
        after: { role: "technician", status: "active" }
      });
    });
  });

  test("rejects an unknown company", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "agent@acme.ug");
    await expect(
      t.mutation(internal.admin.grantMembership, {
        tenantSlug: "missing",
        email: "agent@acme.ug",
        role: "sales_agent"
      })
    ).rejects.toThrow(/No company/);
  });
});

describe("users.viewerContext", () => {
  test("reports signed_out without an identity", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.users.viewerContext, {})).toEqual({ state: "signed_out" });
  });

  test("moves from awaiting_access to active once provisioned", async () => {
    const t = convexTest(schema, modules);
    const owner = await registerUser(t, "owner@acme.ug");
    const asOwner = t.withIdentity({ subject: owner.subject });

    const before = await asOwner.query(api.users.viewerContext, {});
    expect(before).toMatchObject({ state: "awaiting_access", companies: [] });

    await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Acme Solar",
      slug: "acme-solar",
      adminEmail: "owner@acme.ug"
    });

    const after = await asOwner.query(api.users.viewerContext, {});
    expect(after).toMatchObject({
      state: "active",
      profile: { email: "owner@acme.ug" },
      companies: [{ companyName: "Acme Solar", role: "super_admin", defaultCurrency: "UGX" }]
    });
  });

  test("hides suspended companies and reports disabled profiles", async () => {
    const t = convexTest(schema, modules);
    const owner = await registerUser(t, "owner@acme.ug");
    const asOwner = t.withIdentity({ subject: owner.subject });
    const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Acme",
      slug: "acme",
      adminEmail: "owner@acme.ug"
    });

    await t.run((ctx) => ctx.db.patch(tenantId, { status: "suspended" }));
    expect(await asOwner.query(api.users.viewerContext, {})).toMatchObject({
      state: "awaiting_access"
    });

    await t.run((ctx) => ctx.db.patch(owner.profileId, { status: "disabled" }));
    expect(await asOwner.query(api.users.viewerContext, {})).toEqual({ state: "disabled" });
  });
});
