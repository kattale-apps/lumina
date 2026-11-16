/**
 * Bulk loading of supplier price lists, run by an operator from the command line
 * (`npx convex run catalogueImport:importProducts ...`). Internal only: the browser cannot call these.
 *
 * Re-running is safe: products are matched by SKU and updated, a new cost is recorded only when the
 * price changed, and an image already attached under the same file name is not added again.
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { addStandardCategories } from "./catalogue";
import { recordAudit } from "./lib/audit";
import { DEFAULT_CATEGORIES } from "./lib/catalogueDefaults";
import { MAX_IMAGES_PER_PRODUCT } from "./lib/files";
import { toMinorUnits } from "./lib/money";
import { currentCost } from "./lib/pricing";
import { normaliseSpecField } from "./lib/specFields";
import { validateSpecValues } from "./lib/specValues";
import { productFields } from "./products";

const DEFAULT_MARGIN_BPS = 2000;
const DEFAULT_FLOOR_BPS = 1000;

async function companyAndOperator(ctx: MutationCtx, slug: string) {
  const tenant = await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!tenant) throw new ConvexError(`No company with slug "${slug}".`);
  const owner = await ctx.db
    .query("memberships")
    .withIndex("by_tenant_role", (q) => q.eq("tenantId", tenant._id).eq("role", "super_admin"))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
  const profile = owner ? await ctx.db.get(owner.userId) : null;
  if (!profile) throw new ConvexError("The company has no active super administrator to record the import under.");
  return { tenant, profile };
}

// Specifications the standard definitions used to require but price lists rarely give. They stay
// critical, so sizing still treats a product without them as "cannot validate".
const NO_LONGER_REQUIRED: Record<string, string[]> = {
  pv_panel: ["voc", "vmp", "isc", "imp"],
  charge_controller: ["max_pv_voltage"],
  protection: ["rated_voltage"]
};

/**
 * Brings a company's existing standard categories up to the current definitions: adds new fields
 * and choice options, and relaxes the requirements above. Never removes or renames anything.
 */
async function upgradeStandardCategories(ctx: MutationCtx, tenantId: Id<"tenants">, profile: Doc<"userProfiles">) {
  const upgraded: string[] = [];
  for (const template of DEFAULT_CATEGORIES) {
    const category = await ctx.db
      .query("productCategories")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId).eq("key", template.key))
      .unique();
    if (!category) continue;
    let changed = false;
    const fields: Doc<"productCategories">["specFields"] = category.specFields.map((f) =>
      f.options ? { ...f, options: [...f.options] } : { ...f }
    );
    for (const want of template.fields) {
      const have = fields.find((f) => f.key === want.key);
      if (!have) {
        fields.push(
          normaliseSpecField({
            key: want.key, label: want.label, type: want.type, unit: want.unit, options: want.options,
            required: want.required ?? false, critical: want.critical ?? false
          })
        );
        changed = true;
        continue;
      }
      if (have.type !== want.type) continue;
      for (const option of want.options ?? []) {
        if (have.options && !have.options.includes(option)) {
          have.options.push(option);
          changed = true;
        }
      }
      if (have.required && NO_LONGER_REQUIRED[template.key]?.includes(want.key)) {
        have.required = false;
        changed = true;
      }
    }
    if (!changed) continue;
    await ctx.db.patch(category._id, { specFields: fields, schemaVersion: category.schemaVersion + 1, updatedAt: Date.now() });
    upgraded.push(template.key);
    await recordAudit(ctx, profile, {
      tenantId,
      action: "category.updated",
      entityType: "productCategories",
      entityId: category._id,
      summary: `Standard category "${category.name}" brought up to date for the price list import.`,
      metadata: { before: { fields: category.specFields }, after: { fields } }
    });
  }
  return upgraded;
}

const item = v.object({
  categoryKey: v.string(),
  sku: v.string(),
  name: v.string(),
  brand: v.string(),
  supplier: v.optional(v.string()),
  model: v.string(),
  description: v.optional(v.string()),
  warrantyMonths: v.optional(v.number()),
  specValues: v.record(v.string(), v.union(v.number(), v.string(), v.boolean())),
  // Supplier price in the company's main currency. Omitted when the list gives none.
  cost: v.optional(v.number())
});

