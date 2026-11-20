/**
 * Who may create an account.
 *
 * For now accounts are for staff only: an administrator invites an email address with a role on
 * the Staff page, and only invited addresses can sign up. The new account gets its access
 * straight away. Public sign-up can be switched back on in Settings (the public power check
 * section); existing accounts can always sign in.
 */
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";

export const SIGN_UP_CLOSED =
  "Creating an account is for staff only for now. If you work with us, ask your administrator to invite this email address. Customers can use everything without an account.";

const normalise = (email: string) => email.trim().toLowerCase();

/** Whether anyone may create an account (an administrator switched public sign-up on). */
export async function publicSignUpOpen(ctx: QueryCtx) {
  const open = await ctx.db
    .query("publicEstimatorSettings")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .first();
  return Boolean(open?.publicSignUp);
}

/** Invitations waiting for this email address. */
async function pendingInvites(ctx: QueryCtx, email: string) {
  const rows = await ctx.db.query("staffInvites").withIndex("by_email", (q) => q.eq("email", normalise(email))).collect();
  return rows.filter((r) => !r.acceptedAt);
}

/**
 * Called when a new account is being created. Refuses it unless the address was invited or
 * public sign-up is on. The very first account (setting the system up) is always allowed.
 */
export async function assertSignUpAllowed(ctx: MutationCtx, email: string | undefined) {
  if (email && (await pendingInvites(ctx, email)).length > 0) return;
  if (await publicSignUpOpen(ctx)) return;
  const anyCompany = await ctx.db.query("tenants").first();
  if (!anyCompany) return;
  throw new ConvexError(SIGN_UP_CLOSED);
}

/** Turns invitations for a new account's email into company access. */
export async function acceptInvites(ctx: MutationCtx, profile: Doc<"userProfiles">) {
  if (!profile.email) return;
  for (const invite of await pendingInvites(ctx, profile.email)) {
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) => q.eq("userId", profile._id).eq("tenantId", invite.tenantId))
      .unique();
    if (!existing) {
      await ctx.db.insert("memberships", {
        tenantId: invite.tenantId,
        userId: profile._id,
        role: invite.role,
        status: "active",
        createdAt: Date.now(),
        createdBy: invite.createdBy
      });
    }
    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
  }
}

/** For the sign-up page and the public pages: may the public create accounts? */
export const signUpStatus = query({
  args: {},
  handler: async (ctx) => ({ publicSignUpOpen: await publicSignUpOpen(ctx) })
});

/** Staff page: invitations not yet used. */
export const listInvites = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ["super_admin"]);
    const rows = await ctx.db.query("staffInvites").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect();
    return rows
      .filter((r) => !r.acceptedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ id: r._id, email: r.email, role: r.role, createdAt: r.createdAt }));
  }
});

export const cancelInvite = mutation({
  args: { inviteId: v.id("staffInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError("Invitation not found.");
    const { profile } = await requireTenantMembership(ctx, invite.tenantId, ["super_admin"]);
    await ctx.db.delete(invite._id);
    await recordAudit(ctx, profile, {
      tenantId: invite.tenantId,
      action: "membership.invite_cancelled",
      entityType: "staffInvites",
      entityId: invite._id,
      summary: `Invitation for ${invite.email} cancelled.`
    });
    return { ok: true };
  }
});
