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
  return new Set(membership.allowedBrands.filter((b) => brandCovered(managerScope, b)));
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a product's brand is covered by the chosen brands. A chosen brand covers any brand
 * name that contains it as a whole word, so "Lumina" also covers "Lumina Solar" and
 * "LUMINA-TECH", and "Star" covers "LC Star", but "Star" does not cover "Starlink".
 */
export function brandCovered(chosen: Iterable<string>, brand: string) {
  const key = brandKey(brand);
  for (const c of chosen) {
    if (!c) continue;
    if (key === c || new RegExp(`(^|[^a-z0-9])${escapeRegExp(c)}($|[^a-z0-9])`).test(key)) return true;
  }
  return false;
}

export function inScope(scope: BrandScope, product: { brand: string }) {
  return scope === null || brandCovered(scope, product.brand);
}
