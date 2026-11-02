import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
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

/** Looks up the Solar Switch profile for the signed-in user without throwing. */
export async function findViewerProfile(ctx: AuthContext) {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authUserId))
    .unique();

  return { authUserId, profile };
}

export async function requireUserProfile(ctx: AuthContext) {
  const identity = await requireIdentity(ctx);
  const viewer = await findViewerProfile(ctx);

  if (!viewer) {
    throw new AuthorizationError("Authentication is required.");
  }

  const { profile } = viewer;
  if (!profile || profile.status !== "active") {
    throw new AuthorizationError("Your Solar Switch user profile is not active.");
  }

  return { identity, profile };
}

/** Active memberships whose company is also active. */
export async function listActiveMemberships(
  ctx: AuthContext,
  profileId: Id<"userProfiles">
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", profileId))
    .collect();

  const active: { membership: Doc<"memberships">; tenant: Doc<"tenants"> }[] = [];
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const tenant = await ctx.db.get(membership.tenantId);
    if (tenant?.status === "active") {
      active.push({ membership, tenant });
    }
  }
  return active;
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
  const memberships = await listActiveMemberships(ctx, profile._id);
  return { identity, profile, memberships };
}
