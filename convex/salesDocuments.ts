/**
 * Proforma invoices and receipts made by sales staff: the items and prices offered, the selling
 * company and the buyer. The PDF is drawn on the device (src/lib/salesDocPdf.ts) from what is
 * stored here, so it can be downloaded again at any time. Payment proofs (photos of mobile money
 * or bank slips) can be attached when the document is made or later, one per instalment.
 *
 * Agents see their own documents, managers their team's, the super admin everyone's.
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { filterForViewer } from "./lib/brandAccess";
import { canAccessOwned, ownedRows, ownerScope } from "./lib/crm";
import { currencyExponent, toMinorUnits } from "./lib/money";
import { productPrice } from "./lib/pricing";
import { requireText } from "./lib/validation";

export const SALES_DOC_ROLES = ["super_admin", "sales_manager", "sales_agent"] as const;
const MAX_ITEMS = 50;
const MAX_PROOFS = 30;
const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const MAX_AMOUNT = 10_000_000_000;
const PREFIX = { proforma: "PF", receipt: "RC" } as const;

/** Digits of a phone number, Ugandan numbers in international form: "0700 123456" -> "256700123456". */
export function phoneKey(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "256" + digits.slice(1);
  return digits;
}

function amount(value: number, label: string, currency: string) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw new ConvexError(`${label} must be between 0 and ${MAX_AMOUNT.toLocaleString("en-US")}.`);
  return toMinorUnits(value, currency);
}

async function loadDocument(ctx: QueryCtx, documentId: Id<"salesDocuments">) {
  const doc = await ctx.db.get(documentId);
  if (!doc) throw new ConvexError("Document not found.");
  const auth = await requireTenantMembership(ctx, doc.tenantId, SALES_DOC_ROLES);
  if (!(await canAccessOwned(ctx, auth.membership, auth.profile, doc.createdByUserId))) {
    throw new ConvexError("Document not found.");
  }
  return { doc, ...auth };
}

