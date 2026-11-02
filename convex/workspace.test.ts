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
      authSubject: userId,
      email,
      displayName: email.split("@")[0],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { profileId, subject: `${userId}|test-session` };
  });
}

/** A company with a super_admin owner and optional extra staff already granted. */
async function setup(extra: { email: string; role: "inventory_admin" | "sales_agent" | "technician" }[] = []) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme",
    slug: "acme",
    adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { profileId: unknown; subject: string }> = {};
  for (const { email, role } of extra) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  return { t, tenantId, asOwner: t.withIdentity({ subject: owner.subject }), owner, people };
}

describe("company settings", () => {
  test("super_admin updates settings; default currency is always supported; audited", async () => {
    const { t, tenantId, asOwner } = await setup();
    const result = await asOwner.mutation(api.settings.updateCompany, {
      tenantId,
      name: "  Acme Energy ",
      defaultCurrency: "usd",
      supportedCurrencies: ["ugx", "KES"]
    });
    expect(result.changed).toBe(true);

    const company = await asOwner.query(api.settings.getCompany, { tenantId });
    expect(company).toMatchObject({
      name: "Acme Energy",
      defaultCurrency: "USD",
      supportedCurrencies: ["USD", "UGX", "KES"]
    });

    const events = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    const update = events.find((e) => e.action === "tenant.settings_updated");
    expect(update?.actorUserId).toBeDefined();
    expect(update?.metadata).toMatchObject({ before: { defaultCurrency: "UGX" } });
  });

  test("rejects bad currencies and blank names; unchanged saves are no-ops", async () => {
    const { tenantId, asOwner } = await setup();
    await expect(
      asOwner.mutation(api.settings.updateCompany, {
        tenantId, name: "Acme", defaultCurrency: "UG", supportedCurrencies: []
      })
    ).rejects.toThrow(/ISO 4217/);
    await expect(
      asOwner.mutation(api.settings.updateCompany, {
        tenantId, name: "  ", defaultCurrency: "UGX", supportedCurrencies: []
      })
    ).rejects.toThrow(/required/);
    expect(
      await asOwner.mutation(api.settings.updateCompany, {
        tenantId, name: "Acme", defaultCurrency: "UGX", supportedCurrencies: ["UGX"]
      })
    ).toEqual({ changed: false });
  });

  test("other roles can read but not change settings", async () => {
    const { tenantId, t, people } = await setup([{ email: "agent@acme.ug", role: "sales_agent" }]);
    const asAgent = t.withIdentity({ subject: people["agent@acme.ug"].subject });
    expect(await asAgent.query(api.settings.getCompany, { tenantId })).toMatchObject({ role: "sales_agent" });
    await expect(
      asAgent.mutation(api.settings.updateCompany, {
        tenantId, name: "Hacked", defaultCurrency: "UGX", supportedCurrencies: []
      })
    ).rejects.toThrow(/role does not permit/);
  });

  test("a user outside the company is refused", async () => {
    const { tenantId, t } = await setup();
    const outsider = await registerUser(t, "outsider@else.ug");
    const asOutsider = t.withIdentity({ subject: outsider.subject });
    await expect(asOutsider.query(api.settings.getCompany, { tenantId })).rejects.toThrow(/access/);
    await expect(asOutsider.query(api.staff.listStaff, { tenantId })).rejects.toThrow(/access/);
  });
});

