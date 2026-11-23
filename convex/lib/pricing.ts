import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { applyMarginBps, formatMinorUnits } from "./money";

/** Only these roles may see cost, margin and floor prices, or change them. */
export const PRICING_ADMINS = ["super_admin", "inventory_admin"] as const;

export function isPricingAdmin(role: string) {
  return (PRICING_ADMINS as readonly string[]).includes(role);
}

/** The cost in force right now: latest effective date that is not in the future. */
export async function currentCost(
  ctx: QueryCtx,
  productId: Id<"products">,
  now = Date.now()
) {
  return await ctx.db
    .query("costRecords")
    .withIndex("by_product_effective", (q) =>
      q.eq("productId", productId).lte("effectiveFrom", now)
    )
    .order("desc")
    .first();
}

export type ResolvedRule = {
  rule: Doc<"marginRules">;
  source: "product" | "category" | "default";
};

/** Most specific rule wins: product, then category, then company default. */
export async function resolveMarginRule(
  ctx: QueryCtx,
  product: Doc<"products">
): Promise<ResolvedRule | null> {
  const productRule = await ctx.db
    .query("marginRules")
    .withIndex("by_product", (q) => q.eq("productId", product._id))
    .first();
  if (productRule) return { rule: productRule, source: "product" };

  const categoryRule = await ctx.db
    .query("marginRules")
    .withIndex("by_category", (q) => q.eq("categoryId", product.categoryId))
    .first();
  if (categoryRule) return { rule: categoryRule, source: "category" };

  const defaultRule = await ctx.db
    .query("marginRules")
    .withIndex("by_tenant_scope", (q) =>
      q.eq("tenantId", product.tenantId).eq("scope", "default")
    )
    .first();
  return defaultRule ? { rule: defaultRule, source: "default" } : null;
}

export type ProductPrice = ReturnType<typeof priceFrom> & {
  /** True when an administrator set a fixed selling price instead of cost plus margin. */
  fixed: boolean;
};

/**
 * The selling price of a product now. A fixed selling price, when an administrator set one, wins;
 * otherwise list = current cost plus the margin rule. The floor never rises above a fixed price.
 * Null when there is neither a fixed price nor a cost with a margin rule.
 */
export async function productPrice(ctx: QueryCtx, product: Doc<"products">): Promise<ProductPrice | null> {
  const cost = await currentCost(ctx, product._id);
  const resolved = cost ? await resolveMarginRule(ctx, product) : null;
  const fromMargin = cost && resolved ? priceFrom(cost, resolved.rule) : null;
  const fixed = product.fixedPrice;
  if (!fixed) return fromMargin ? { ...fromMargin, fixed: false } : null;
  const floorMinor =
    fromMargin && fromMargin.currency === fixed.currency ? Math.min(fromMargin.floorMinor, fixed.amountMinor) : fixed.amountMinor;
  return {
    currency: fixed.currency,
    listMinor: fixed.amountMinor,
    floorMinor,
    list: formatMinorUnits(fixed.amountMinor, fixed.currency),
    floor: formatMinorUnits(floorMinor, fixed.currency),
    fixed: true
  };
}

export function priceFrom(cost: Doc<"costRecords">, rule: Doc<"marginRules">) {
  const listMinor = applyMarginBps(cost.amountMinor, rule.marginBps);
  const floorMinor = applyMarginBps(cost.amountMinor, rule.floorMarginBps);
  return {
    currency: cost.currency,
    listMinor,
    floorMinor,
    list: formatMinorUnits(listMinor, cost.currency),
    floor: formatMinorUnits(floorMinor, cost.currency)
  };
}