/** What the form needs: the company name and contacts, currency, and products with list prices. */
export const formSetup = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { tenant } = await requireTenantMembership(ctx, args.tenantId, SALES_DOC_ROLES);
    const settings = await ctx.db
      .query("publicEstimatorSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const products = await filterForViewer(ctx, args.tenantId, await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect());
    const items = [];
    for (const p of products) {
      if (p.status !== "active") continue;
      const price = await productPrice(ctx, p);
      items.push({
        id: p._id,
        name: p.name,
        brand: p.brand,
        model: p.model,
        sku: p.sku,
        listMinor: price && price.currency === tenant.defaultCurrency ? price.listMinor : null
      });
    }
    return {
      companyName: tenant.name,
      contactPhone: settings?.contactPhone ?? null,
      contactEmail: settings?.contactEmail ?? null,
      currency: tenant.defaultCurrency,
      exponent: currencyExponent(tenant.defaultCurrency),
      products: items.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

const itemArg = v.object({
  description: v.string(),
  quantity: v.number(),
  // Whole currency units, e.g. UGX.
  unitPrice: v.number(),
  productId: v.optional(v.id("products"))
});

export const createDocument = mutation({
  args: {
    tenantId: v.id("tenants"),
    kind: v.union(v.literal("proforma"), v.literal("receipt")),
    sellerName: v.string(),
    buyer: v.object({ name: v.string(), location: v.string(), contact: v.string() }),
    items: v.array(itemArg),
    notes: v.optional(v.string()),
    paymentMethod: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile, tenant } = await requireTenantMembership(ctx, args.tenantId, SALES_DOC_ROLES);
    const currency = tenant.defaultCurrency;
    const sellerName = requireText(args.sellerName, "Company name", 120);
    const buyer = {
      name: requireText(args.buyer.name, "Buyer's name", 120),
      location: requireText(args.buyer.location, "Buyer's location", 200),
      contact: requireText(args.buyer.contact, "Buyer's contact", 120)
    };
    if (args.items.length === 0) throw new ConvexError("Add at least one item.");
    if (args.items.length > MAX_ITEMS) throw new ConvexError(`At most ${MAX_ITEMS} items.`);
    let totalMinor = 0;
    const items = [];
    for (const [i, it] of args.items.entries()) {
      const description = requireText(it.description, `Item ${i + 1}`, 200);
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 1_000_000) {
        throw new ConvexError(`Item ${i + 1}: quantity must be a whole number from 1.`);
      }
      const unitPriceMinor = amount(it.unitPrice, `Item ${i + 1} price`, currency);
      if (it.productId) {
        const product = await ctx.db.get(it.productId);
        if (!product || product.tenantId !== args.tenantId) throw new ConvexError(`Item ${i + 1}: product not found.`);
      }
      totalMinor += unitPriceMinor * it.quantity;
      items.push({ description, quantity: it.quantity, unitPriceMinor, productId: it.productId });
    }
    const notes = args.notes?.trim() ? requireText(args.notes, "Notes", 500) : undefined;
    const paymentMethod = args.kind === "receipt" && args.paymentMethod?.trim() ? requireText(args.paymentMethod, "Payment method", 60) : undefined;

    const last = await ctx.db
      .query("salesDocuments")
      .withIndex("by_tenant_kind_seq", (q) => q.eq("tenantId", args.tenantId).eq("kind", args.kind))
      .order("desc")
      .first();
    const seq = (last?.seq ?? 0) + 1;
    const number = `${PREFIX[args.kind]}-${String(seq).padStart(4, "0")}`;
    const now = Date.now();
    const documentId = await ctx.db.insert("salesDocuments", {
      tenantId: args.tenantId,
      kind: args.kind,
      seq,
      number,
      sellerName,
      buyer,
      buyerPhoneKey: phoneKey(buyer.contact),
      items,
      currency,
      totalMinor,
      notes,
      paymentMethod,
      createdByUserId: profile._id,
      createdAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: args.kind === "proforma" ? "sales_document.proforma" : "sales_document.receipt",
      entityType: "salesDocuments",
      entityId: documentId,
      summary: `${args.kind === "proforma" ? "Proforma invoice" : "Receipt"} ${number} for ${buyer.name}: ${currency} ${(totalMinor / 10 ** currencyExponent(currency)).toLocaleString("en-US")}.`
    });
    return { documentId, number };
  }
});

async function present(ctx: QueryCtx, doc: Doc<"salesDocuments">) {
  const creator = await ctx.db.get(doc.createdByUserId);
  const proofs = await ctx.db
    .query("paymentProofs")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  const people = new Map<string, string>();
  const nameOf = async (id: Id<"userProfiles">) => {
    if (!people.has(id)) people.set(id, (await ctx.db.get(id))?.displayName ?? "");
    return people.get(id)!;
  };
  const paidMinor = proofs.reduce((sum, p) => sum + (p.amountMinor ?? 0), 0);
  return {
    id: doc._id,
    kind: doc.kind,
    number: doc.number,
    sellerName: doc.sellerName,
    buyer: doc.buyer,
    items: doc.items,
    currency: doc.currency,
    exponent: currencyExponent(doc.currency),
    totalMinor: doc.totalMinor,
    notes: doc.notes ?? null,
    paymentMethod: doc.paymentMethod ?? null,
    createdAt: doc.createdAt,
    createdBy: creator?.displayName ?? "",
    createdByUserId: doc.createdByUserId,
    paidMinor,
    proofs: await Promise.all(
      proofs.map(async (p) => ({
        id: p._id,
        url: await ctx.storage.getUrl(p.storageId),
        amountMinor: p.amountMinor ?? null,
        paidAt: p.paidAt ?? null,
        note: p.note ?? null,
        addedBy: await nameOf(p.addedByUserId),
        createdAt: p.createdAt
      }))
    )
  };
}