describe("warehouses", () => {
  test("create normalises the code, rejects duplicates, and audits", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.settings.createWarehouse, {
      tenantId, name: "Kampala Main", code: " kla-main ", location: "Industrial Area"
    });
    await expect(
      asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "Other", code: "KLA-MAIN" })
    ).rejects.toThrow(/already exists/);
    await expect(
      asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "Bad", code: "bad code!" })
    ).rejects.toThrow(/Warehouse code/);

    const { warehouses } = await asOwner.query(api.settings.listWarehouses, { tenantId });
    expect(warehouses).toEqual([
      expect.objectContaining({ name: "Kampala Main", code: "KLA-MAIN", location: "Industrial Area", status: "active" })
    ]);
    const events = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(events.map((e) => e.action)).toContain("warehouse.created");
  });

  test("update can rename and deactivate, but cannot take another warehouse's code", async () => {
    const { tenantId, asOwner } = await setup();
    const { warehouseId } = await asOwner.mutation(api.settings.createWarehouse, {
      tenantId, name: "A", code: "A1"
    });
    await asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "B", code: "B1" });

    await expect(
      asOwner.mutation(api.settings.updateWarehouse, {
        warehouseId, name: "A", code: "B1", status: "active"
      })
    ).rejects.toThrow(/already exists/);

    await asOwner.mutation(api.settings.updateWarehouse, {
      warehouseId, name: "Alpha", code: "A1", status: "inactive"
    });
    const { warehouses } = await asOwner.query(api.settings.listWarehouses, { tenantId });
    expect(warehouses.find((w) => w.code === "A1")).toMatchObject({ name: "Alpha", status: "inactive" });
  });

  test("inventory_admin manages warehouses; sales_agent can only view them", async () => {
    const { tenantId, t, people } = await setup([
      { email: "stock@acme.ug", role: "inventory_admin" },
      { email: "agent@acme.ug", role: "sales_agent" }
    ]);
    const asStock = t.withIdentity({ subject: people["stock@acme.ug"].subject });
    const asAgent = t.withIdentity({ subject: people["agent@acme.ug"].subject });

    await asStock.mutation(api.settings.createWarehouse, { tenantId, name: "Depot", code: "DEP" });
    expect((await asStock.query(api.settings.listWarehouses, { tenantId })).canManage).toBe(true);

    const agentView = await asAgent.query(api.settings.listWarehouses, { tenantId });
    expect(agentView.canManage).toBe(false);
    expect(agentView.warehouses).toHaveLength(1);
    await expect(
      asAgent.mutation(api.settings.createWarehouse, { tenantId, name: "X", code: "X" })
    ).rejects.toThrow(/role does not permit/);
  });

  test("warehouses are isolated between companies", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.settings.createWarehouse, { tenantId, name: "Main", code: "MAIN" });

    const rival = await registerUser(t, "rival@other.ug");
    const { tenantId: otherTenant } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    const asRival = t.withIdentity({ subject: rival.subject });

    expect((await asRival.query(api.settings.listWarehouses, { tenantId: otherTenant })).warehouses).toEqual([]);
    await expect(asRival.query(api.settings.listWarehouses, { tenantId })).rejects.toThrow(/access/);
  });
});

