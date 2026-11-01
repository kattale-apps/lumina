import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { DEFAULT_APPLIANCES } from "./lib/applianceDefaults";
import { CRM_READERS } from "./lib/crm";
import { requireText } from "./lib/validation";

/** Roles that maintain the shared appliance library. Agents use it and add custom lines. */
const LIBRARY_ADMINS = ["super_admin", "sales_manager", "technician"] as const;

const applianceFields = {
  name: v.string(),
  category: v.string(),
  powerW: v.number(),
  surgeW: v.optional(v.number()),
  powerFactor: v.optional(v.number()),
  typicalHoursPerDay: v.number(),
  currentType: v.union(v.literal("ac"), v.literal("dc"))
};

function cleanAppliance(args: {
  name: string;
  category: string;
  powerW: number;
  surgeW?: number;
  powerFactor?: number;
  typicalHoursPerDay: number;
  currentType: "ac" | "dc";
}) {
  if (!(args.powerW > 0 && args.powerW <= 1_000_000)) {
    throw new ConvexError("Power must be greater than 0 W.");
  }
  if (args.surgeW !== undefined && !(args.surgeW >= args.powerW)) {
    throw new ConvexError("Starting power cannot be below running power.");
  }
  if (args.powerFactor !== undefined && !(args.powerFactor > 0 && args.powerFactor <= 1)) {
    throw new ConvexError("Power factor must be above 0 and at most 1.");
  }
  if (!(args.typicalHoursPerDay > 0 && args.typicalHoursPerDay <= 24)) {
    throw new ConvexError("Typical hours per day must be between 0 and 24.");
  }
  return {
    name: requireText(args.name, "Appliance name", 80),
    category: requireText(args.category, "Category", 40),
    powerW: args.powerW,
    surgeW: args.surgeW,
    powerFactor: args.powerFactor,
    typicalHoursPerDay: args.typicalHoursPerDay,
    currentType: args.currentType
  };
}

async function assertNameFree(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  name: string,
  exceptId?: Id<"appliances">
) {
  const clash = await ctx.db
    .query("appliances")
    .withIndex("by_tenant_name", (q) => q.eq("tenantId", tenantId).eq("name", name))
    .unique();
  if (clash && clash._id !== exceptId) {
    throw new ConvexError(`An appliance named "${name}" already exists.`);
  }
}

export const listAppliances = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const rows = await ctx.db
      .query("appliances")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return {
      canManage: (LIBRARY_ADMINS as readonly string[]).includes(membership.role),
      appliances: rows
        .map((a) => ({
          id: a._id,
          name: a.name,
          category: a.category,
          powerW: a.powerW,
          surgeW: a.surgeW ?? null,
          powerFactor: a.powerFactor ?? null,
          typicalHoursPerDay: a.typicalHoursPerDay,
          currentType: a.currentType,
          status: a.status
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    };
  }
});

export const createAppliance = mutation({
  args: { tenantId: v.id("tenants"), ...applianceFields },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, LIBRARY_ADMINS);
    const { ...fields } = cleanAppliance(args);
    await assertNameFree(ctx, args.tenantId, fields.name);
    const now = Date.now();
    const applianceId = await ctx.db.insert("appliances", {
      tenantId: args.tenantId,
      ...fields,
      status: "active",
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "appliance.created",
      entityType: "appliances",
      entityId: applianceId,
      summary: `Appliance ${fields.name} added to the library.`,
      metadata: { after: fields }
    });
    return { applianceId };
  }
});

export const updateAppliance = mutation({
  args: {
    applianceId: v.id("appliances"),
    ...applianceFields,
    status: v.union(v.literal("active"), v.literal("archived"))
  },
  handler: async (ctx, args) => {
    const appliance = await ctx.db.get(args.applianceId);
    if (!appliance) throw new ConvexError("Appliance not found.");
    const { profile } = await requireTenantMembership(ctx, appliance.tenantId, LIBRARY_ADMINS);

    const after = { ...cleanAppliance(args), status: args.status };
    await assertNameFree(ctx, appliance.tenantId, after.name, appliance._id);
    const before = {
      name: appliance.name,
      category: appliance.category,
      powerW: appliance.powerW,
      surgeW: appliance.surgeW,
      powerFactor: appliance.powerFactor,
      typicalHoursPerDay: appliance.typicalHoursPerDay,
      currentType: appliance.currentType,
      status: appliance.status
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(appliance._id, { ...after, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: appliance.tenantId,
      action: "appliance.updated",
      entityType: "appliances",
      entityId: appliance._id,
      summary: `Appliance ${after.name} updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});

/** Adds the starting library; appliances that already exist by name are left untouched. */
export const loadStandardAppliances = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, LIBRARY_ADMINS);
    const now = Date.now();
    let added = 0;
    for (const item of DEFAULT_APPLIANCES) {
      const existing = await ctx.db
        .query("appliances")
        .withIndex("by_tenant_name", (q) => q.eq("tenantId", args.tenantId).eq("name", item.name))
        .unique();
      if (existing) continue;
      await ctx.db.insert("appliances", {
        tenantId: args.tenantId,
        ...item,
        status: "active",
        createdAt: now,
        createdBy: profile.authSubject,
        updatedAt: now
      });
      added++;
    }
    if (added > 0) {
      await recordAudit(ctx, profile, {
        tenantId: args.tenantId,
        action: "appliance.standard_loaded",
        entityType: "appliances",
        entityId: "standard-library",
        summary: `Standard appliance library loaded (${added} added).`
      });
    }
    return { added };
  }
});
