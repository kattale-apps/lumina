import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { formatMinorUnits, toMinorUnits } from "./lib/money";
import {
  PRICING_ADMINS,
  currentCost,
  isPricingAdmin,
  priceFrom,
  resolveMarginRule
} from "./lib/pricing";
import { missingCritical, validateSpecValues, type SpecValues } from "./lib/specValues";
import { requireText, validateCurrency } from "./lib/validation";

const specValuesArg = v.record(v.string(), v.union(v.number(), v.string(), v.boolean()));
const MAX_LISTED = 500;
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

function validateSku(raw: string) {
  const sku = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(sku)) {
    throw new ConvexError(
      "SKU must be 1–40 characters: letters, digits and . _ / - only, starting with a letter or digit."
    );
  }
  return sku;
}

function validateWarranty(months: number | undefined) {
  if (months === undefined) return undefined;
  if (!Number.isInteger(months) || months < 0 || months > 600) {
    throw new ConvexError("Warranty must be a whole number of months between 0 and 600.");
  }
  return months;
}

async function assertSkuFree(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  sku: string,
  exceptId?: Id<"products">
) {
  const clash = await ctx.db
    .query("products")
    .withIndex("by_tenant_sku", (q) => q.eq("tenantId", tenantId).eq("sku", sku))
    .unique();
  if (clash && clash._id !== exceptId) {
    throw new ConvexError(`A product with SKU "${sku}" already exists.`);
  }
}

function productFields(args: {
  name: string;
  brand: string;
  model: string;
  sku: string;
  warrantyMonths?: number;
  description?: string;
}) {
  return {
    name: requireText(args.name, "Product name", 120),
    brand: requireText(args.brand, "Brand", 60),
    model: requireText(args.model, "Model", 60),
    sku: validateSku(args.sku),
    warrantyMonths: validateWarranty(args.warrantyMonths),
    description: args.description?.trim()
      ? requireText(args.description, "Description", 500)
      : undefined
  };
}

export const listProducts = query({
  args: { tenantId: v.id("tenants"), categoryId: v.optional(v.id("productCategories")) },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const admin = isPricingAdmin(membership.role);

    const { categoryId } = args;
    const products = categoryId
      ? await ctx.db
          .query("products")
          .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
          .take(MAX_LISTED)
      : await ctx.db
          .query("products")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .take(MAX_LISTED);

    const categories = new Map<Id<"productCategories">, Doc<"productCategories"> | null>();
    const items = [];
    for (const product of products) {
      // Guards against a categoryId that belongs to another company.
      if (product.tenantId !== args.tenantId) continue;

      if (!categories.has(product.categoryId)) {
        categories.set(product.categoryId, await ctx.db.get(product.categoryId));
      }
      const category = categories.get(product.categoryId);
      if (!category) continue;
      if (!admin && (product.status !== "active" || category.status !== "active")) continue;

      const cost = await currentCost(ctx, product._id);
      const resolved = await resolveMarginRule(ctx, product);
      const price = cost && resolved ? priceFrom(cost, resolved.rule) : null;

      items.push({
        id: product._id,
        categoryId: category._id,
        categoryName: category.name,
        name: product.name,
        brand: product.brand,
        model: product.model,
        sku: product.sku,
        warrantyMonths: product.warrantyMonths ?? null,
        description: product.description ?? "",
        status: product.status,
        specValues: product.specValues as SpecValues,
        specSchemaVersion: product.specSchemaVersion,
        // Spec definition has moved on since these values were entered.
        specsOutOfDate: product.specSchemaVersion !== category.schemaVersion,
        missingCritical: missingCritical(category, product.specValues as SpecValues),
        listPrice: price ? { currency: price.currency, amount: price.list } : null,
        // Cost, margin and floor are restricted to pricing administrators.
        pricing: admin
          ? {
              cost: cost
                ? { currency: cost.currency, amount: formatMinorUnits(cost.amountMinor, cost.currency) }
                : null,
              marginPercent: resolved ? resolved.rule.marginBps / 100 : null,
              floorMarginPercent: resolved ? resolved.rule.floorMarginBps / 100 : null,
              floorPrice: price ? { currency: price.currency, amount: price.floor } : null,
              ruleSource: resolved?.source ?? null
            }
          : null
      });
    }

    return {
      canManage: admin,
      products: items.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

export const createProduct = mutation({
  args: {
    tenantId: v.id("tenants"),
    categoryId: v.id("productCategories"),
    name: v.string(),
    brand: v.string(),
    model: v.string(),
    sku: v.string(),
    warrantyMonths: v.optional(v.number()),
    description: v.optional(v.string()),
    specValues: specValuesArg
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);

    const category = await ctx.db.get(args.categoryId);
    if (!category || category.tenantId !== args.tenantId) {
      throw new ConvexError("Category not found.");
    }
    if (category.status !== "active") {
      throw new ConvexError("This category is archived. Restore it before adding products.");
    }

    const fields = productFields(args);
    await assertSkuFree(ctx, args.tenantId, fields.sku);
    const specValues = validateSpecValues(category, args.specValues);

    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      tenantId: args.tenantId,
      categoryId: category._id,
      ...fields,
      specValues,
      specSchemaVersion: category.schemaVersion,
      status: "active",
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "product.created",
      entityType: "products",
      entityId: productId,
      summary: `Product ${fields.sku} (${fields.name}) created.`,
      metadata: { after: { ...fields, categoryKey: category.key, specValues } }
    });
    return { productId, missingCritical: missingCritical(category, specValues) };
  }
});

