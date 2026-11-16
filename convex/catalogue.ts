import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { DEFAULT_CATEGORIES } from "./lib/catalogueDefaults";
import {
  normaliseSpecField,
  slugifyKey,
  validateCategoryKey
} from "./lib/specFields";
import { requireText } from "./lib/validation";
import { specFieldType } from "./schema";

/** Compares plain objects regardless of key order. */
function sameValue(a: unknown, b: unknown) {
  const sorted = (_: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
      : value;
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
}

/** Catalogue structure is administrator controlled. Everyone else reads it. */
const CATALOGUE_ADMINS = ["super_admin", "inventory_admin"] as const;

async function findCategory(ctx: QueryCtx, tenantId: Id<"tenants">, key: string) {
  return await ctx.db
    .query("productCategories")
    .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId).eq("key", key))
    .unique();
}

function describe(category: Doc<"productCategories">) {
  return {
    id: category._id,
    key: category.key,
    name: category.name,
    description: category.description ?? "",
    status: category.status,
    schemaVersion: category.schemaVersion,
    specFields: category.specFields
  };
}

export const listCategories = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const categories = await ctx.db
      .query("productCategories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const canManage = (CATALOGUE_ADMINS as readonly string[]).includes(membership.role);
    return {
      canManage,
      categories: categories
        // Archived categories are only of interest to the people who maintain them.
        .filter((c) => canManage || c.status === "active")
        .map(describe)
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

/** Adds any standard solar categories the company does not have yet. */
export const loadStandardCategories = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, CATALOGUE_ADMINS);
    return { added: await addStandardCategories(ctx, args.tenantId, profile) };
  }
});

/** Adds any standard category the company does not have yet. Existing ones are left as edited. */
export async function addStandardCategories(ctx: MutationCtx, tenantId: Id<"tenants">, profile: Doc<"userProfiles">) {
  const args = { tenantId };
  {
    const now = Date.now();
    const added: string[] = [];

    for (const template of DEFAULT_CATEGORIES) {
      if (await findCategory(ctx, args.tenantId, template.key)) continue;

      const categoryId = await ctx.db.insert("productCategories", {
        tenantId: args.tenantId,
        key: template.key,
        name: template.name,
        description: template.description,
        status: "active",
        specFields: template.fields.map((field) =>
          normaliseSpecField({
            key: field.key,
            label: field.label,
            type: field.type,
            unit: field.unit,
            options: field.options,
            required: field.required ?? false,
            critical: field.critical ?? false
          })
        ),
        schemaVersion: 1,
        createdAt: now,
        createdBy: profile.authSubject,
        updatedAt: now
      });
      added.push(template.key);
      await recordAudit(ctx, profile, {
        tenantId: args.tenantId,
        action: "category.created",
        entityType: "productCategories",
        entityId: categoryId,
        summary: `Standard category "${template.name}" loaded.`,
        metadata: { after: { key: template.key, fields: template.fields.length } }
      });
    }
    return added;
  }
}

export const createCategory = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    key: v.optional(v.string()),
    description: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, CATALOGUE_ADMINS);

    const name = requireText(args.name, "Category name", 60);
    const key = validateCategoryKey(args.key?.trim() ? args.key : slugifyKey(name));
    const description = args.description?.trim()
      ? requireText(args.description, "Description", 200)
      : undefined;
    if (await findCategory(ctx, args.tenantId, key)) {
      throw new ConvexError(`A category with key "${key}" already exists.`);
    }

    const now = Date.now();
    const categoryId = await ctx.db.insert("productCategories", {
      tenantId: args.tenantId,
      key,
      name,
      description,
      status: "active",
      specFields: [],
      schemaVersion: 1,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "category.created",
      entityType: "productCategories",
      entityId: categoryId,
      summary: `Category "${name}" created.`,
      metadata: { after: { key, name, description } }
    });
    return { categoryId };
  }
});

async function loadCategoryForAdmin(ctx: QueryCtx, categoryId: Id<"productCategories">) {
  const category = await ctx.db.get(categoryId);
  if (!category) throw new ConvexError("Category not found.");
  const { profile } = await requireTenantMembership(ctx, category.tenantId, CATALOGUE_ADMINS);
  return { category, profile };
}

