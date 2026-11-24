/**
 * The sales log (super admin) and the sales record books.
 *
 * - Inquiries: every quote request (energy, upgrade, budget) and item price request, answered or
 *   not, with where its WhatsApp went and who answered when.
 * - Checks: every public check run, and whether a request followed.
 * - Activity: the audit trail of sales actions.
 * - Staff record book: one person's inquiries, responses, WhatsApp replies, quotations and
 *   invoices or receipts, with dates and times. Managers open their agents' books.
 * - Customer record book: everything with one customer's phone number.
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireTenantMembership } from "./lib/auth";
import { ownerScope } from "./lib/crm";
import { currencyExponent } from "./lib/money";
import { LEAD_VIEWERS } from "./leads";
import { phoneKey } from "./salesDocuments";

const ADMINS = ["super_admin"] as const;
const RECENT = 500;

/** Audit actions that are sales work. */
const SALES_ACTIONS = [
  "customer.", "site.", "assessment.", "quotation.", "lead.", "item_request.", "whatsapp.replied",
  "sales_document.", "order.", "stock.reserved", "stock.released", "installation.", "commission", "upgrade."
];

type Names = Map<string, string>;
async function nameOf(ctx: QueryCtx, names: Names, id: Id<"userProfiles"> | undefined | null) {
  if (!id) return null;
  if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.displayName ?? "");
  return names.get(id) || null;
}

function requestKind(r: Doc<"quoteRequests">) {
  if (r.inputMode === "existing_system") return "Upgrade check";
  if (r.optionKey === "budget") return "Budget check";
  return "Energy check";
}

/** One quote request as the log and record books show it. */
async function inquiryRow(ctx: QueryCtx, names: Names, r: Doc<"quoteRequests">) {
  const response = await ctx.db.query("requestResponses").withIndex("by_request", (q) => q.eq("requestId", r._id)).unique();
  const sentAt = response?.status === "sent" ? response.sentAt ?? response.updatedAt : null;
  const answers = [
    sentAt ? { at: sentAt, by: response!.preparedByUserId, how: "Recommendation sent" } : null,
    r.whatsappRepliedAt ? { at: r.whatsappRepliedAt, by: r.whatsappRepliedBy, how: "Replied on WhatsApp" } : null
  ].filter((a): a is { at: number; by: Id<"userProfiles"> | undefined; how: string } => a !== null).sort((a, b) => a.at - b.at);
  const first = answers[0] ?? null;
  return {
    id: r._id as string,
    source: "quote" as const,
    kind: requestKind(r),
    link: `/dashboard/leads/${r._id}`,
    createdAt: r.createdAt,
    name: r.name,
    phone: r.phone,
    location: r.location,
    summary: r.budget
      ? `Budget ${r.budget.amountMinor.toLocaleString("en-US")} · ${r.optionTitle}`
      : r.optionTitle,
    routedTo: r.whatsappTo?.name ?? null,
    assignedTo: await nameOf(ctx, names, r.assignedToUserId),
    whatsappOpenedAt: r.whatsappOpenedAt ?? null,
    answered: first !== null,
    answeredAt: first?.at ?? null,
    answeredHow: first?.how ?? null,
    answeredBy: first ? await nameOf(ctx, names, first.by) : null
  };
}

async function itemRow(ctx: QueryCtx, names: Names, r: Doc<"itemRequests">) {
  const answers = [r.answeredAt, r.whatsappRepliedAt].filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  return {
    id: r._id as string,
    source: "item" as const,
    kind: "Item price request",
    link: "/dashboard/item-requests",
    createdAt: r.createdAt,
    name: r.name,
    phone: r.phone,
    location: r.location,
    summary: r.items.map((i) => `${i.quantity} × ${i.productName ?? i.description ?? i.type}`).join(", ").slice(0, 160),
    routedTo: r.whatsappTo?.name ?? null,
    assignedTo: await nameOf(ctx, names, r.handledByUserId),
    whatsappOpenedAt: r.whatsappOpenedAt ?? null,
    answered: answers.length > 0,
    answeredAt: answers[0] ?? null,
    answeredHow: answers.length ? (r.answeredAt === answers[0] ? "Marked contacted" : "Replied on WhatsApp") : null,
    answeredBy: answers.length ? await nameOf(ctx, names, r.whatsappRepliedAt === answers[0] ? r.whatsappRepliedBy : r.handledByUserId) : null
  };
}

