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
// Full records per page, and light index rows in one go (one cost lookup each for admins).
const PAGE_DEFAULT = 200;
const PAGE_MAX = 200;
const MAX_INDEXED = 3000;
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

export function productFields(args: {
  name: string;
  brand: string;
  supplier?: string;
  model: string;
  sku: string;
  warrantyMonths?: number;
  description?: string;
}) {
  return {
    name: requireText(args.name, "Product name", 120),
    brand: requireText(args.brand, "Brand", 60),
    supplier: args.supplier?.trim() ? requireText(args.supplier, "Supplier", 60) : undefined,
    model: requireText(args.model, "Model", 60),
    sku: validateSku(args.sku),
    warrantyMonths: validateWarranty(args.warrantyMonths),
    description: args.description?.trim()
      ? requireText(args.description, "Description", 500)
      : undefined
  };
}

/** Everything a product card shows. Cost, margin and supplier only for pricing administrators. */
async function productView(
  ctx: QueryCtx,
  product: Doc<"products">,
  category: Doc<"productCategories">,
  admin: boolean
) {
  const cost = await currentCost(ctx, product._id);
  const resolved = await resolveMarginRule(ctx, product);
  const price = cost && resolved ? priceFrom(cost, resolved.rule) : null;
  return {
    id: product._id,
    categoryId: category._id,
    categoryName: category.name,
    name: product.name,
    brand: product.brand,
    // Who the company buys from is commercial information, like cost.
    supplier: admin ? (product.supplier ?? "") : "",
    model: product.model,
    sku: product.sku,
    warrantyMonths: product.warrantyMonths ?? null,
    description: product.description ?? "",
    status: product.status,
    specValues: product.specValues as SpecValues,
    specSchemaVersion: product.specSchemaVersion,
    addedAt: product.createdAt,
    // Spec definition has moved on since these values were entered.
    specsOutOfDate: product.specSchemaVersion !== category.schemaVersion,
    missingCritical: missingCritical(category, product.specValues as SpecValues),
    listPrice: price ? { currency: price.currency, amount: price.list } : null,
    pricing: admin
      ? {
          cost: cost
            ? {
                currency: cost.currency,
                amount: formatMinorUnits(cost.amountMinor, cost.currency),
                since: cost.effectiveFrom,
                source: cost.source ?? null
              }
            : null,
          marginPercent: resolved ? resolved.rule.marginBps / 100 : null,
          floorMarginPercent: resolved ? resolved.rule.floorMarginBps / 100 : null,
          floorPrice: price ? { currency: price.currency, amount: price.floor } : null,
          ruleSource: resolved?.source ?? null
        }
      : null
  };
}

/** Loads categories once each and drops products the viewer may not see. */
function categoryCache(ctx: QueryCtx) {
  const cache = new Map<Id<"productCategories">, Doc<"productCategories"> | null>();
  return async (id: Id<"productCategories">) => {
    if (!cache.has(id)) cache.set(id, await ctx.db.get(id));
    return cache.get(id) ?? null;
  };
}

function visible(product: Doc<"products">, category: Doc<"productCategories"> | null, tenantId: Id<"tenants">, admin: boolean) {
  if (product.tenantId !== tenantId || !category) return false;
  return admin || (product.status === "active" && category.status === "active");
}

/**
 * Full product records, one page at a time (by creation order). Used to sync the offline
 * catalogue; screens use productIndex + productDetails instead.
 */
export const listProducts = query({
  args: {
    tenantId: v.id("tenants"),
    categoryId: v.optional(v.id("productCategories")),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const admin = isPricingAdmin(membership.role);
    const numItems = Math.min(Math.max(Math.floor(args.pageSize ?? PAGE_DEFAULT), 1), PAGE_MAX);

    const { categoryId } = args;
    const base = categoryId
      ? ctx.db.query("products").withIndex("by_category", (q) => q.eq("categoryId", categoryId))
      : ctx.db.query("products").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId));
    const page = await base.paginate({ cursor: args.cursor ?? null, numItems });

    const categoryOf = categoryCache(ctx);
    const items = [];
    for (const product of page.page) {
      const category = await categoryOf(product.categoryId);
      if (!visible(product, category, args.tenantId, admin)) continue;
      items.push(await productView(ctx, product, category!, admin));
    }
    return {
      canManage: admin,
      products: items.sort((a, b) => a.name.localeCompare(b.name)),
      isDone: page.isDone,
      continueCursor: page.continueCursor
    };
  }
});

/**
 * A light row for every product: enough to filter, sort, count and bulk-reprice the whole
 * catalogue in the browser, while full cards are fetched a page at a time (productDetails).
 */
