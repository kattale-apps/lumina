import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import {
  requireText,
  validateCurrency,
  validateWarehouseCode
} from "./lib/validation";

/** Roles that manage stock locations. Company-wide settings are super_admin only. */
const WAREHOUSE_ADMINS = ["super_admin", "inventory_admin"] as const;
const MAX_SUPPORTED_CURRENCIES = 10;

export const getCompany = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { tenant, membership } = await requireTenantMembership(ctx, args.tenantId);
    return {
      tenantId: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      defaultCurrency: tenant.defaultCurrency,
      supportedCurrencies: tenant.supportedCurrencies,
      role: membership.role
    };
  }
});

export const updateCompany = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    defaultCurrency: v.string(),
    supportedCurrencies: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const { profile, tenant } = await requireTenantMembership(ctx, args.tenantId, [
      "super_admin"
    ]);

    const name = requireText(args.name, "Company name", 80);
    const defaultCurrency = validateCurrency(args.defaultCurrency);
    const supportedCurrencies = Array.from(
      new Set([defaultCurrency, ...args.supportedCurrencies.map(validateCurrency)])
    );
    if (supportedCurrencies.length > MAX_SUPPORTED_CURRENCIES) {
      throw new ConvexError(`Support at most ${MAX_SUPPORTED_CURRENCIES} currencies.`);
    }

    const before = {
      name: tenant.name,
      defaultCurrency: tenant.defaultCurrency,
      supportedCurrencies: tenant.supportedCurrencies
    };
    const after = { name, defaultCurrency, supportedCurrencies };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(tenant._id, after);
    await recordAudit(ctx, profile, {
      tenantId: tenant._id,
      action: "tenant.settings_updated",
      entityType: "tenants",
      entityId: tenant._id,
      summary: "Company settings updated.",
      metadata: { before, after }
    });
    return { changed: true };
  }
});

export const listWarehouses = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const warehouses = await ctx.db
      .query("warehouses")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    return {
      canManage: (WAREHOUSE_ADMINS as readonly string[]).includes(membership.role),
      warehouses: warehouses
        .map((w) => ({
          id: w._id,
          name: w.name,
          code: w.code,
          location: w.location ?? "",
          status: w.status
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

async function assertCodeFree(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  code: string,
  exceptId?: Id<"warehouses">
) {
  const clash = await ctx.db
    .query("warehouses")
    .withIndex("by_tenant_code", (q) => q.eq("tenantId", tenantId).eq("code", code))
    .unique();
  if (clash && clash._id !== exceptId) {
    throw new ConvexError(`A warehouse with code "${code}" already exists.`);
  }
}

export const createWarehouse = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    code: v.string(),
    location: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, WAREHOUSE_ADMINS);

    const name = requireText(args.name, "Warehouse name", 80);
    const code = validateWarehouseCode(args.code);
    const location = args.location?.trim() ? requireText(args.location, "Location", 160) : undefined;
    await assertCodeFree(ctx, args.tenantId, code);

    const now = Date.now();
    const warehouseId = await ctx.db.insert("warehouses", {
      tenantId: args.tenantId,
      name,
      code,
      location,
      status: "active",
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "warehouse.created",
      entityType: "warehouses",
      entityId: warehouseId,
      summary: `Warehouse ${code} (${name}) created.`,
      metadata: { after: { name, code, location, status: "active" } }
    });
    return { warehouseId };
  }
});

export const updateWarehouse = mutation({
  args: {
    warehouseId: v.id("warehouses"),
    name: v.string(),
    code: v.string(),
    location: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("inactive"))
  },
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new ConvexError("Warehouse not found.");
    const { profile } = await requireTenantMembership(
      ctx,
      warehouse.tenantId,
      WAREHOUSE_ADMINS
    );

    const name = requireText(args.name, "Warehouse name", 80);
    const code = validateWarehouseCode(args.code);
    const location = args.location?.trim() ? requireText(args.location, "Location", 160) : undefined;
    await assertCodeFree(ctx, warehouse.tenantId, code, warehouse._id);

    const before = {
      name: warehouse.name,
      code: warehouse.code,
      location: warehouse.location,
      status: warehouse.status
    };
    const after = { name, code, location, status: args.status };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(warehouse._id, { ...after, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: warehouse.tenantId,
      action: "warehouse.updated",
      entityType: "warehouses",
      entityId: warehouse._id,
      summary: `Warehouse ${code} updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});