/** Documents this person may see, newest first; optionally one staff member's. */
export const listDocuments = query({
  args: { tenantId: v.id("tenants"), createdByUserId: v.optional(v.id("userProfiles")) },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, SALES_DOC_ROLES);
    const scope = await ownerScope(ctx, membership, profile);
    if (args.createdByUserId && !scope.can(args.createdByUserId)) return [];
    const rows = args.createdByUserId
      ? await ctx.db.query("salesDocuments").withIndex("by_tenant_creator", (q) => q.eq("tenantId", args.tenantId).eq("createdByUserId", args.createdByUserId!)).collect()
      : await ownedRows(
          scope,
          () => ctx.db.query("salesDocuments").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).collect(),
          (owner) => ctx.db.query("salesDocuments").withIndex("by_tenant_creator", (q) => q.eq("tenantId", args.tenantId).eq("createdByUserId", owner)).collect()
        );
    const out = [];
    for (const d of rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 300)) out.push(await present(ctx, d));
    return out;
  }
});

export const getDocument = query({
  args: { documentId: v.id("salesDocuments") },
  handler: async (ctx, args) => {
    const { doc } = await loadDocument(ctx, args.documentId);
    return await present(ctx, doc);
  }
});

/** Step 1 of attaching a payment proof: a short-lived upload link. */
export const proofUploadUrl = mutation({
  args: { documentId: v.id("salesDocuments") },
  handler: async (ctx, args) => {
    await loadDocument(ctx, args.documentId);
    return await ctx.storage.generateUploadUrl();
  }
});

/** Step 2: attach the uploaded photo, with the amount and date paid when known. */
export const addProof = mutation({
  args: {
    documentId: v.id("salesDocuments"),
    storageId: v.id("_storage"),
    amount: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { doc, profile } = await loadDocument(ctx, args.documentId);
    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw new ConvexError("The photo did not upload. Please try again.");
    if (!file.contentType?.startsWith("image/") || file.size > MAX_PROOF_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("Attach a photo (JPEG, PNG or WebP) of at most 8 MB.");
    }
    const used = await ctx.db.query("paymentProofs").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).first();
    if (used) throw new ConvexError("That photo is already attached.");
    const count = (await ctx.db.query("paymentProofs").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect()).length;
    if (count >= MAX_PROOFS) throw new ConvexError(`At most ${MAX_PROOFS} payment proofs on one document.`);
    const amountMinor = args.amount !== undefined ? amount(args.amount, "Amount paid", doc.currency) : undefined;
    const note = args.note?.trim() ? requireText(args.note, "Note", 200) : undefined;
    const proofId = await ctx.db.insert("paymentProofs", {
      tenantId: doc.tenantId,
      documentId: doc._id,
      storageId: args.storageId,
      amountMinor,
      paidAt: args.paidAt,
      note,
      addedByUserId: profile._id,
      createdAt: Date.now()
    });
    await recordAudit(ctx, profile, {
      tenantId: doc.tenantId,
      action: "sales_document.payment_proof",
      entityType: "salesDocuments",
      entityId: doc._id,
      summary: `Payment proof added to ${doc.number} (${doc.buyer.name})${amountMinor !== undefined ? `: ${doc.currency} ${(amountMinor / 10 ** currencyExponent(doc.currency)).toLocaleString("en-US")}` : ""}.`
    });
    return { proofId };
  }
});

/** Removes a proof added by mistake: the person who added it, or the super admin. */
export const removeProof = mutation({
  args: { proofId: v.id("paymentProofs") },
  handler: async (ctx, args) => {
    const proof = await ctx.db.get(args.proofId);
    if (!proof) throw new ConvexError("Payment proof not found.");
    const { doc, profile, membership } = await loadDocument(ctx, proof.documentId);
    if (proof.addedByUserId !== profile._id && membership.role !== "super_admin") {
      throw new ConvexError("Only the person who added it, or the super admin, can remove it.");
    }
    await ctx.db.delete(proof._id);
    await ctx.storage.delete(proof.storageId);
    await recordAudit(ctx, profile, {
      tenantId: doc.tenantId,
      action: "sales_document.payment_proof_removed",
      entityType: "salesDocuments",
      entityId: doc._id,
      summary: `Payment proof removed from ${doc.number}.`
    });
    return { ok: true };
  }
});

