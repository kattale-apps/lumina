import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { brandKey, DEFAULT_BRANDS, isLimitedRole, scopeFor } from "./lib/brandAccess";
import { normaliseEmail } from "./lib/validation";
import { appRole } from "./schema";

const ADMIN_ONLY = ["super_admin"] as const;

/**
 * Loads a membership and checks the caller is a super administrator of its
 * company. Callers may not edit their own membership; because the caller is
 * themself an active super_admin, this also guarantees a company can never be
 * left without one.
 */
async function loadManageableMembership(ctx: MutationCtx, membershipId: Doc<"memberships">["_id"]) {
  const target = await ctx.db.get(membershipId);
  if (!target) throw new ConvexError("Staff member not found.");

  const { profile } = await requireTenantMembership(ctx, target.tenantId, ADMIN_ONLY);
  if (target.userId === profile._id) {
    throw new ConvexError("You cannot change your own access. Ask another super administrator.");
  }

  const targetProfile = await ctx.db.get(target.userId);
  return { actor: profile, target, targetLabel: targetProfile?.email ?? "user" };
}

export const listStaff = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, ADMIN_ONLY);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const byUser = new Map(memberships.map((m) => [m.userId, m]));
    const staff = [];
    for (const membership of memberships) {
      const person = await ctx.db.get(membership.userId);
      const manager = membership.managerUserId ? byUser.get(membership.managerUserId) ?? null : null;
      const scope = scopeFor(membership, manager);
      staff.push({
        membershipId: membership._id,
        email: person?.email ?? "",
        displayName: person?.displayName ?? "Unknown user",
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        // For a sales agent: the manager they report to.
        managerUserId: membership.managerUserId ?? null,
        // Product brands: what was chosen for them (null = the default), and what they see now.
        brands: isLimitedRole(membership.role)
          ? { chosen: membership.allowedBrands ?? null, effective: scope ? [...scope].sort() : [] }
          : null,
        isSelf: membership.userId === profile._id
      });
    }
    return staff.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
});

/** Gives an already-registered user access to the company, or reactivates them. */
export const grantAccess = mutation({
  args: { tenantId: v.id("tenants"), email: v.string(), role: appRole },
  handler: async (ctx, args) => {
    const { profile: actor } = await requireTenantMembership(ctx, args.tenantId, ADMIN_ONLY);

    const email = normaliseEmail(args.email);
    if (!email) throw new ConvexError("Email is required.");

    const matches = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (matches.length === 0) {
      // No account yet: invite the address. Signing up with it gives this access straight away.
      const pending = (
        await ctx.db.query("staffInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()
      ).find((i) => i.tenantId === args.tenantId && !i.acceptedAt);
      const inviteId = pending
        ? (await ctx.db.patch(pending._id, { role: args.role }), pending._id)
        : await ctx.db.insert("staffInvites", { tenantId: args.tenantId, email, role: args.role, createdAt: Date.now(), createdBy: actor.authSubject });
      await recordAudit(ctx, actor, {
        tenantId: args.tenantId,
        action: "membership.invited",
        entityType: "staffInvites",
        entityId: inviteId,
        summary: `${email} invited as ${args.role}.`
      });
      return { invited: true as const };
    }
    if (matches.length > 1) {
      throw new ConvexError(`More than one account uses ${email}; contact support.`);
    }
    const person = matches[0];
    if (person.status !== "active") {
      throw new ConvexError(`The account for ${email} is disabled.`);
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) =>
        q.eq("userId", person._id).eq("tenantId", args.tenantId)
      )
      .unique();

    if (existing?.status === "active") {
      throw new ConvexError(`${email} already has access. Change their role from the staff list.`);
    }

    if (existing) {
      const before = { role: existing.role, status: existing.status };
      await ctx.db.patch(existing._id, { role: args.role, status: "active" });
      await recordAudit(ctx, actor, {
        tenantId: args.tenantId,
        action: "membership.reactivated",
        entityType: "memberships",
        entityId: existing._id,
        summary: `${email} given access as ${args.role}.`,
        metadata: { before, after: { role: args.role, status: "active" } }
      });
      return { membershipId: existing._id };
    }

    const membershipId = await ctx.db.insert("memberships", {
      tenantId: args.tenantId,
      userId: person._id,
      role: args.role,
      status: "active",
      createdAt: Date.now(),
      createdBy: actor.authSubject
    });
    await recordAudit(ctx, actor, {
      tenantId: args.tenantId,
      action: "membership.granted",
      entityType: "memberships",
      entityId: membershipId,
      summary: `${email} granted ${args.role}.`,
      metadata: { after: { userId: person._id, role: args.role, status: "active" } }
    });
    return { membershipId };
  }
});

export const changeRole = mutation({
  args: { membershipId: v.id("memberships"), role: appRole },
  handler: async (ctx, args) => {
    const { actor, target, targetLabel } = await loadManageableMembership(ctx, args.membershipId);
    if (target.role === args.role) return { changed: false };

    // Only sales agents report to a manager; only managers and agents are limited to brands.
    await ctx.db.patch(target._id, {
      role: args.role,
      ...(args.role !== "sales_agent" ? { managerUserId: undefined } : {}),
      ...(!isLimitedRole(args.role) ? { allowedBrands: undefined } : {})
    });
    await recordAudit(ctx, actor, {
      tenantId: target.tenantId,
      action: "membership.role_changed",
      entityType: "memberships",
      entityId: target._id,
      summary: `${targetLabel} changed from ${target.role} to ${args.role}.`,
      metadata: { before: { role: target.role }, after: { role: args.role } }
    });
    return { changed: true };
  }
});

