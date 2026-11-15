import { v } from "convex/values";
import { query } from "./_generated/server";
import { findViewerProfile, listActiveMemberships, requireTenantMembership } from "./lib/auth";
import { profileComplete } from "./profile";

/**
 * What the signed-in user may see. Never throws for the ordinary
 * "not signed in" / "no company yet" cases so the UI can route on `state`.
 */
export const viewerContext = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await findViewerProfile(ctx);
    if (!viewer) return { state: "signed_out" as const };

    const { profile } = viewer;
    // The profile is written in the same transaction as the auth user, so
    // this is only expected briefly or after manual data repair.
    if (!profile) return { state: "profile_missing" as const };
    if (profile.status !== "active") return { state: "disabled" as const };

    const memberships = await listActiveMemberships(ctx, profile._id);

    return {
      state: memberships.length > 0 ? ("active" as const) : ("awaiting_access" as const),
      profile: {
        id: profile._id,
        displayName: profile.displayName,
        email: profile.email,
        photoUrl: profile.photoStorageId ? await ctx.storage.getUrl(profile.photoStorageId) : null,
        profileComplete: profileComplete(profile)
      },
      companies: memberships.map(({ membership, tenant }) => ({
        tenantId: tenant._id,
        companyName: tenant.name,
        defaultCurrency: tenant.defaultCurrency,
        role: membership.role
      }))
    };
  }
});

/**
 * Everyone the super administrator should know about: members of this company (any status),
 * this company's customers, and accounts still waiting for access (no company and not a
 * customer anywhere). People who belong only to another company are not shown.
 */
export const listAllUsers = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ["super_admin"]);
    const profiles = await ctx.db.query("userProfiles").order("desc").take(2000);
    const people = [];
    for (const p of profiles) {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", p._id))
        .collect();
      const here = memberships.find((m) => m.tenantId === args.tenantId);
      const accounts = await ctx.db
        .query("customerAccounts")
        .withIndex("by_user", (q) => q.eq("userId", p._id))
        .collect();
      const customerHere = accounts.find((a) => a.tenantId === args.tenantId);
      const waiting = memberships.length === 0 && accounts.length === 0;
      if (!here && !customerHere && !waiting) continue;
      people.push({
        userId: p._id,
        displayName: p.displayName,
        email: p.email ?? "",
        phone: p.phone ?? customerHere?.phone ?? "",
        photoUrl: p.photoStorageId ? await ctx.storage.getUrl(p.photoStorageId) : null,
        profileComplete: profileComplete(p),
        accountStatus: p.status,
        kind: here ? ("staff" as const) : customerHere ? ("customer" as const) : ("waiting" as const),
        role: here?.role ?? null,
        membershipStatus: here?.status ?? null,
        joinedAt: p.createdAt
      });
    }
    return people;
  }
});
