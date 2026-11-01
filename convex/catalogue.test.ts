/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { DEFAULT_CATEGORIES } from "./lib/catalogueDefaults";
import { normaliseSpecField } from "./lib/specFields";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId,
      email,
      displayName: email.split("@")[0],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

async function setup(extra: { email: string; role: "inventory_admin" | "sales_agent" | "technician" }[] = []) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const { email, role } of extra) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  return { t, tenantId, asOwner: t.withIdentity({ subject: owner.subject }), people };
}

const base = { required: false, critical: false } as const;

describe("standard category definitions", () => {
  test("every default is internally valid and critical fields are number/choice/boolean with units where numeric", () => {
    const keys = new Set<string>();
    for (const category of DEFAULT_CATEGORIES) {
      expect(keys.has(category.key)).toBe(false);
      keys.add(category.key);
      const fieldKeys = new Set<string>();
      for (const field of category.fields) {
        expect(fieldKeys.has(field.key)).toBe(false);
        fieldKeys.add(field.key);
        expect(() =>
          normaliseSpecField({ ...field, required: field.required ?? false, critical: field.critical ?? false })
        ).not.toThrow();
        if (field.type === "number") expect(field.unit).toBeDefined();
      }
    }
    // Sizing relies on these, so they must exist and be flagged critical.
    const panel = DEFAULT_CATEGORIES.find((c) => c.key === "pv_panel")!;
    for (const key of ["rated_power", "voc", "vmp", "isc", "imp"]) {
      expect(panel.fields.find((f) => f.key === key)?.critical).toBe(true);
    }
    const inverter = DEFAULT_CATEGORIES.find((c) => c.key === "inverter")!;
    for (const key of ["mppt_min_voltage", "mppt_max_voltage", "max_pv_voltage", "surge_power"]) {
      expect(inverter.fields.find((f) => f.key === key)?.critical).toBe(true);
    }
  });
});

describe("loading standard categories", () => {
  test("loads once, is idempotent, preserves edits, and audits", async () => {
    const { t, tenantId, asOwner } = await setup();
    const first = await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
    expect(first.added).toHaveLength(DEFAULT_CATEGORIES.length);

    const { categories } = await asOwner.query(api.catalogue.listCategories, { tenantId });
    expect(categories.map((c) => c.key).sort()).toEqual(DEFAULT_CATEGORIES.map((c) => c.key).sort());
    expect(categories.every((c) => c.schemaVersion === 1 && c.status === "active")).toBe(true);

    const panel = categories.find((c) => c.key === "pv_panel")!;
    await asOwner.mutation(api.catalogue.updateCategory, {
      categoryId: panel.id, name: "PV modules", status: "active"
    });
    const second = await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
    expect(second.added).toEqual([]);
    const renamed = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories.find(
      (c) => c.key === "pv_panel"
    );
    expect(renamed?.name).toBe("PV modules");

    const events = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(events.filter((e) => e.action === "category.created")).toHaveLength(DEFAULT_CATEGORIES.length);
  });
});

