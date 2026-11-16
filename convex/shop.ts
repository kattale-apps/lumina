import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { findViewerProfile, requireTenantMembership } from "./lib/auth";
import { validatePhone } from "./lib/crm";
import { currencyExponent } from "./lib/money";
import { currentCost, priceFrom, resolveMarginRule } from "./lib/pricing";
import { requireText } from "./lib/validation";

const MAX_LISTED = 3000;
// Prices and photos are looked up for one page of cards (plus the basket) at a time.
const MAX_DETAILS = 150;
const MAX_LINES = 30;
const MAX_ORDERS_PER_DAY = 10;
const DAY = 24 * 60 * 60 * 1000;
const ORDER_STAFF = ["super_admin", "sales_manager", "sales_agent"] as const;

/** The company whose public side is open (the one with the public power check switched on). */
async function openCompany(ctx: QueryCtx) {
  const settings = await ctx.db
    .query("publicEstimatorSettings")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .first();
  if (!settings) return null;
  const tenant = await ctx.db.get(settings.tenantId);
  return tenant && tenant.status === "active" ? tenant : null;
}

async function viewerCustomer(ctx: QueryCtx) {
  const viewer = await findViewerProfile(ctx);
  if (!viewer?.profile || viewer.profile.status !== "active") return null;
  const account = await ctx.db
    .query("customerAccounts")
    .withIndex("by_user", (q) => q.eq("userId", viewer.profile!._id))
    .first();
  return account ? { profile: viewer.profile, account } : null;
}

/** The signed-in customer, or null when signed out or not yet registered as a customer. */
export const myAccount = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await findViewerProfile(ctx);
    if (!viewer?.profile) return { signedIn: false as const };
    const found = await viewerCustomer(ctx);
    const tenant = await openCompany(ctx);
    return {
      signedIn: true as const,
      email: viewer.profile.email ?? null,
      companyName: tenant?.name ?? null,
      account: found ? { name: found.account.name, phone: found.account.phone } : null
    };
  }
});

/** Turns the signed-in user into a customer of the open company. Safe to call twice. */
export const registerCustomer = mutation({
  args: { name: v.string(), phone: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const viewer = await findViewerProfile(ctx);
    if (!viewer?.profile || viewer.profile.status !== "active") throw new ConvexError("Please sign in first.");
    const tenant = await openCompany(ctx);
    if (!tenant) throw new ConvexError("Customer accounts are not open right now.");
    const name = requireText(args.name, "Name", 100);
    const phone = validatePhone(args.phone);

    const existing = await ctx.db
      .query("customerAccounts")
      .withIndex("by_user", (q) => q.eq("userId", viewer.profile!._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { name, phone });
      return { ok: true as const };
    }
    await ctx.db.insert("customerAccounts", {
      tenantId: tenant._id,
      userId: viewer.profile._id,
      name,
      phone,
      createdAt: Date.now()
    });
    return { ok: true as const };
  }
});

/** The signed-in customer's company, or an error a customer can act on. */
async function customerTenant(ctx: QueryCtx) {
  const found = await viewerCustomer(ctx);
  if (!found) throw new ConvexError("Create a customer account to see the catalogue.");
  const tenant = await ctx.db.get(found.account.tenantId);
  if (!tenant || tenant.status !== "active") throw new ConvexError("The catalogue is not available right now.");
  return tenant;
}

/**
 * Every product a customer may buy, without prices or photos: enough to search, filter by
 * brand and group into cards. Prices and photos come a page at a time from catalogueDetails.
 */