export const productIndex = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const admin = isPricingAdmin(membership.role);
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MAX_INDEXED + 1);

    const categoryOf = categoryCache(ctx);
    const rows = [];
    for (const product of products.slice(0, MAX_INDEXED)) {
      const category = await categoryOf(product.categoryId);
      if (!visible(product, category, args.tenantId, admin)) continue;
      const cost = admin ? await currentCost(ctx, product._id) : null;
      rows.push({
        id: product._id,
        categoryId: product.categoryId,
        categoryName: category!.name,
        name: product.name,
        brand: product.brand,
        supplier: admin ? (product.supplier ?? "") : "",
        model: product.model,
        sku: product.sku,
        status: product.status,
        addedAt: product.createdAt,
        pricing: admin
          ? {
              cost: cost
                ? {
                    currency: cost.currency,
                    amount: formatMinorUnits(cost.amountMinor, cost.currency),
                    since: cost.effectiveFrom
                  }
                : null
            }
          : null
      });
    }
    return {
      canManage: admin,
      // More products than one index can hold; the newest are left out until we page the index too.
      truncated: products.length > MAX_INDEXED,
      products: rows.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

/** Full cards for the products on the current page, in the order asked for. */
export const productDetails = query({
  args: { tenantId: v.id("tenants"), ids: v.array(v.id("products")) },
  handler: async (ctx, args) => {
    if (args.ids.length > PAGE_MAX) throw new ConvexError(`At most ${PAGE_MAX} products at a time.`);
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const admin = isPricingAdmin(membership.role);
    const categoryOf = categoryCache(ctx);
    const items = [];
    for (const id of args.ids) {
      const product = await ctx.db.get(id);
      if (!product) continue;
      const category = await categoryOf(product.categoryId);
      if (!visible(product, category, args.tenantId, admin)) continue;
      items.push(await productView(ctx, product, category!, admin));
    }
    return { canManage: admin, products: items };
  }
});

export const createProduct = mutation({
  args: {
    tenantId: v.id("tenants"),
    categoryId: v.id("productCategories"),
    name: v.string(),
    brand: v.string(),
    supplier: v.optional(v.string()),
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
    supplier: v.optional(v.string()),
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
      supplier: product.supplier,
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

const MAX_BULK_COSTS = 300;

/**
 * Sets new costs for many products at once (a category, a brand, or a hand-picked set), e.g. when a
 * supplier sends a new price list. All or nothing: one bad line stops the whole update.
 */
export const setCosts = mutation({
  args: {
    tenantId: v.id("tenants"),
    currency: v.string(),
    changes: v.array(v.object({ productId: v.id("products"), amount: v.number() })),
    // Shown next to the price afterwards, e.g. "LC Star price list 1 Dec" or "Bulk +5%".
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile, tenant } = await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);
    if (args.changes.length === 0) throw new ConvexError("Choose at least one product to update.");
    if (args.changes.length > MAX_BULK_COSTS) {
      throw new ConvexError(`Update at most ${MAX_BULK_COSTS} products at a time.`);
    }
    const currency = validateCurrency(args.currency);
    if (!tenant.supportedCurrencies.includes(currency)) {
      throw new ConvexError(`${currency} is not a supported currency. Add it in company settings first.`);
    }
    const note = args.note?.trim() ? requireText(args.note, "Note", 80) : undefined;
    if (new Set(args.changes.map((c) => c.productId)).size !== args.changes.length) {
      throw new ConvexError("A product appears twice in this update.");
    }

    const now = Date.now();
    let changed = 0;
    for (const change of args.changes) {
      const product = await ctx.db.get(change.productId);
      if (!product || product.tenantId !== args.tenantId) throw new ConvexError("Product not found.");
      const amountMinor = toMinorUnits(change.amount, currency);
      if (amountMinor <= 0) throw new ConvexError(`The new cost for ${product.sku} must be greater than zero.`);

      const previous = await currentCost(ctx, product._id, now);
      if (previous && previous.amountMinor === amountMinor && previous.currency === currency) continue;
      await ctx.db.insert("costRecords", {
        tenantId: args.tenantId,
        productId: product._id,
        currency,
        amountMinor,
        effectiveFrom: now,
        source: note,
        createdAt: now,
        createdBy: profile.authSubject
      });
      await recordAudit(ctx, profile, {
        tenantId: args.tenantId,
        action: "product.cost_set",
        entityType: "products",
        entityId: product._id,
        summary: `Cost set for ${product.sku}${note ? ` (${note})` : ""}.`,
        metadata: {
          before: previous ? { currency: previous.currency, amountMinor: previous.amountMinor } : null,
          after: { currency, amountMinor, effectiveFrom: now, source: note ?? null }
        }
      });
      changed++;
    }
    return { changed, unchanged: args.changes.length - changed };
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
