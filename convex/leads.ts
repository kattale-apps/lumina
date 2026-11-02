import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { CRM_WRITERS } from "./lib/crm";
import { computeLoad, LOAD_ENGINE_VERSION } from "./lib/load";

/** Managers and the owner see every request and hand them out; agents see what is assigned to them. */
const LEAD_MANAGERS = ["super_admin", "sales_manager"] as const;
const LEAD_ROLES = CRM_WRITERS;

export const listLeads = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, LEAD_ROLES);
    const manager = (LEAD_MANAGERS as readonly string[]).includes(membership.role);
    const rows = await ctx.db
      .query("quoteRequests")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(200);
    const visible = manager ? rows : rows.filter((r) => r.assignedToUserId === profile._id);

    const names = new Map<string, string>();
    for (const r of visible) {
      if (r.assignedToUserId && !names.has(r.assignedToUserId)) {
        const p = await ctx.db.get(r.assignedToUserId);
        names.set(r.assignedToUserId, p?.displayName ?? "Unknown");
      }
    }
    return {
      canAssign: manager,
      leads: visible.map((r) => ({
        id: r._id,
        createdAt: r.createdAt,
        status: r.status,
        name: r.name,
        phone: r.phone,
        email: r.email ?? null,
        location: r.location,
        gridAvailability: r.gridAvailability,
        inputMode: r.inputMode,
        dailyKwh: r.dailyKwh,
        costPerMonthMinor: r.costPerMonthMinor ?? null,
        optionTitle: r.optionTitle,
        components: r.components,
        assignedTo: r.assignedToUserId ? names.get(r.assignedToUserId) ?? null : null,
        assignedToMe: r.assignedToUserId === profile._id,
        assessmentId: r.assessmentId ?? null
      }))
    };
  }
});

/** Active sales staff a manager can assign a request to. */
export const listAssignees = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, LEAD_MANAGERS);
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const out: { userId: string; name: string; role: string }[] = [];
    for (const m of members) {
      if (m.status !== "active" || !(LEAD_ROLES as readonly string[]).includes(m.role)) continue;
      const p = await ctx.db.get(m.userId);
      if (p && p.status === "active") out.push({ userId: p._id, name: p.displayName, role: m.role });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
});

export const assignLead = mutation({
  args: { leadId: v.id("quoteRequests"), assigneeUserId: v.id("userProfiles") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new ConvexError("Request not found.");
    const { profile } = await requireTenantMembership(ctx, lead.tenantId, LEAD_MANAGERS);
    if (lead.status === "converted" || lead.status === "closed") {
      throw new ConvexError("This request is already finished.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) => q.eq("userId", args.assigneeUserId).eq("tenantId", lead.tenantId))
      .unique();
    if (!membership || membership.status !== "active" || !(LEAD_ROLES as readonly string[]).includes(membership.role)) {
      throw new ConvexError("Choose an active sales agent or manager.");
    }
    await ctx.db.patch(lead._id, { assignedToUserId: args.assigneeUserId, status: "assigned", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: lead.tenantId,
      action: "lead.assigned",
      entityType: "quoteRequests",
      entityId: lead._id,
      summary: `Quote request from ${lead.name} assigned.`
    });
    return { changed: true };
  }
});

export const closeLead = mutation({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new ConvexError("Request not found.");
    const { profile, membership } = await requireTenantMembership(ctx, lead.tenantId, LEAD_ROLES);
    const manager = (LEAD_MANAGERS as readonly string[]).includes(membership.role);
    if (!manager && lead.assignedToUserId !== profile._id) throw new ConvexError("Request not found.");
    if (lead.status === "converted" || lead.status === "closed") return { changed: false };
    await ctx.db.patch(lead._id, { status: "closed", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: lead.tenantId,
      action: "lead.closed",
      entityType: "quoteRequests",
      entityId: lead._id,
      summary: `Quote request from ${lead.name} closed.`
    });
    return { changed: true };
  }
});

/**
 * Turns a request into a customer, site and completed assessment, owned by the
 * person it is assigned to. Staff then run sizing and build the priced quotation
 * in the normal workflow, where technical approval still applies.
 */
export const convertLead = mutation({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new ConvexError("Request not found.");
    const { profile, membership } = await requireTenantMembership(ctx, lead.tenantId, LEAD_ROLES);
    const manager = (LEAD_MANAGERS as readonly string[]).includes(membership.role);
    if (!manager && lead.assignedToUserId !== profile._id) throw new ConvexError("Request not found.");
    if (lead.status === "converted") throw new ConvexError("This request was already converted.");
    if (lead.status === "closed") throw new ConvexError("This request is closed.");

    const ownerUserId = lead.assignedToUserId ?? profile._id;
    const now = Date.now();
    const customerId = await ctx.db.insert("customers", {
      tenantId: lead.tenantId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      type: "residential",
      notes: "From the public power check.",
      status: "active",
      ownerUserId,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    const siteId = await ctx.db.insert("customerSites", {
      tenantId: lead.tenantId,
      customerId,
      name: "Home",
      address: lead.location,
      region: lead.location,
      gpsConsent: false,
      gridAvailability: lead.gridAvailability,
      status: "active",
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    const inputs = {
      systemType: lead.systemType,
      backupHours: lead.backupHours,
      autonomyDays: lead.autonomyDays,
      notes: `From the public power check: ${lead.optionTitle}. Hours and power are the customer's own estimates.`,
      lines: lead.lines
    };
    const assessmentId = await ctx.db.insert("assessments", {
      tenantId: lead.tenantId,
      customerId,
      siteId,
      ownerUserId,
      status: "completed",
      currentRevision: 1,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await ctx.db.insert("assessmentRevisions", {
      tenantId: lead.tenantId,
      assessmentId,
      revision: 1,
      inputs,
      results: computeLoad(lead.lines),
      engineVersion: LOAD_ENGINE_VERSION,
      createdAt: now,
      createdBy: profile.authSubject
    });
    await ctx.db.patch(lead._id, {
      status: "converted",
      assignedToUserId: ownerUserId,
      customerId,
      assessmentId,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: lead.tenantId,
      action: "lead.converted",
      entityType: "quoteRequests",
      entityId: lead._id,
      summary: `Quote request from ${lead.name} converted to a customer and assessment.`
    });
    return { customerId, assessmentId };
  }
});
