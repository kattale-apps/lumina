import { ConvexError, v } from "convex/values";
import { customerType } from "./schema";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import {
  canAccessOwned,
  CRM_READERS,
  CRM_WRITERS,
  optionalText,
  seesAllCustomers,
  validateGps,
  validateOptionalEmail,
  validatePhone
} from "./lib/crm";
import { requireText } from "./lib/validation";

const gridAvailability = v.union(
  v.literal("none"),
  v.literal("unreliable"),
  v.literal("reliable")
);

export const listCustomers = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const all = seesAllCustomers(membership.role);
    const customers = all
      ? await ctx.db
          .query("customers")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect()
      : await ctx.db
          .query("customers")
          .withIndex("by_tenant_owner", (q) =>
            q.eq("tenantId", args.tenantId).eq("ownerUserId", profile._id)
          )
          .collect();

    return {
      canWrite: (CRM_WRITERS as readonly string[]).includes(membership.role),
      customers: customers
        .map((c) => ({
          id: c._id,
          name: c.name,
          phone: c.phone,
          email: c.email ?? "",
          type: c.type,
          status: c.status
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

export const getCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new ConvexError("Customer not found.");
    const { membership, profile } = await requireTenantMembership(
      ctx,
      customer.tenantId,
      CRM_READERS
    );
    if (!canAccessOwned(membership.role, profile, customer.ownerUserId)) {
      throw new ConvexError("Customer not found.");
    }
    const sites = await ctx.db
      .query("customerSites")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();

    return {
      canWrite: (CRM_WRITERS as readonly string[]).includes(membership.role),
      customer: {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email ?? "",
        type: customer.type,
        notes: customer.notes ?? "",
        status: customer.status
      },
      sites: sites.map((s) => ({
        id: s._id,
        name: s.name,
        address: s.address,
        region: s.region,
        gps: s.gps ?? null,
        gpsConsent: s.gpsConsent,
        gridAvailability: s.gridAvailability,
        existingSystem: s.existingSystem ?? "",
        status: s.status
      }))
    };
  }
});

export const createCustomer = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    type: customerType,
    notes: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, CRM_WRITERS);
    const fields = {
      name: requireText(args.name, "Customer name", 120),
      phone: validatePhone(args.phone),
      email: validateOptionalEmail(args.email),
      type: args.type,
      notes: optionalText(args.notes, "Notes", 1000)
    };
    const now = Date.now();
    const customerId = await ctx.db.insert("customers", {
      tenantId: args.tenantId,
      ...fields,
      status: "active",
      ownerUserId: profile._id,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "customer.created",
      entityType: "customers",
      entityId: customerId,
      summary: `Customer ${fields.name} created.`,
      metadata: { after: { ...fields, status: "active" } }
    });
    return { customerId };
  }
});

export const updateCustomer = mutation({
  args: {
    customerId: v.id("customers"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    type: customerType,
    notes: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived"))
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new ConvexError("Customer not found.");
    const { profile, membership } = await requireTenantMembership(
      ctx,
      customer.tenantId,
      CRM_WRITERS
    );
    if (!canAccessOwned(membership.role, profile, customer.ownerUserId)) {
      throw new ConvexError("Customer not found.");
    }

    const after = {
      name: requireText(args.name, "Customer name", 120),
      phone: validatePhone(args.phone),
      email: validateOptionalEmail(args.email),
      type: args.type,
      notes: optionalText(args.notes, "Notes", 1000),
      status: args.status
    };
    const before = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      type: customer.type,
      notes: customer.notes,
      status: customer.status
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(customer._id, { ...after, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: customer.tenantId,
      action: "customer.updated",
      entityType: "customers",
      entityId: customer._id,
      summary: `Customer ${after.name} updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});

const siteFields = {
  name: v.string(),
  address: v.string(),
  region: v.string(),
  gps: v.optional(v.object({ lat: v.number(), lng: v.number() })),
  gpsConsent: v.boolean(),
  gridAvailability,
  existingSystem: v.optional(v.string())
};

function cleanSite(args: {
  name: string;
  address: string;
  region: string;
  gps?: { lat: number; lng: number };
  gpsConsent: boolean;
  gridAvailability: "none" | "unreliable" | "reliable";
  existingSystem?: string;
}) {
  return {
    name: requireText(args.name, "Site name", 80),
    address: requireText(args.address, "Address", 200),
    region: requireText(args.region, "Region", 80),
    gps: validateGps(args.gps, args.gpsConsent),
    gpsConsent: args.gpsConsent,
    gridAvailability: args.gridAvailability,
    existingSystem: optionalText(args.existingSystem, "Existing system", 500)
  };
}

export const createSite = mutation({
  args: { customerId: v.id("customers"), ...siteFields },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new ConvexError("Customer not found.");
    const { profile, membership } = await requireTenantMembership(
      ctx,
      customer.tenantId,
      CRM_WRITERS
    );
    if (!canAccessOwned(membership.role, profile, customer.ownerUserId)) {
      throw new ConvexError("Customer not found.");
    }
    if (customer.status !== "active") throw new ConvexError("This customer is archived.");

    const fields = cleanSite(args);
    const now = Date.now();
    const siteId = await ctx.db.insert("customerSites", {
      tenantId: customer.tenantId,
      customerId: customer._id,
      ...fields,
      status: "active",
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: customer.tenantId,
      action: "site.created",
      entityType: "customerSites",
      entityId: siteId,
      summary: `Site ${fields.name} added for ${customer.name}.`,
      metadata: { after: fields }
    });
    return { siteId };
  }
});

export const updateSite = mutation({
  args: {
    siteId: v.id("customerSites"),
    ...siteFields,
    status: v.union(v.literal("active"), v.literal("archived"))
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new ConvexError("Site not found.");
    const customer = await ctx.db.get(site.customerId);
    if (!customer) throw new ConvexError("Site not found.");
    const { profile, membership } = await requireTenantMembership(
      ctx,
      site.tenantId,
      CRM_WRITERS
    );
    if (!canAccessOwned(membership.role, profile, customer.ownerUserId)) {
      throw new ConvexError("Site not found.");
    }

    const after = { ...cleanSite(args), status: args.status };
    const before = {
      name: site.name,
      address: site.address,
      region: site.region,
      gps: site.gps,
      gpsConsent: site.gpsConsent,
      gridAvailability: site.gridAvailability,
      existingSystem: site.existingSystem,
      status: site.status
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };

    await ctx.db.patch(site._id, { ...after, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: site.tenantId,
      action: "site.updated",
      entityType: "customerSites",
      entityId: site._id,
      summary: `Site ${after.name} updated.`,
      metadata: { before, after }
    });
    return { changed: true };
  }
});