export const catalogue = query({
  args: {},
  handler: async (ctx) => {
    const tenant = await customerTenant(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(MAX_LISTED);
    const categories = new Map<string, Doc<"productCategories"> | null>();
    const items = [];
    for (const product of products) {
      if (product.status !== "active") continue;
      if (!categories.has(product.categoryId)) categories.set(product.categoryId, await ctx.db.get(product.categoryId));
      const category = categories.get(product.categoryId);
      if (!category || category.status !== "active") continue;
      items.push({
        id: product._id,
        category: category.name,
        name: product.name,
        brand: product.brand,
        model: product.model,
        description: product.description ?? "",
        warrantyMonths: product.warrantyMonths ?? null
      });
    }
    return {
      companyName: tenant.name,
      exponent: currencyExponent(tenant.defaultCurrency),
      products: items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    };
  }
});

/** List price and photo for the products on screen (and in the basket). Cost and margin are never exposed. */
export const catalogueDetails = query({
  args: { ids: v.array(v.id("products")) },
  handler: async (ctx, args) => {
    if (args.ids.length > MAX_DETAILS) throw new ConvexError(`At most ${MAX_DETAILS} products at a time.`);
    const tenant = await customerTenant(ctx);
    const out = [];
    for (const id of args.ids) {
      const product = await ctx.db.get(id);
      if (!product || product.tenantId !== tenant._id || product.status !== "active") continue;
      const category = await ctx.db.get(product.categoryId);
      if (!category || category.status !== "active") continue;
      const cost = await currentCost(ctx, product._id);
      const rule = await resolveMarginRule(ctx, product);
      const price = cost && rule ? priceFrom(cost, rule.rule) : null;
      const photo = await ctx.db
        .query("productFiles")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .filter((q) => q.eq(q.field("kind"), "image"))
        .first();
      out.push({
        id: product._id,
        imageUrl: photo ? await ctx.storage.getUrl(photo.storageId) : null,
        priceMinor: price?.listMinor ?? null,
        currency: price?.currency ?? null
      });
    }
    return out;
  }
});

/** Places an order. Prices are recomputed here; nothing the browser sends about price is trusted. */
export const placeOrder = mutation({
  args: {
    items: v.array(v.object({ productId: v.id("products"), quantity: v.number() })),
    deliveryLocation: v.string(),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const found = await viewerCustomer(ctx);
    if (!found) throw new ConvexError("Create a customer account to place an order.");
    const { account } = found;
    const tenant = await ctx.db.get(account.tenantId);
    if (!tenant || tenant.status !== "active") throw new ConvexError("Orders are not open right now.");

    if (args.items.length === 0) throw new ConvexError("Add at least one product to your order.");
    if (args.items.length > MAX_LINES) throw new ConvexError(`An order can have at most ${MAX_LINES} products.`);
    const deliveryLocation = requireText(args.deliveryLocation, "Delivery location", 200);
    const note = args.note?.trim() ? requireText(args.note, "Note", 500) : undefined;

    const now = Date.now();
    const recent = await ctx.db
      .query("shopOrders")
      .withIndex("by_customer_time", (q) => q.eq("customerAccountId", account._id).gte("createdAt", now - DAY))
      .collect();
    if (recent.length >= MAX_ORDERS_PER_DAY) throw new ConvexError("You have placed many orders today. Please contact us.");

    const seen = new Set<string>();
    const lines = [];
    let currency: string | null = null;
    let total = 0;
    for (const item of args.items) {
      if (seen.has(item.productId)) throw new ConvexError("A product is listed twice.");
      seen.add(item.productId);
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
        throw new ConvexError("Quantity must be a whole number from 1 to 1000.");
      }
      const product = await ctx.db.get(item.productId);
      if (!product || product.tenantId !== tenant._id || product.status !== "active") {
        throw new ConvexError("One of the products is no longer available.");
      }
      const category = await ctx.db.get(product.categoryId);
      if (!category || category.status !== "active") throw new ConvexError("One of the products is no longer available.");
      const cost = await currentCost(ctx, product._id);
      const rule = await resolveMarginRule(ctx, product);
      if (!cost || !rule) throw new ConvexError(`${product.name} has no price yet. Ask us for a quote.`);
      const price = priceFrom(cost, rule.rule);
      if (currency && currency !== price.currency) throw new ConvexError("These products are priced in different currencies. Order them separately.");
      currency = price.currency;
      total += price.listMinor * item.quantity;
      lines.push({
        productId: product._id,
        name: product.name,
        brand: product.brand,
        model: product.model,
        sku: product.sku,
        quantity: item.quantity,
        unitPriceMinor: price.listMinor
      });
    }

    const id = await ctx.db.insert("shopOrders", {
      tenantId: tenant._id,
      customerAccountId: account._id,
      customerName: account.name,
      customerPhone: account.phone,
      deliveryLocation,
      note,
      currency: currency!,
      items: lines,
      totalMinor: total,
      status: "new",
      createdAt: now,
      updatedAt: now
    });
    return { orderId: id };
  }
});

export const myOrders = query({
  args: {},
  handler: async (ctx) => {
    const found = await viewerCustomer(ctx);
    if (!found) return [];
    const rows = await ctx.db
      .query("shopOrders")
      .withIndex("by_customer_time", (q) => q.eq("customerAccountId", found.account._id))
      .order("desc")
      .take(50);
    return rows.map((o) => ({
      id: o._id,
      createdAt: o.createdAt,
      status: o.status,
      currency: o.currency,
      totalMinor: o.totalMinor,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity }))
    }));
  }
});

/** Staff: every order placed by customers. */
export const listOrders = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ORDER_STAFF);
    const rows = await ctx.db
      .query("shopOrders")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(200);
    return rows.map((o) => ({
      id: o._id,
      createdAt: o.createdAt,
      status: o.status,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      deliveryLocation: o.deliveryLocation,
      note: o.note ?? null,
      currency: o.currency,
      exponent: currencyExponent(o.currency),
      totalMinor: o.totalMinor,
      items: o.items
    }));
  }
});

export const setOrderStatus = mutation({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("shopOrders"),
    status: v.union(v.literal("new"), v.literal("confirmed"), v.literal("cancelled"))
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, ORDER_STAFF);
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== args.tenantId) throw new ConvexError("Order not found.");
    if (order.status === args.status) return { ok: true as const };
    await ctx.db.patch(order._id, { status: args.status, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "order.status_changed",
      entityType: "shopOrders",
      entityId: order._id,
      summary: `Order from ${order.customerName} set to ${args.status}.`,
      metadata: { before: { status: order.status }, after: { status: args.status } }
    });
    return { ok: true as const };
  }
});
