/**
 * The pure rules for which product brands a member of staff may see (no database access,
 * so they are tested directly). See brandAccess.ts for how they are applied.
 */
import type { Doc } from "../_generated/dataModel";

export const LIMITED_ROLES = ["sales_manager", "sales_agent"] as const;
/** What a manager, or an agent without a manager, sees until the super admin chooses. */
export const DEFAULT_BRANDS = ["lumina"];

export function brandKey(brand: string) {
  return brand.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isLimitedRole(role: string) {
  return (LIMITED_ROLES as readonly string[]).includes(role);
}

/** A set of brand keys, or null for "every brand". */
export type BrandScope = Set<string> | null;

/** Pure rule, so it can be tested: the brands a membership may see. */
export function scopeFor(
  membership: Pick<Doc<"memberships">, "role" | "allowedBrands">,
  manager?: Pick<Doc<"memberships">, "role" | "allowedBrands" | "status"> | null
): BrandScope {
  if (membership.role === "sales_manager") return new Set(membership.allowedBrands ?? DEFAULT_BRANDS);
  if (membership.role !== "sales_agent") return null;
  const managerScope =
    manager && manager.status === "active" && manager.role === "sales_manager"
      ? new Set(manager.allowedBrands ?? DEFAULT_BRANDS)
      : null;
  if (!managerScope) return new Set(membership.allowedBrands ?? DEFAULT_BRANDS);
  if (!membership.allowedBrands) return managerScope;
  return new Set(membership.allowedBrands.filter((b) => managerScope.has(b)));
}

export function inScope(scope: BrandScope, product: { brand: string }) {
  return scope === null || scope.has(brandKey(product.brand));
}