export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    name: v.string(),
    brand: v.string(),
    model: v.string(),
    sku: v.string(),
    warrantyMonths: v.optional(v.number()),
    description: v.optional(v.string()),
    specValues: specValuesArg,
    status: v.union(v.literal("active"), v.literal("archived"))
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) throw new ConvexError("Product not found.");
    const { profile } = await requireTenantMembership(ctx, product.tenantId, PRICING_ADMINS);

    const category = await ctx.db.get(product.categoryId);
    if (!category) throw new ConvexError("Category not found.");

    const fields = productFields(args);
    await assertSkuFree(ctx, product.tenantId, fields.sku, product._id);
    const specValues = validateSpecValues(category, args.specValues);

    const before = {
      name: product.name,
      brand: product.brand,
      model: product.model,
      sku: product.sku,
      warrantyMonths: product.warrantyMonths,
      description: product.description,
      specValues: product.specValues,
      status: product.status
    };
    const after = { ...fields, specValues, status: args.status };
    if (sameValue(before, after)) return { changed: false };

    await ctx.db.patch(product._id, {
      ...after,
      specSchemaVersion: category.schemaVersion,
      updatedAt: Date.now()
    });
    await recordAudit(ctx, profile, {
      tenantId: product.tenantId,
      action: "product.updated",
      entityType: "products",
      entityId: product._id,
      summary: `Product ${fields.sku} updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});

/** Compares plain objects regardless of key order. */
function sameValue(a: unknown, b: unknown) {
  const sorted = (_: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
      : value;
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
}

/** Records a new base cost. History is append-only; the latest effective record applies. */
export const setCost = mutation({
  args: {
    productId: v.id("products"),
    currency: v.string(),
    amount: v.number(),
    effectiveFrom: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) throw new ConvexError("Product not found.");
    const { profile, tenant } = await requireTenantMembership(
      ctx,
      product.tenantId,
      PRICING_ADMINS
    );

    const currency = validateCurrency(args.currency);
    if (!tenant.supportedCurrencies.includes(currency)) {
      throw new ConvexError(
        `${currency} is not a supported currency. Add it in company settings first.`
      );
    }
    const amountMinor = toMinorUnits(args.amount, currency);
    if (amountMinor <= 0) throw new ConvexError("Cost must be greater than zero.");

    const now = Date.now();
    const effectiveFrom = args.effectiveFrom ?? now;
    if (!Number.isFinite(effectiveFrom) || effectiveFrom > now + MAX_FUTURE_MS) {
      throw new ConvexError("The effective date cannot be more than a year in the future.");
    }

    const previous = await currentCost(ctx, product._id, now);
    const costId = await ctx.db.insert("costRecords", {
      tenantId: product.tenantId,
      productId: product._id,
      currency,
      amountMinor,
      effectiveFrom,
      createdAt: now,
      createdBy: profile.authSubject
    });
    await recordAudit(ctx, profile, {
      tenantId: product.tenantId,
      action: "product.cost_set",
      entityType: "products",
      entityId: product._id,
      summary: `Cost set for ${product.sku}.`,
      metadata: {
        before: previous
          ? { currency: previous.currency, amountMinor: previous.amountMinor }
          : null,
        after: { currency, amountMinor, effectiveFrom }
      }
    });
    return { costId };
  }
});

export const costHistory = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) throw new ConvexError("Product not found.");
    await requireTenantMembership(ctx, product.tenantId, PRICING_ADMINS);

    const records = await ctx.db
      .query("costRecords")
      .withIndex("by_product_effective", (q) => q.eq("productId", product._id))
      .order("desc")
      .take(20);
    const now = Date.now();
    // Newest first, so the first record already in effect is the one that applies.
    const inForceId = records.find((r) => r.effectiveFrom <= now)?._id;
    return records.map((r) => ({
      id: r._id,
      currency: r.currency,
      amount: formatMinorUnits(r.amountMinor, r.currency),
      effectiveFrom: r.effectiveFrom,
      inForce: r._id === inForceId
    }));
  }
});
