/**
 * Which product brands a member of staff may see.
 *
 * Sales managers and sales agents are limited to the brands the super admin
 * chose for them; everyone else (super admin, inventory admin, technician) and
 * the public see every brand.
 *
 *  - A sales manager sees the brands set on their membership, or Lumina only
 *    while nothing has been set.
 *  - A sales agent follows their manager: they see the manager's brands, and
 *    the super admin can narrow an agent further but never wider than the
 *    manager. An agent without a manager sees their own brands, or Lumina only.
 *
 * Brands are compared by a key (trimmed, single-spaced, lower case), so
 * "LUMINA" and "Lumina" are the same brand.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { findViewerProfile } from "./auth";
import { inScope, isLimitedRole, scopeFor, type BrandScope } from "./brands";

export { brandKey, DEFAULT_BRANDS, inScope, isLimitedRole, LIMITED_ROLES, scopeFor, type BrandScope } from "./brands";

type Ctx = QueryCtx | MutationCtx;

/** The brands a membership may see, looking up the agent's manager when there is one. */
export async function scopeForMembership(ctx: Ctx, membership: Doc<"memberships">): Promise<BrandScope> {
  if (!isLimitedRole(membership.role)) return null;
  let manager: Doc<"memberships"> | null = null;
  if (membership.role === "sales_agent" && membership.managerUserId) {
    manager = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) => q.eq("userId", membership.managerUserId!).eq("tenantId", membership.tenantId))
      .unique();
  }
  return scopeFor(membership, manager);
}

/** The brands the signed-in viewer may see in this company; null for every brand (and for the public). */
export async function viewerBrandScope(ctx: Ctx, tenantId: Id<"tenants">): Promise<BrandScope> {
  const viewer = await findViewerProfile(ctx);
  if (!viewer?.profile) return null;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_tenant", (q) => q.eq("userId", viewer.profile!._id).eq("tenantId", tenantId))
    .unique();
  if (!membership || membership.status !== "active") return null;
  return await scopeForMembership(ctx, membership);
}

/** Keeps only the products the viewer may see. */
export async function filterForViewer<T extends { brand: string }>(ctx: Ctx, tenantId: Id<"tenants">, products: T[]) {
  const scope = await viewerBrandScope(ctx, tenantId);
  return scope === null ? products : products.filter((p) => inScope(scope, p));
}
