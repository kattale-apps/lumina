import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const APP_ROLES = [
  "super_admin",
  "inventory_admin",
  "sales_manager",
  "technician",
  "sales_agent"
] as const;

export type AppRole = (typeof APP_ROLES)[number];
type AuthContext = QueryCtx | MutationCtx;

export class AuthorizationError extends Error {
  constructor(message = "You are not authorised to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function requireIdentity(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new AuthorizationError("Authentication is required.");
  }
  return identity;
}

export async function requireUserProfile(ctx: AuthContext) {
  const identity = await requireIdentity(ctx);
  const authUserId = await getAuthUserId(ctx);

  if (!authUserId) {
    throw new AuthorizationError("Authentication is required.");
  }

  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_auth_subject", (q) =>
      q.eq("authSubject", authUserId)
    )
    .unique();

  if (!profile || profile.status !== "active") {
    throw new AuthorizationError("Your Lumina user profile is not active.");
  }

  return { identity, profile };
}

export async function requireTenantMembership(
  ctx: AuthContext,
  tenantId: Id<"tenants">,
  allowedRoles?: readonly AppRole[]
) {
  const { identity, profile } = await requireUserProfile(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_tenant", (q) =>
      q.eq("userId", profile._id).eq("tenantId", tenantId)
    )
    .unique();

  if (!membership || membership.status !== "active") {
    throw new AuthorizationError("You do not have active access to this company.");
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new AuthorizationError("Your role does not permit this action.");
  }

  const tenant = await ctx.db.get(tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new AuthorizationError("This company account is not active.");
  }

  return { identity, profile, membership, tenant };
}

export async function requireAnyActiveMembership(ctx: AuthContext) {
  const { identity, profile } = await requireUserProfile(ctx);
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", profile._id))
    .collect();

  const activeMemberships = [];
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const tenant = await ctx.db.get(membership.tenantId);
    if (tenant?.status === "active") {
      activeMemberships.push({ membership, tenant });
    }
  }

  return { identity, profile, memberships: activeMemberships };
}