export const importProducts = internalMutation({
  args: {
    tenantSlug: v.string(),
    source: v.string(),
    // Date printed on the price list (ms). Prices take effect from then, so old lists show up as stale.
    priceDate: v.optional(v.number()),
    items: v.array(item)
  },
  handler: async (ctx, args) => {
    const { tenant, profile } = await companyAndOperator(ctx, args.tenantSlug);
    await addStandardCategories(ctx, tenant._id, profile);
    const upgraded = await upgradeStandardCategories(ctx, tenant._id, profile);
    const now = Date.now();

    const defaultRule = await ctx.db
      .query("marginRules")
      .withIndex("by_tenant_scope", (q) => q.eq("tenantId", tenant._id).eq("scope", "default"))
      .first();
    if (!defaultRule) {
      await ctx.db.insert("marginRules", {
        tenantId: tenant._id,
        scope: "default",
        marginBps: DEFAULT_MARGIN_BPS,
        floorMarginBps: DEFAULT_FLOOR_BPS,
        updatedAt: now,
        updatedBy: profile.authSubject
      });
    }

    const categories = new Map<string, Doc<"productCategories">>();
    const counts = { created: 0, updated: 0, costsSet: 0, categoriesUpdated: upgraded.length };
    for (const row of args.items) {
      let category = categories.get(row.categoryKey);
      if (!category) {
        const found = await ctx.db
          .query("productCategories")
          .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenant._id).eq("key", row.categoryKey))
          .unique();
        if (!found) throw new ConvexError(`Unknown category "${row.categoryKey}" for ${row.sku}.`);
        category = found;
        categories.set(row.categoryKey, found);
      }
      const fields = productFields(row);
      const specValues = validateSpecValues(category, row.specValues);
      const existing = await ctx.db
        .query("products")
        .withIndex("by_tenant_sku", (q) => q.eq("tenantId", tenant._id).eq("sku", fields.sku))
        .unique();

      let productId: Id<"products">;
      if (existing) {
        productId = existing._id;
        await ctx.db.patch(productId, {
          ...fields,
          categoryId: category._id,
          specValues,
          specSchemaVersion: category.schemaVersion,
          updatedAt: now
        });
        counts.updated++;
      } else {
        productId = await ctx.db.insert("products", {
          tenantId: tenant._id,
          categoryId: category._id,
          ...fields,
          specValues,
          specSchemaVersion: category.schemaVersion,
          status: "active",
          createdAt: now,
          createdBy: profile.authSubject,
          updatedAt: now
        });
        counts.created++;
      }

      if (row.cost !== undefined) {
        const amountMinor = toMinorUnits(row.cost, tenant.defaultCurrency);
        if (amountMinor <= 0) throw new ConvexError(`Cost for ${fields.sku} must be greater than zero.`);
        const previous = await currentCost(ctx, productId, now);
        if (!previous || previous.amountMinor !== amountMinor || previous.currency !== tenant.defaultCurrency) {
          await ctx.db.insert("costRecords", {
            tenantId: tenant._id,
            productId,
            currency: tenant.defaultCurrency,
            amountMinor,
            effectiveFrom: Math.min(args.priceDate ?? now, now),
            source: args.source,
            createdAt: now,
            createdBy: profile.authSubject
          });
          counts.costsSet++;
        }
      }
    }

    await recordAudit(ctx, profile, {
      tenantId: tenant._id,
      action: "catalogue.imported",
      entityType: "tenants",
      entityId: tenant._id,
      summary: `Price list "${args.source}" imported: ${counts.created} new, ${counts.updated} updated, ${counts.costsSet} costs set.`,
      metadata: { after: counts }
    });
    return counts;
  }
});

/** Upload URLs for product photos; the operator's script posts each file to one. */
export const imageUploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 200) throw new ConvexError("Ask for 1–200 URLs.");
    const urls: string[] = [];
    for (let i = 0; i < args.count; i++) urls.push(await ctx.storage.generateUploadUrl());
    return urls;
  }
});

export const attachImages = internalMutation({
  args: {
    tenantSlug: v.string(),
    images: v.array(v.object({ sku: v.string(), storageId: v.id("_storage"), fileName: v.string() }))
  },
  handler: async (ctx, args) => {
    const { tenant, profile } = await companyAndOperator(ctx, args.tenantSlug);
    let attached = 0;
    const skipped: string[] = [];
    for (const image of args.images) {
      const product = await ctx.db
        .query("products")
        .withIndex("by_tenant_sku", (q) => q.eq("tenantId", tenant._id).eq("sku", image.sku.toUpperCase()))
        .unique();
      const stored = await ctx.db.system.get(image.storageId);
      if (!product || !stored || !stored.contentType?.startsWith("image/")) {
        skipped.push(image.sku);
        await ctx.storage.delete(image.storageId);
        continue;
      }
      const files = await ctx.db
        .query("productFiles")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .collect();
      const images = files.filter((f) => f.kind === "image");
      if (images.some((f) => f.fileName === image.fileName) || images.length >= MAX_IMAGES_PER_PRODUCT) {
        skipped.push(image.sku);
        await ctx.storage.delete(image.storageId);
        continue;
      }
      await ctx.db.insert("productFiles", {
        tenantId: tenant._id,
        productId: product._id,
        storageId: image.storageId,
        kind: "image",
        fileName: image.fileName,
        contentType: stored.contentType,
        size: stored.size,
        createdAt: Date.now(),
        createdBy: profile.authSubject
      });
      attached++;
    }
    await recordAudit(ctx, profile, {
      tenantId: tenant._id,
      action: "catalogue.images_imported",
      entityType: "tenants",
      entityId: tenant._id,
      summary: `${attached} product photos imported.`,
      metadata: { after: { attached, skipped } }
    });
    return { attached, skipped };
  }
});
