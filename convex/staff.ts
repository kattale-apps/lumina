import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
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

    const staff = [];
    for (const membership of memberships) {
      const person = await ctx.db.get(membership.userId);
      staff.push({
        membershipId: membership._id,
        email: person?.email ?? "",
        displayName: person?.displayName ?? "Unknown user",
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        // For a sales agent: the manager they report to.
        managerUserId: membership.managerUserId ?? null,
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

    // Only sales agents report to a manager.
    await ctx.db.patch(target._id, { role: args.role, ...(args.role !== "sales_agent" ? { managerUserId: undefined } : {}) });
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