/** Super admin: every inquiry, answered or not, newest first. */
export const inquiries = query({
  args: { tenantId: v.id("tenants"), show: v.optional(v.union(v.literal("all"), v.literal("answered"), v.literal("unanswered"))) },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ADMINS);
    const names: Names = new Map();
    const quotes = await ctx.db.query("quoteRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(RECENT);
    const items = await ctx.db.query("itemRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(RECENT);
    const rows = [
      ...(await Promise.all(quotes.map((r) => inquiryRow(ctx, names, r)))),
      ...(await Promise.all(items.map((r) => itemRow(ctx, names, r))))
    ].sort((a, b) => b.createdAt - a.createdAt);
    const show = args.show ?? "all";
    const shown = show === "all" ? rows : rows.filter((r) => r.answered === (show === "answered"));
    return {
      total: rows.length,
      answered: rows.filter((r) => r.answered).length,
      rows: shown
    };
  }
});

/** Super admin: every public check, and whether a request followed. */
export const checks = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ADMINS);
    const names: Names = new Map();
    const rows = await ctx.db.query("publicChecks").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(RECENT);
    return await Promise.all(
      rows.map(async (c) => ({
        id: c._id,
        kind: c.kind,
        summary: c.summary,
        createdAt: c.createdAt,
        by: await nameOf(ctx, names, c.userId),
        requestId: c.requestId ?? null
      }))
    );
  }
});

/** Super admin: the trail of sales actions (who did what, when). */
export const activity = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, ADMINS);
    const names: Names = new Map();
    const rows = await ctx.db.query("auditEvents").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000);
    const sales = rows.filter((e) => SALES_ACTIONS.some((p) => e.action.startsWith(p))).slice(0, RECENT);
    return await Promise.all(
      sales.map(async (e) => ({
        id: e._id,
        at: e.occurredAt,
        action: e.action,
        summary: e.summary,
        by: (await nameOf(ctx, names, e.actorUserId)) ?? "System"
      }))
    );
  }
});

/** The staff whose record books this person may open: themselves, their team, or everyone. */
export const bookPeople = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, LEAD_VIEWERS);
    const scope = await ownerScope(ctx, membership, profile);
    const memberships = await ctx.db.query("memberships").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect();
    const people = [];
    for (const m of memberships) {
      if (!scope.all && !scope.can(m.userId)) continue;
      if (scope.all && membership.role !== "super_admin" && m.userId !== profile._id) continue;
      const p = await ctx.db.get(m.userId);
      if (p) people.push({ userId: p._id, name: p.displayName, role: m.role, self: p._id === profile._id });
    }
    return people.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  }
});

type BookEntry = {
  at: number;
  type: "Inquiry" | "Response" | "WhatsApp reply" | "Quotation" | "Proforma invoice" | "Receipt" | "Payment";
  title: string;
  detail: string;
  link: string | null;
};