/** Puts a sales agent under a sales manager (or none). That manager then sees the agent's work. */
export const setManager = mutation({
  args: { membershipId: v.id("memberships"), managerUserId: v.union(v.id("userProfiles"), v.null()) },
  handler: async (ctx, args) => {
    const { actor, target, targetLabel } = await loadManageableMembership(ctx, args.membershipId);
    if (target.role !== "sales_agent") throw new ConvexError("Only sales agents are assigned to a manager.");
    let managerLabel = "no manager";
    if (args.managerUserId) {
      const manager = await ctx.db
        .query("memberships")
        .withIndex("by_user_tenant", (q) => q.eq("userId", args.managerUserId!).eq("tenantId", target.tenantId))
        .unique();
      if (!manager || manager.role !== "sales_manager" || manager.status !== "active") {
        throw new ConvexError("Choose an active sales manager.");
      }
      managerLabel = (await ctx.db.get(manager.userId))?.email ?? "manager";
    }
    const next = args.managerUserId ?? undefined;
    if (target.managerUserId === next) return { changed: false };
    await ctx.db.patch(target._id, { managerUserId: next });
    await recordAudit(ctx, actor, {
      tenantId: target.tenantId,
      action: "membership.manager_set",
      entityType: "memberships",
      entityId: target._id,
      summary: `${targetLabel} now reports to ${managerLabel}.`,
      metadata: { before: { managerUserId: target.managerUserId ?? null }, after: { managerUserId: next ?? null } }
    });
    return { changed: true };
  }
});

export const setAccess = mutation({
  args: {
    membershipId: v.id("memberships"),
    status: v.union(v.literal("active"), v.literal("suspended"))
  },
  handler: async (ctx, args) => {
    const { actor, target, targetLabel } = await loadManageableMembership(ctx, args.membershipId);
    if (target.status === args.status) return { changed: false };

    await ctx.db.patch(target._id, { status: args.status });
    await recordAudit(ctx, actor, {
      tenantId: target.tenantId,
      action: args.status === "active" ? "membership.reactivated" : "membership.suspended",
      entityType: "memberships",
      entityId: target._id,
      summary: `${targetLabel} ${args.status === "active" ? "reactivated" : "suspended"}.`,
      metadata: { before: { status: target.status }, after: { status: args.status } }
    });
    return { changed: true };
  }
});

/**
 * Every product brand in the catalogue, for choosing what a manager or agent may see.
 * Brands that differ only in capitals or spacing ("LUMINA", "Lumina") are one brand.
 */
export const brandChoices = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ADMIN_ONLY);
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const brands = new Map<string, { key: string; spellings: Map<string, number>; products: number }>();
    for (const p of products) {
      if (p.status !== "active" || !p.brand.trim()) continue;
      const key = brandKey(p.brand);
      const row = brands.get(key) ?? { key, spellings: new Map(), products: 0 };
      row.products += 1;
      row.spellings.set(p.brand.trim(), (row.spellings.get(p.brand.trim()) ?? 0) + 1);
      brands.set(key, row);
    }
    return {
      defaultBrands: DEFAULT_BRANDS,
      brands: [...brands.values()]
        .map((b) => ({
          key: b.key,
          // The spelling used most often in the catalogue.
          name: [...b.spellings.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0],
          products: b.products
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

/**
 * Chooses the product brands a sales manager or sales agent may see; null goes back to the
 * default (Lumina only for a manager; an agent follows their manager). An agent can be
 * narrowed below their manager's brands but never given more.
 */
export const setBrands = mutation({
  args: { membershipId: v.id("memberships"), brands: v.union(v.array(v.string()), v.null()) },
  handler: async (ctx, args) => {
    const { actor, target, targetLabel } = await loadManageableMembership(ctx, args.membershipId);
    if (!isLimitedRole(target.role)) {
      throw new ConvexError("Only sales managers and sales agents are limited to brands. Everyone else sees every brand.");
    }
    let next: string[] | undefined;
    if (args.brands !== null) {
      next = [...new Set(args.brands.map(brandKey).filter(Boolean))].sort();
      if (next.length === 0) throw new ConvexError("Choose at least one brand.");
      if (next.length > 100) throw new ConvexError("Choose at most 100 brands.");
      if (target.role === "sales_agent" && target.managerUserId) {
        const manager = await ctx.db
          .query("memberships")
          .withIndex("by_user_tenant", (q) => q.eq("userId", target.managerUserId!).eq("tenantId", target.tenantId))
          .unique();
        const managerScope = manager ? scopeFor(manager) : null;
        const outside = managerScope ? next.filter((b) => !managerScope.has(b)) : [];
        if (outside.length > 0) {
          throw new ConvexError(
            `This agent's manager does not have ${outside.join(", ")}. Give the manager those brands first, or choose fewer.`
          );
        }
      }
    }
    const before = target.allowedBrands ?? null;
    if (JSON.stringify(before) === JSON.stringify(next ?? null)) return { changed: false };
    await ctx.db.patch(target._id, { allowedBrands: next });
    await recordAudit(ctx, actor, {
      tenantId: target.tenantId,
      action: "membership.brands_set",
      entityType: "memberships",
      entityId: target._id,
      summary: next
        ? `${targetLabel} may now see: ${next.join(", ")}.`
        : `${targetLabel} back to the default brands.`,
      metadata: { before: { allowedBrands: before }, after: { allowedBrands: next ?? null } }
    });
    return { changed: true };
  }
});