describe("custom categories and fields", () => {
  test("creates a category with a derived key and rejects duplicates and bad keys", async () => {
    const { tenantId, asOwner } = await setup();
    await asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Water Heaters" });
    const { categories } = await asOwner.query(api.catalogue.listCategories, { tenantId });
    expect(categories[0]).toMatchObject({ key: "water_heaters", name: "Water Heaters", specFields: [] });

    await expect(
      asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Again", key: "water_heaters" })
    ).rejects.toThrow(/already exists/);
    await expect(
      asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Bad", key: "1 bad key" })
    ).rejects.toThrow(/Category key/);
  });

  test("adds and edits fields, bumping the schema version each time", async () => {
    const { t, tenantId, asOwner } = await setup();
    const { categoryId } = await asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Pumps" });

    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "flow_rate", label: "Flow rate", type: "number", unit: "L/min", ...base
    });
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "drive", label: "Drive", type: "choice", options: ["AC", "DC", "AC"], required: true, critical: true
    });
    let category = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0];
    expect(category.schemaVersion).toBe(3);
    expect(category.specFields.find((f) => f.key === "drive")?.options).toEqual(["AC", "DC"]);

    // Editing label/unit/flags and adding an option is allowed.
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "drive", label: "Drive type", type: "choice", options: ["AC", "DC", "Hybrid"], required: true, critical: true
    });
    category = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0];
    expect(category.specFields.find((f) => f.key === "drive")).toMatchObject({
      label: "Drive type", options: ["AC", "DC", "Hybrid"]
    });
    expect(category.schemaVersion).toBe(4);

    // Re-saving identical values changes nothing, including the version.
    const same = await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "drive", label: "Drive type", type: "choice", options: ["AC", "DC", "Hybrid"], required: true, critical: true
    });
    expect(same).toEqual({ changed: false });
    expect((await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0].schemaVersion).toBe(4);

    const actions = (await t.run((ctx) => ctx.db.query("auditEvents").collect())).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["category.field_added", "category.field_updated"]));
  });

  test("a field's type is permanent and options cannot be removed", async () => {
    const { tenantId, asOwner } = await setup();
    const { categoryId } = await asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Pumps" });
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "drive", label: "Drive", type: "choice", options: ["AC", "DC"], ...base
    });
    await expect(
      asOwner.mutation(api.catalogue.saveSpecField, {
        categoryId, key: "drive", label: "Drive", type: "text", ...base
      })
    ).rejects.toThrow(/type cannot be changed/);
    await expect(
      asOwner.mutation(api.catalogue.saveSpecField, {
        categoryId, key: "drive", label: "Drive", type: "choice", options: ["AC", "Solar"], ...base
      })
    ).rejects.toThrow(/cannot be removed/);
  });

  test("validates field definitions", async () => {
    const { tenantId, asOwner } = await setup();
    const { categoryId } = await asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Misc" });
    const save = (over: Record<string, unknown>) =>
      asOwner.mutation(api.catalogue.saveSpecField, {
        categoryId, key: "f", label: "F", type: "number", unit: "V", ...base, ...over
      } as never);

    await expect(save({ key: "Bad Key" })).rejects.toThrow(/Field key/);
    await expect(save({ label: "  " })).rejects.toThrow(/required/);
    await expect(save({ type: "choice", unit: undefined, options: ["only"] })).rejects.toThrow(/at least two/);
    await expect(save({ type: "text", unit: "V" })).rejects.toThrow(/Only number fields/);
    await expect(save({ type: "text", unit: undefined, options: ["a", "b"] })).rejects.toThrow(/Only choice fields/);
    await expect(save({ unit: "waaaaaaaaaaaaaaaay too long" })).rejects.toThrow(/12 characters/);
  });

  test("retiring a field keeps it but flags it; restoring reverses it", async () => {
    const { tenantId, asOwner } = await setup();
    const { categoryId } = await asOwner.mutation(api.catalogue.createCategory, { tenantId, name: "Misc" });
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "f", label: "F", type: "boolean", ...base
    });
    await asOwner.mutation(api.catalogue.setSpecFieldRetired, { categoryId, key: "f", retired: true });
    let field = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0].specFields[0];
    expect(field.retired).toBe(true);

    // Editing a retired field must not silently un-retire it.
    await asOwner.mutation(api.catalogue.saveSpecField, {
      categoryId, key: "f", label: "F renamed", type: "boolean", ...base
    });
    field = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0].specFields[0];
    expect(field).toMatchObject({ label: "F renamed", retired: true });

    await asOwner.mutation(api.catalogue.setSpecFieldRetired, { categoryId, key: "f", retired: false });
    field = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0].specFields[0];
    expect(field.retired).toBe(false);
    await expect(
      asOwner.mutation(api.catalogue.setSpecFieldRetired, { categoryId, key: "nope", retired: true })
    ).rejects.toThrow(/not found/);
  });
});

describe("catalogue permissions", () => {
  test("inventory_admin manages the catalogue; sales_agent reads active categories only", async () => {
    const { tenantId, t, people } = await setup([
      { email: "stock@acme.ug", role: "inventory_admin" },
      { email: "agent@acme.ug", role: "sales_agent" }
    ]);
    const asStock = t.withIdentity({ subject: people["stock@acme.ug"].subject });
    const asAgent = t.withIdentity({ subject: people["agent@acme.ug"].subject });

    await asStock.mutation(api.catalogue.loadStandardCategories, { tenantId });
    const panel = (await asStock.query(api.catalogue.listCategories, { tenantId })).categories.find(
      (c) => c.key === "pv_panel"
    )!;
    await asStock.mutation(api.catalogue.updateCategory, {
      categoryId: panel.id, name: panel.name, status: "archived"
    });

    const stockView = await asStock.query(api.catalogue.listCategories, { tenantId });
    expect(stockView.canManage).toBe(true);
    expect(stockView.categories.some((c) => c.key === "pv_panel")).toBe(true);

    const agentView = await asAgent.query(api.catalogue.listCategories, { tenantId });
    expect(agentView.canManage).toBe(false);
    expect(agentView.categories.some((c) => c.key === "pv_panel")).toBe(false);
    expect(agentView.categories.length).toBe(DEFAULT_CATEGORIES.length - 1);

    await expect(
      asAgent.mutation(api.catalogue.createCategory, { tenantId, name: "Hack" })
    ).rejects.toThrow(/role does not permit/);
    await expect(
      asAgent.mutation(api.catalogue.saveSpecField, {
        categoryId: panel.id, key: "x", label: "X", type: "text", ...base
      })
    ).rejects.toThrow(/role does not permit/);
  });

  test("catalogues are isolated between companies", async () => {
    const { t, tenantId, asOwner } = await setup();
    await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
    const panel = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories[0];

    const rival = await registerUser(t, "rival@other.ug");
    const { tenantId: otherTenant } = await t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    const asRival = t.withIdentity({ subject: rival.subject });

    expect((await asRival.query(api.catalogue.listCategories, { tenantId: otherTenant })).categories).toEqual([]);
    await expect(asRival.query(api.catalogue.listCategories, { tenantId })).rejects.toThrow(/access/);
    await expect(
      asRival.mutation(api.catalogue.updateCategory, { categoryId: panel.id, name: "Mine", status: "active" })
    ).rejects.toThrow(/access/);
  });
});
