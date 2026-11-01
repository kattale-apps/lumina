import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { validateMarginBps } from "./lib/money";
import { PRICING_ADMINS } from "./lib/pricing";

/** Converts a percentage with at most two decimals to basis points. */
function percentToBps(percent: number, label: string) {
  const bps = Math.round(percent * 100);
  if (!Number.isFinite(percent) || Math.abs(percent * 100 - bps) > 1e-6) {
    throw new ConvexError(`${label} can have at most two decimal places.`);
  }
  return validateMarginBps(bps, label);
}

export const listMarginRules = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);
    const rules = await ctx.db
      .query("marginRules")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const result = [];
    for (const rule of rules) {
      let targetName = "All products";
      if (rule.scope === "category" && rule.categoryId) {
        targetName = (await ctx.db.get(rule.categoryId))?.name ?? "Unknown category";
      } else if (rule.scope === "product" && rule.productId) {
        const product = await ctx.db.get(rule.productId);
        targetName = product ? `${product.name} (${product.sku})` : "Unknown product";
      }
      result.push({
        id: rule._id,
        scope: rule.scope,
        categoryId: rule.categoryId ?? null,
        productId: rule.productId ?? null,
        targetName,
        marginPercent: rule.marginBps / 100,
        floorMarginPercent: rule.floorMarginBps / 100
      });
    }
    const order = { default: 0, category: 1, product: 2 };
    return result.sort(
      (a, b) => order[a.scope] - order[b.scope] || a.targetName.localeCompare(b.targetName)
    );
  }
});

/**
 * Creates or replaces the rule for one target (the company default, a
 * category, or a single product). The floor is the lowest margin a discount
 * may reach, so it can never exceed the target margin.
 */
export const setMarginRule = mutation({
  args: {
    tenantId: v.id("tenants"),
    scope: v.union(v.literal("default"), v.literal("category"), v.literal("product")),
    categoryId: v.optional(v.id("productCategories")),
    productId: v.optional(v.id("products")),
    marginPercent: v.number(),
    floorMarginPercent: v.number()
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);

    const marginBps = percentToBps(args.marginPercent, "Margin");
    const floorMarginBps = percentToBps(args.floorMarginPercent, "Floor margin");
    if (floorMarginBps > marginBps) {
      throw new ConvexError("The floor margin cannot be higher than the target margin.");
    }

    let categoryId = undefined;
    let productId = undefined;
    let existing;

    if (args.scope === "default") {
      existing = await ctx.db
        .query("marginRules")
        .withIndex("by_tenant_scope", (q) =>
          q.eq("tenantId", args.tenantId).eq("scope", "default")
        )
        .first();
    } else if (args.scope === "category") {
      const category = args.categoryId ? await ctx.db.get(args.categoryId) : null;
      if (!category || category.tenantId !== args.tenantId) {
        throw new ConvexError("Choose a category for this rule.");
      }
      categoryId = category._id;
      existing = await ctx.db
        .query("marginRules")
        .withIndex("by_category", (q) => q.eq("categoryId", category._id))
        .first();
    } else {
      const product = args.productId ? await ctx.db.get(args.productId) : null;
      if (!product || product.tenantId !== args.tenantId) {
        throw new ConvexError("Choose a product for this rule.");
      }
      productId = product._id;
      existing = await ctx.db
        .query("marginRules")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .first();
    }

    const now = Date.now();
    const after = { marginBps, floorMarginBps };
    let ruleId;

    if (existing) {
      if (existing.marginBps === marginBps && existing.floorMarginBps === floorMarginBps) {
        return { changed: false, ruleId: existing._id };
      }
      await ctx.db.patch(existing._id, { ...after, updatedAt: now, updatedBy: profile.authSubject });
      ruleId = existing._id;
    } else {
      ruleId = await ctx.db.insert("marginRules", {
        tenantId: args.tenantId,
        scope: args.scope,
        categoryId,
        productId,
        ...after,
        updatedAt: now,
        updatedBy: profile.authSubject
      });
    }

    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: existing ? "margin_rule.updated" : "margin_rule.created",
      entityType: "marginRules",
      entityId: ruleId,
      summary: `${args.scope} margin rule ${existing ? "updated" : "created"}: ${marginBps / 100}% (floor ${floorMarginBps / 100}%).`,
      metadata: {
        before: existing
          ? { marginBps: existing.marginBps, floorMarginBps: existing.floorMarginBps }
          : null,
        after: { scope: args.scope, categoryId, productId, ...after }
      }
    });
    return { changed: true, ruleId };
  }
});

/** Removes a category or product rule, so those items fall back to a broader rule. */
export const removeMarginRule = mutation({
  args: { ruleId: v.id("marginRules") },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) throw new ConvexError("Rule not found.");
    const { profile } = await requireTenantMembership(ctx, rule.tenantId, PRICING_ADMINS);
    if (rule.scope === "default") {
      throw new ConvexError("The company default rule cannot be removed. Change it instead.");
    }

    await ctx.db.delete(rule._id);
    await recordAudit(ctx, profile, {
      tenantId: rule.tenantId,
      action: "margin_rule.removed",
      entityType: "marginRules",
      entityId: rule._id,
      summary: `${rule.scope} margin rule removed.`,
      metadata: {
        before: {
          scope: rule.scope,
          categoryId: rule.categoryId,
          productId: rule.productId,
          marginBps: rule.marginBps,
          floorMarginBps: rule.floorMarginBps
        }
      }
    });
    return { removed: true };
  }
});
