/**
 * Several sales agents' WhatsApp numbers: public requests go to each in turn (lib/whatsappRoute),
 * and the app tracks the WhatsApp follow-up: when the customer opened WhatsApp, and when (and by
 * whom) staff recorded a reply.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { whatsappDigits } from "./lib/whatsapp";
import { LEAD_VIEWERS } from "./leads";

const ADMINS = ["super_admin"] as const;
const MAX_AGENTS = 20;

async function settingsFor(ctx: Parameters<typeof requireTenantMembership>[0], tenantId: Id<"tenants">) {
  const settings = await ctx.db
    .query("publicEstimatorSettings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  if (!settings) throw new ConvexError("Switch on the public power check in Settings first.");
  return settings;
}

/** The agent numbers, and the staff who can be linked to one. Super admin only. */
export const listAgents = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ADMINS);
    const settings = await ctx.db
      .query("publicEstimatorSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const staff = [];
    for (const m of memberships) {
      if (m.status !== "active") continue;
      const p = await ctx.db.get(m.userId);
      if (p) staff.push({ userId: p._id, name: p.displayName, role: m.role });
    }
    return {
      companyNumber: settings?.whatsappNumber ?? null,
      agents: (settings?.whatsappAgents ?? []).map((a) => ({ number: a.number, name: a.name, userId: a.userId ?? null })),
      staff: staff.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

/** Replaces the list of agent numbers that take turns. An empty list goes back to the company number. */
export const setAgents = mutation({
  args: {
    tenantId: v.id("tenants"),
    agents: v.array(v.object({ number: v.string(), name: v.string(), userId: v.optional(v.id("userProfiles")) }))
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, ADMINS);
    if (args.agents.length > MAX_AGENTS) throw new ConvexError(`At most ${MAX_AGENTS} numbers.`);
    const settings = await settingsFor(ctx, args.tenantId);
    const seen = new Set<string>();
    const agents = [];
    for (const [i, a] of args.agents.entries()) {
      const number = whatsappDigits(a.number);
      if (!number) throw new ConvexError(`Number ${i + 1}: enter a valid phone number, e.g. +256 700 000000.`);
      if (seen.has(number)) throw new ConvexError(`Number ${i + 1} is already in the list.`);
      seen.add(number);
      if (a.userId) {
        const m = await ctx.db
          .query("memberships")
          .withIndex("by_user_tenant", (q) => q.eq("userId", a.userId!).eq("tenantId", args.tenantId))
          .unique();
        if (!m || m.status !== "active") throw new ConvexError(`Number ${i + 1}: choose an active staff member.`);
      }
      const name = a.name.trim() || (a.userId ? (await ctx.db.get(a.userId))?.displayName ?? "" : "");
      if (!name) throw new ConvexError(`Number ${i + 1}: give it a name, e.g. the agent's name.`);
      agents.push({ number, name: name.slice(0, 60), userId: a.userId });
    }
    await ctx.db.patch(settings._id, { whatsappAgents: agents, whatsappTurn: 0, updatedAt: Date.now(), updatedBy: profile.authSubject });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "whatsapp.agents_set",
      entityType: "publicEstimatorSettings",
      entityId: settings._id,
      summary: `WhatsApp agent numbers set: ${agents.map((a) => a.name).join(", ") || "none (company number)"}.`
    });
    return { count: agents.length };
  }
});

/**
 * The customer tapped "Send on WhatsApp" after sending a request. Public: the request id is only
 * known to the page that sent it, and the only effect is a first-tap time.
 */
export const opened = mutation({
  args: { quoteRequestId: v.optional(v.id("quoteRequests")), itemRequestId: v.optional(v.id("itemRequests")) },
  handler: async (ctx, args) => {
    const row = args.quoteRequestId ? await ctx.db.get(args.quoteRequestId) : args.itemRequestId ? await ctx.db.get(args.itemRequestId) : null;
    if (row && !row.whatsappOpenedAt) await ctx.db.patch(row._id, { whatsappOpenedAt: Date.now() });
    return { ok: true };
  }
});

/** Staff record that they replied to the customer on WhatsApp, so the app tracks the follow-up. */
export const markReplied = mutation({
  args: { quoteRequestId: v.optional(v.id("quoteRequests")), itemRequestId: v.optional(v.id("itemRequests")) },
  handler: async (ctx, args) => {
    const row = args.quoteRequestId ? await ctx.db.get(args.quoteRequestId) : args.itemRequestId ? await ctx.db.get(args.itemRequestId) : null;
    if (!row) throw new ConvexError("Request not found.");
    const { profile } = await requireTenantMembership(ctx, row.tenantId, LEAD_VIEWERS);
    const now = Date.now();
    await ctx.db.patch(row._id, { whatsappRepliedAt: now, whatsappRepliedBy: profile._id, updatedAt: now });
    if (args.itemRequestId) {
      const item = await ctx.db.get(args.itemRequestId);
      if (item && item.status === "new") await ctx.db.patch(item._id, { status: "contacted", handledByUserId: profile._id, answeredAt: item.answeredAt ?? now });
    }
    await recordAudit(ctx, profile, {
      tenantId: row.tenantId,
      action: "whatsapp.replied",
      entityType: args.quoteRequestId ? "quoteRequests" : "itemRequests",
      entityId: row._id,
      summary: `Replied on WhatsApp to ${row.name} (${row.phone}).`
    });
    return { ok: true };
  }
});
