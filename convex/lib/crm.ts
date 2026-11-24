import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Roles that may open the customer and assessment screens at all. */
export const CRM_READERS = ["super_admin", "sales_manager", "sales_agent", "technician"] as const;
/** Roles that may create and change customers and assessments. Technicians review only. */
export const CRM_WRITERS = ["super_admin", "sales_manager", "sales_agent"] as const;

/**
 * Whose sales records a person sees. Agents: their own. Managers: their own and those of the
 * agents assigned to them. Super admins, inventory admins and technicians: everyone's.
 */
export type OwnerScope = {
  all: boolean;
  owners: Id<"userProfiles">[];
  can: (ownerUserId: Id<"userProfiles">) => boolean;
};

export async function ownerScope(
  ctx: QueryCtx,
  membership: Doc<"memberships">,
  profile: Doc<"userProfiles">
): Promise<OwnerScope> {
  if (membership.role !== "sales_agent" && membership.role !== "sales_manager") {
    return { all: true, owners: [], can: () => true };
  }
  const owners: Id<"userProfiles">[] = [profile._id];
  if (membership.role === "sales_manager") {
    const team = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_manager", (q) => q.eq("tenantId", membership.tenantId).eq("managerUserId", profile._id))
      .collect();
    for (const m of team) if (m.userId !== profile._id) owners.push(m.userId);
  }
  const set = new Set<string>(owners);
  return { all: false, owners, can: (ownerUserId) => set.has(ownerUserId) };
}

/** True when this user may view a record owned by `ownerUserId` (see ownerScope). */
export async function canAccessOwned(
  ctx: QueryCtx,
  membership: Doc<"memberships">,
  profile: Doc<"userProfiles">,
  ownerUserId: Id<"userProfiles">
) {
  return (await ownerScope(ctx, membership, profile)).can(ownerUserId);
}

/** Rows of an owner-indexed table that a scope may see: all of them, or each owner's. */
export async function ownedRows<T>(scope: OwnerScope, all: () => Promise<T[]>, byOwner: (owner: Id<"userProfiles">) => Promise<T[]>) {
  if (scope.all) return await all();
  return (await Promise.all(scope.owners.map(byOwner))).flat();
}

export function validatePhone(raw: string) {
  const phone = raw.trim();
  if (!/^\+?[0-9][0-9 ()-]{5,19}$/.test(phone)) {
    throw new ConvexError("Enter a valid phone number, e.g. +256 700 000000.");
  }
  return phone;
}

export function validateOptionalEmail(raw?: string) {
  const email = raw?.trim().toLowerCase();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw new ConvexError("Enter a valid email address or leave it blank.");
  }
  return email;
}

export function optionalText(raw: string | undefined, label: string, maxLength: number) {
  const text = raw?.trim();
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new ConvexError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

export function validateGps(gps: { lat: number; lng: number } | undefined, consent: boolean) {
  if (!gps) return undefined;
  if (!consent) throw new ConvexError("GPS can be saved only with the customer's consent.");
  if (!(gps.lat >= -90 && gps.lat <= 90 && gps.lng >= -180 && gps.lng <= 180)) {
    throw new ConvexError("GPS coordinates are out of range.");
  }
  return gps;
}