/** One staff member's record book: inquiries, responses, WhatsApp replies, quotations, invoices and receipts. */
export const staffBook = query({
  args: { tenantId: v.id("tenants"), userId: v.optional(v.id("userProfiles")) },
  handler: async (ctx, args) => {
    const { membership, profile, tenant } = await requireTenantMembership(ctx, args.tenantId, LEAD_VIEWERS);
    const userId = args.userId ?? profile._id;
    if (userId !== profile._id) {
      const scope = await ownerScope(ctx, membership, profile);
      const allowed = membership.role === "super_admin" || (!scope.all && scope.can(userId));
      if (!allowed) throw new ConvexError("You can open your own record book, or your team's.");
    }
    const person = await ctx.db.get(userId);
    const exp = currencyExponent(tenant.defaultCurrency);
    const money = (minor: number, currency = tenant.defaultCurrency) => `${currency} ${(minor / 10 ** exp).toLocaleString("en-US")}`;
    const entries: BookEntry[] = [];

    const assigned = await ctx.db.query("quoteRequests").withIndex("by_tenant_assignee", (q) => q.eq("tenantId", args.tenantId).eq("assignedToUserId", userId)).collect();
    for (const r of assigned) {
      entries.push({ at: r.createdAt, type: "Inquiry", title: `${requestKind(r)} from ${r.name}`, detail: `${r.phone} · ${r.location}${r.whatsappTo ? ` · WhatsApp to ${r.whatsappTo.name}` : ""}`, link: `/dashboard/leads/${r._id}` });
    }
    const recentQuotes = await ctx.db.query("quoteRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000);
    for (const r of recentQuotes) {
      if (r.whatsappRepliedBy === userId && r.whatsappRepliedAt) {
        entries.push({ at: r.whatsappRepliedAt, type: "WhatsApp reply", title: `Replied to ${r.name} on WhatsApp`, detail: `${requestKind(r)} · ${r.phone}`, link: `/dashboard/leads/${r._id}` });
      }
    }
    const items = await ctx.db.query("itemRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000);
    for (const r of items) {
      if (r.handledByUserId !== userId && r.whatsappRepliedBy !== userId) continue;
      entries.push({ at: r.createdAt, type: "Inquiry", title: `Item price request from ${r.name}`, detail: `${r.phone} · ${r.items.length} item(s) · ${r.status}`, link: "/dashboard/item-requests" });
      if (r.whatsappRepliedBy === userId && r.whatsappRepliedAt) {
        entries.push({ at: r.whatsappRepliedAt, type: "WhatsApp reply", title: `Replied to ${r.name} on WhatsApp`, detail: "Item price request", link: "/dashboard/item-requests" });
      }
    }
    const responses = await ctx.db.query("requestResponses").withIndex("by_tenant_preparer", (q) => q.eq("tenantId", args.tenantId).eq("preparedByUserId", userId)).collect();
    for (const resp of responses) {
      const r = await ctx.db.get(resp.requestId);
      entries.push({
        at: resp.status === "sent" ? resp.sentAt ?? resp.updatedAt : resp.updatedAt,
        type: "Response",
        title: `${resp.status === "sent" ? "Recommendation sent" : "Draft recommendation"} to ${r?.name ?? "a customer"}`,
        detail: `${resp.options.length} option(s)${r ? ` · ${r.phone}` : ""}`,
        link: r ? `/dashboard/leads/${r._id}` : null
      });
    }
    const quotations = await ctx.db.query("quotations").withIndex("by_tenant_owner", (q) => q.eq("tenantId", args.tenantId).eq("ownerUserId", userId)).collect();
    for (const q of quotations) {
      const customer = await ctx.db.get(q.customerId);
      entries.push({ at: q.createdAt, type: "Quotation", title: `${q.officialNumber ?? "Quotation draft"} for ${customer?.name ?? "a customer"}`, detail: q.status.replace(/_/g, " "), link: `/dashboard/quotations/${q._id}` });
    }
    const docs = await ctx.db.query("salesDocuments").withIndex("by_tenant_creator", (q) => q.eq("tenantId", args.tenantId).eq("createdByUserId", userId)).collect();
    for (const d of docs) {
      entries.push({ at: d.createdAt, type: d.kind === "proforma" ? "Proforma invoice" : "Receipt", title: `${d.number} for ${d.buyer.name}`, detail: `${money(d.totalMinor, d.currency)} · ${d.buyer.contact}`, link: `/dashboard/invoices?doc=${d._id}` });
      const proofs = await ctx.db.query("paymentProofs").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect();
      for (const p of proofs) {
        entries.push({ at: p.paidAt ?? p.createdAt, type: "Payment", title: `Payment proof on ${d.number} (${d.buyer.name})`, detail: p.amountMinor !== undefined ? money(p.amountMinor, d.currency) : "Amount not given", link: `/dashboard/invoices?doc=${d._id}` });
      }
    }
    return { name: person?.displayName ?? "", entries: entries.sort((a, b) => b.at - a.at) };
  }
});

/** People who have contacted the company, for finding a customer's record book. */
export const customerIndex = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, LEAD_VIEWERS);
    const byKey = new Map<string, { phone: string; name: string; last: number; count: number }>();
    const add = (name: string, phone: string, at: number) => {
      const key = phoneKey(phone);
      if (!key) return;
      const row = byKey.get(key) ?? { phone, name, last: 0, count: 0 };
      row.count += 1;
      if (at > row.last) Object.assign(row, { last: at, name, phone });
      byKey.set(key, row);
    };
    for (const r of await ctx.db.query("quoteRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000)) add(r.name, r.phone, r.createdAt);
    for (const r of await ctx.db.query("itemRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000)) add(r.name, r.phone, r.createdAt);
    for (const d of await ctx.db.query("salesDocuments").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000)) add(d.buyer.name, d.buyer.contact, d.createdAt);
    return [...byKey.values()].sort((a, b) => b.last - a.last).slice(0, 1000);
  }
});

/** One customer's record book, by phone number: inquiries, responses, invoices, receipts and payments. */
export const customerBook = query({
  args: { tenantId: v.id("tenants"), phone: v.string() },
  handler: async (ctx, args) => {
    const { membership, profile, tenant } = await requireTenantMembership(ctx, args.tenantId, LEAD_VIEWERS);
    const key = phoneKey(args.phone);
    if (key.length < 7) throw new ConvexError("Enter the customer's phone number.");
    const names: Names = new Map();
    const exp = currencyExponent(tenant.defaultCurrency);
    const money = (minor: number, currency: string) => `${currency} ${(minor / 10 ** exp).toLocaleString("en-US")}`;
    const entries: (BookEntry & { by: string | null })[] = [];
    let name = "";

    const quotes = (await ctx.db.query("quoteRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000)).filter((r) => phoneKey(r.phone) === key);
    for (const r of quotes) {
      name ||= r.name;
      const row = await inquiryRow(ctx, names, r);
      entries.push({ at: r.createdAt, type: "Inquiry", title: `${row.kind}: ${row.summary}`, detail: `${r.location}${row.routedTo ? ` · WhatsApp to ${row.routedTo}` : ""}${row.answered ? "" : " · not answered yet"}`, link: row.link, by: row.assignedTo });
      if (row.answered) entries.push({ at: row.answeredAt!, type: row.answeredHow === "Replied on WhatsApp" ? "WhatsApp reply" : "Response", title: row.answeredHow!, detail: row.kind, link: row.link, by: row.answeredBy });
    }
    const items = (await ctx.db.query("itemRequests").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).order("desc").take(2000)).filter((r) => phoneKey(r.phone) === key);
    for (const r of items) {
      name ||= r.name;
      const row = await itemRow(ctx, names, r);
      entries.push({ at: r.createdAt, type: "Inquiry", title: `Item prices: ${row.summary}`, detail: `${r.location}${row.answered ? "" : " · not answered yet"}`, link: row.link, by: row.assignedTo });
      if (row.answered) entries.push({ at: row.answeredAt!, type: row.answeredHow === "Replied on WhatsApp" ? "WhatsApp reply" : "Response", title: row.answeredHow!, detail: "Item price request", link: row.link, by: row.answeredBy });
    }
    // Invoices and receipts: agents see their own, managers their team's.
    const scope = await ownerScope(ctx, membership, profile);
    const docs = (await ctx.db.query("salesDocuments").withIndex("by_tenant_buyer", (q) => q.eq("tenantId", args.tenantId).eq("buyerPhoneKey", key)).collect()).filter((d) => scope.can(d.createdByUserId));
    for (const d of docs) {
      name ||= d.buyer.name;
      entries.push({ at: d.createdAt, type: d.kind === "proforma" ? "Proforma invoice" : "Receipt", title: `${d.number}: ${money(d.totalMinor, d.currency)}`, detail: d.items.map((i) => `${i.quantity} × ${i.description}`).join(", ").slice(0, 160), link: `/dashboard/invoices?doc=${d._id}`, by: await nameOf(ctx, names, d.createdByUserId) });
      for (const p of await ctx.db.query("paymentProofs").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()) {
        entries.push({ at: p.paidAt ?? p.createdAt, type: "Payment", title: `Payment on ${d.number}${p.amountMinor !== undefined ? `: ${money(p.amountMinor, d.currency)}` : ""}`, detail: p.note ?? "Payment proof attached", link: `/dashboard/invoices?doc=${d._id}`, by: await nameOf(ctx, names, p.addedByUserId) });
      }
    }
    return { name, phone: args.phone.trim(), entries: entries.sort((a, b) => b.at - a.at) };
  }
});