export const updateCategory = mutation({
  args: {
    categoryId: v.id("productCategories"),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived"))
  },
  handler: async (ctx, args) => {
    const { category, profile } = await loadCategoryForAdmin(ctx, args.categoryId);

    const name = requireText(args.name, "Category name", 60);
    const description = args.description?.trim()
      ? requireText(args.description, "Description", 200)
      : undefined;

    const before = {
      name: category.name,
      description: category.description,
      status: category.status
    };
    const after = { name, description, status: args.status };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(category._id, { ...after, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: category.tenantId,
      action: "category.updated",
      entityType: "productCategories",
      entityId: category._id,
      summary: `Category "${name}" updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});

/**
 * Adds a specification field, or edits an existing one's label, unit, options
 * and flags. A field's key and type are permanent, and existing options can be
 * added to but not removed, so values already stored against products stay valid.
 */
export const saveSpecField = mutation({
  args: {
    categoryId: v.id("productCategories"),
    key: v.string(),
    label: v.string(),
    type: specFieldType,
    unit: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    required: v.boolean(),
    critical: v.boolean()
  },
  handler: async (ctx, args) => {
    const { category, profile } = await loadCategoryForAdmin(ctx, args.categoryId);
    const { categoryId: _categoryId, ...input } = args;
    const field = normaliseSpecField(input);

    const index = category.specFields.findIndex((f) => f.key === field.key);
    let specFields: Doc<"productCategories">["specFields"];
    let action: string;

    if (index === -1) {
      specFields = [...category.specFields, field];
      action = "category.field_added";
    } else {
      const current = category.specFields[index];
      if (current.type !== field.type) {
        throw new ConvexError("A field's type cannot be changed. Retire it and add a new field.");
      }
      const dropped = (current.options ?? []).filter((o) => !(field.options ?? []).includes(o));
      if (dropped.length > 0) {
        throw new ConvexError(
          `Options cannot be removed once created (${dropped.join(", ")}). Add new options instead.`
        );
      }
      const merged = { ...field, retired: current.retired };
      if (sameValue(merged, current)) return { changed: false };
      specFields = category.specFields.map((f, i) => (i === index ? merged : f));
      action = "category.field_updated";
    }

    await ctx.db.patch(category._id, {
      specFields,
      schemaVersion: category.schemaVersion + 1,
      updatedAt: Date.now()
    });
    await recordAudit(ctx, profile, {
      tenantId: category.tenantId,
      action,
      entityType: "productCategories",
      entityId: category._id,
      summary: `${category.name}: field "${field.label}" ${index === -1 ? "added" : "updated"}.`,
      metadata: {
        before: index === -1 ? undefined : category.specFields[index],
        after: field,
        schemaVersion: category.schemaVersion + 1
      }
    });
    return { changed: true };
  }
});

/** Retired fields stay on existing products but are no longer asked for. */
export const setSpecFieldRetired = mutation({
  args: {
    categoryId: v.id("productCategories"),
    key: v.string(),
    retired: v.boolean()
  },
  handler: async (ctx, args) => {
    const { category, profile } = await loadCategoryForAdmin(ctx, args.categoryId);
    const field = category.specFields.find((f) => f.key === args.key);
    if (!field) throw new ConvexError("Field not found.");
    if (field.retired === args.retired) return { changed: false };

    await ctx.db.patch(category._id, {
      specFields: category.specFields.map((f) =>
        f.key === args.key ? { ...f, retired: args.retired } : f
      ),
      schemaVersion: category.schemaVersion + 1,
      updatedAt: Date.now()
    });
    await recordAudit(ctx, profile, {
      tenantId: category.tenantId,
      action: args.retired ? "category.field_retired" : "category.field_restored",
      entityType: "productCategories",
      entityId: category._id,
      summary: `${category.name}: field "${field.label}" ${args.retired ? "retired" : "restored"}.`,
      metadata: {
        before: { retired: field.retired },
        after: { retired: args.retired },
        schemaVersion: category.schemaVersion + 1
      }
    });
    return { changed: true };
  }
});
