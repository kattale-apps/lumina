/**
 * "Request an item": anyone can ask for parts (a 200 Ah lithium battery, ten 550 W panels…)
 * without knowing our catalogue. Requests are kept for sales staff and can also be sent to the
 * company on WhatsApp from the page.
 */
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { findViewerProfile, requireTenantMembership } from "./lib/auth";
import { validateOptionalEmail, validatePhone } from "./lib/crm";
import { cleanSpecValue, itemTypeByKey } from "./lib/itemTypes";
import { requesterAccount } from "./lib/requester";
import { partType } from "./lib/shopParts";
import { requireText } from "./lib/validation";
import { publicCompany } from "./estimator";
import { nextWhatsapp } from "./lib/whatsappRoute";

import { LEAD_VIEWERS } from "./leads";

const MAX_ITEMS = 10;
const MAX_PER_PHONE_PER_DAY = 5;
const MAX_PER_HOUR = 300;
const HOUR = 60 * 60 * 1000;
const PRODUCTS_SCANNED = 3000;

/** Product names we sell, by type, to suggest while typing. No prices, costs or stock levels. */
export const publicHints = query({
  args: {},
  handler: async (ctx) => {
    const company = await publicCompany(ctx);
    if (!company) return { open: false as const };
    const categories = await ctx.db
      .query("productCategories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", company.tenant._id))
      .collect();
    const byId = new Map(categories.filter((c) => c.status === "active").map((c) => [c._id, c]));
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", company.tenant._id))
      .take(PRODUCTS_SCANNED);
    const seen = new Map<string, { name: string; categoryKey: string; part: string; brands: string[] }>();
    for (const p of products) {
      const category = byId.get(p.categoryId);
      if (p.status !== "active" || !category) continue;
      const key = `${category.key}|${p.name.toLowerCase()}`;
      const row = seen.get(key) ?? { name: p.name, categoryKey: category.key, part: partType(category, p), brands: [] };
      if (!row.brands.includes(p.brand)) row.brands.push(p.brand);
      seen.set(key, row);
    }
    return {
      open: true as const,
      companyName: company.tenant.name,
      whatsappNumber: company.settings.whatsappNumber ?? null,
      contactPhone: company.settings.contactPhone ?? null,
      products: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

const itemArg = v.object({
  type: v.string(),
  subtype: v.optional(v.string()),
  specs: v.array(v.object({ key: v.string(), value: v.string() })),
  description: v.optional(v.string()),
  // A product name picked from the suggestions.
  productName: v.optional(v.string()),
  quantity: v.number()
});

type Item = Doc<"itemRequests">["items"][number];

function checkItem(raw: typeof itemArg.type, n: number): Item {
  const label = `Item ${n}`;
  const type = itemTypeByKey(raw.type);
  if (!type) throw new ConvexError(`${label}: choose what kind of item it is.`);
  const subtype = raw.subtype && type.subtypes.includes(raw.subtype) ? raw.subtype : undefined;
  const specs = [];
  for (const s of raw.specs) {
    const field = type.specs.find((f) => f.key === s.key);
    const value = cleanSpecValue(s.value);
    if (!field || !value) continue;
    specs.push({ key: field.key, value, unit: field.unit });
  }
  const description = raw.description?.trim() || undefined;
  if (description && description.length > 300) throw new ConvexError(`${label}: keep the description under 300 characters.`);
  const productName = raw.productName?.trim().slice(0, 120) || undefined;
  if (!specs.length && !description && !productName) {
    throw new ConvexError(`${label}: choose a size or describe what you need.`);
  }
  if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 1000) {
    throw new ConvexError(`${label}: the quantity must be a whole number from 1 to 1000.`);
  }
  return { type: type.key, subtype, specs, description, productName, quantity: raw.quantity };
}

export const submit = mutation({
  args: {
    items: v.array(itemArg),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    location: v.string(),
    note: v.optional(v.string()),
    // Real people leave this empty; bots tend to fill every field.
    website: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    if (args.website) return { requestId: null, whatsappNumber: null };
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("Requests are not open right now.");
    const { tenant } = company;
    if (args.items.length === 0) throw new ConvexError("Add at least one item.");
    if (args.items.length > MAX_ITEMS) throw new ConvexError(`Ask for at most ${MAX_ITEMS} items at a time.`);
    const items = args.items.map((item, i) => checkItem(item, i + 1));

    const viewer = await findViewerProfile(ctx);
    const signedIn = viewer?.profile && viewer.profile.status === "active" ? viewer.profile : null;
    const account = await requesterAccount(ctx, tenant._id, signedIn, { name: args.name, phone: args.phone });
    const name = requireText(account?.name ?? args.name ?? "", "Name", 100);
    const phone = validatePhone(account?.phone ?? args.phone ?? "");
    const email = validateOptionalEmail(signedIn?.email ?? args.email);
    const location = requireText(args.location, "Location", 200);
    const note = args.note?.trim() || undefined;
    if (note && note.length > 500) throw new ConvexError("Keep the note under 500 characters.");

    const now = Date.now();
    const recent = await ctx.db
      .query("itemRequests")
      .withIndex("by_tenant_phone_time", (q) => q.eq("tenantId", tenant._id).eq("phone", phone).gte("createdAt", now - 24 * HOUR))
      .take(MAX_PER_PHONE_PER_DAY);
    if (recent.length >= MAX_PER_PHONE_PER_DAY) throw new ConvexError("We already have your requests. Our team will contact you.");
    const lastHour = await ctx.db
      .query("itemRequests")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", tenant._id).gte("createdAt", now - HOUR))
      .take(MAX_PER_HOUR);
    if (lastHour.length >= MAX_PER_HOUR) throw new ConvexError("We are receiving a lot of requests. Please try again later.");

    const route = await nextWhatsapp(ctx, company.settings);
    const requestId = await ctx.db.insert("itemRequests", {
      tenantId: tenant._id,
      whatsappTo: route ?? undefined,
      ...(route?.userId ? { handledByUserId: route.userId } : {}),
      customerAccountId: account?._id,
      name,
      phone,
      email,
      location,
      note,
      items,
      status: "new",
      createdAt: now,
      updatedAt: now
    });
    return { requestId, whatsappNumber: route?.number ?? null };
  }
});

const STATUS = v.union(v.literal("new"), v.literal("contacted"), v.literal("closed"));

/** Staff: item requests, newest first. */
export const list = query({
  args: { tenantId: v.id("tenants"), status: v.optional(STATUS) },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, LEAD_VIEWERS);
    const rows = await ctx.db
      .query("itemRequests")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(300);
    const out = [];
    for (const r of rows) {
      if (args.status && r.status !== args.status) continue;
      const handler = r.handledByUserId ? await ctx.db.get(r.handledByUserId) : null;
      out.push({
        id: r._id,
        createdAt: r.createdAt,
        name: r.name,
        phone: r.phone,
        email: r.email ?? null,
        location: r.location,
        note: r.note ?? null,
        items: r.items,
        status: r.status,
        handledBy: handler?.displayName ?? null,
        hasAccount: Boolean(r.customerAccountId),
        whatsapp: {
          to: r.whatsappTo?.name ?? null,
          openedAt: r.whatsappOpenedAt ?? null,
          repliedAt: r.whatsappRepliedAt ?? null,
          repliedBy: r.whatsappRepliedBy ? (await ctx.db.get(r.whatsappRepliedBy))?.displayName ?? null : null
        }
      });
    }
    return out;
  }
});

/** Staff: mark a request as contacted or closed (or back to new). */
export const setStatus = mutation({
  args: { requestId: v.id("itemRequests"), status: STATUS },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new ConvexError("Request not found.");
    const { profile } = await requireTenantMembership(ctx, row.tenantId, LEAD_VIEWERS);
    const now = Date.now();
    // The first time it is marked contacted counts as answered.
    const answeredAt = row.answeredAt ?? (args.status === "contacted" ? now : undefined);
    await ctx.db.patch(row._id, { status: args.status, handledByUserId: profile._id, answeredAt, updatedAt: now });
    await recordAudit(ctx, profile, {
      tenantId: row.tenantId,
      action: "item_request.status",
      entityType: "itemRequests",
      entityId: row._id,
      summary: `Item request from ${row.name} marked ${args.status}.`
    });
    return { ok: true };
  }
});