describe("staff administration", () => {
  test("lists staff for super_admin only", async () => {
    const { tenantId, asOwner, t, people } = await setup([{ email: "agent@acme.ug", role: "sales_agent" }]);
    const staff = await asOwner.query(api.staff.listStaff, { tenantId });
    expect(staff.map((s) => [s.email, s.role, s.isSelf])).toEqual([
      ["agent@acme.ug", "sales_agent", false],
      ["owner@acme.ug", "super_admin", true]
    ]);
    const asAgent = t.withIdentity({ subject: people["agent@acme.ug"].subject });
    await expect(asAgent.query(api.staff.listStaff, { tenantId })).rejects.toThrow(/role does not permit/);
  });

  test("grants access to a registered user and applies the new role immediately", async () => {
    const { t, tenantId, asOwner } = await setup();
    const tech = await registerUser(t, "tech@acme.ug"); // sign-up stores emails lower-cased
    await asOwner.mutation(api.staff.grantAccess, { tenantId, email: " TECH@acme.ug ", role: "technician" });

    const view = await t.withIdentity({ subject: tech.subject }).query(api.users.viewerContext, {});
    expect(view).toMatchObject({ state: "active", companies: [{ role: "technician" }] });
  });

  test("refuses unknown emails and users who already have access", async () => {
    const { tenantId, asOwner } = await setup([{ email: "agent@acme.ug", role: "sales_agent" }]);
    await expect(
      asOwner.mutation(api.staff.grantAccess, { tenantId, email: "ghost@acme.ug", role: "sales_agent" })
    ).rejects.toThrow(/No Solar Switch account/);
    await expect(
      asOwner.mutation(api.staff.grantAccess, { tenantId, email: "agent@acme.ug", role: "technician" })
    ).rejects.toThrow(/already has access/);
  });

  test("changes roles and suspends/reactivates, with audit events", async () => {
    const { t, tenantId, asOwner } = await setup([{ email: "agent@acme.ug", role: "sales_agent" }]);
    const [agent] = (await asOwner.query(api.staff.listStaff, { tenantId })).filter((s) => !s.isSelf);

    await asOwner.mutation(api.staff.changeRole, { membershipId: agent.membershipId, role: "sales_manager" });
    await asOwner.mutation(api.staff.setAccess, { membershipId: agent.membershipId, status: "suspended" });
    expect(
      (await asOwner.query(api.staff.listStaff, { tenantId })).find((s) => !s.isSelf)
    ).toMatchObject({ role: "sales_manager", status: "suspended" });

    // Re-granting a suspended user reactivates them with the chosen role.
    await asOwner.mutation(api.staff.grantAccess, { tenantId, email: "agent@acme.ug", role: "technician" });
    expect(
      (await asOwner.query(api.staff.listStaff, { tenantId })).find((s) => !s.isSelf)
    ).toMatchObject({ role: "technician", status: "active" });

    const actions = (await t.run((ctx) => ctx.db.query("auditEvents").collect())).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["membership.role_changed", "membership.suspended", "membership.reactivated"])
    );
  });

  test("a suspended user loses access to the company", async () => {
    const { t, asOwner, tenantId, people } = await setup([{ email: "agent@acme.ug", role: "sales_agent" }]);
    const [agent] = (await asOwner.query(api.staff.listStaff, { tenantId })).filter((s) => !s.isSelf);
    await asOwner.mutation(api.staff.setAccess, { membershipId: agent.membershipId, status: "suspended" });

    const asAgent = t.withIdentity({ subject: people["agent@acme.ug"].subject });
    expect(await asAgent.query(api.users.viewerContext, {})).toMatchObject({ state: "awaiting_access" });
    await expect(asAgent.query(api.settings.getCompany, { tenantId })).rejects.toThrow(/access/);
  });

  test("super_admin cannot change their own access, so a company keeps an admin", async () => {
    const { tenantId, asOwner } = await setup();
    const [self] = await asOwner.query(api.staff.listStaff, { tenantId });
    await expect(
      asOwner.mutation(api.staff.changeRole, { membershipId: self.membershipId, role: "sales_agent" })
    ).rejects.toThrow(/own access/);
    await expect(
      asOwner.mutation(api.staff.setAccess, { membershipId: self.membershipId, status: "suspended" })
    ).rejects.toThrow(/own access/);
  });

  test("non-admins cannot grant or modify access, and cannot reach another company's staff", async () => {
    const { t, tenantId, asOwner, people } = await setup([{ email: "stock@acme.ug", role: "inventory_admin" }]);
    const asStock = t.withIdentity({ subject: people["stock@acme.ug"].subject });
    await expect(
      asStock.mutation(api.staff.grantAccess, { tenantId, email: "owner@acme.ug", role: "sales_agent" })
    ).rejects.toThrow(/role does not permit/);

    const [owner] = (await asOwner.query(api.staff.listStaff, { tenantId })).filter((s) => s.isSelf);
    await expect(
      asStock.mutation(api.staff.changeRole, { membershipId: owner.membershipId, role: "sales_agent" })
    ).rejects.toThrow(/role does not permit/);

    const rival = await registerUser(t, "rival@other.ug");
    await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    await expect(
      t.withIdentity({ subject: rival.subject }).mutation(api.staff.changeRole, {
        membershipId: owner.membershipId, role: "sales_agent"
      })
    ).rejects.toThrow(/access/);
  });
});
