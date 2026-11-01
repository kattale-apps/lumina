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
