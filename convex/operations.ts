import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership, type AppRole } from "./lib/auth";
import { canAccessOwned, CRM_READERS, CRM_WRITERS, optionalText } from "./lib/crm";
import {
  addMonths,
  applyBps,
  assertInstallationMove,
  buildInstallmentPlan,
  validateCommissionBps,
  type InstallationStatus
} from "./lib/finance";
import { postMovement } from "./lib/stock";
import { requireText } from "./lib/validation";

type Ctx = QueryCtx | MutationCtx;

const MANAGERS = ["super_admin", "sales_manager"] as const;
const FIELD_STAFF = ["super_admin", "sales_manager", "technician"] as const;
const DAY_MS = 86_400_000;
/** How long goods stay held for a won deal while it waits to be installed. */
const WON_HOLD_DAYS = 60;
const EXPIRING_SOON_DAYS = 60;

// ------------------------------------------------------------------ helpers

async function loadOwnedQuotation(ctx: Ctx, quotationId: Id<"quotations">, write: boolean) {
  const quotation = await ctx.db.get(quotationId);
  if (!quotation) throw new ConvexError("Quotation not found.");
  const auth = await requireTenantMembership(
    ctx,
    quotation.tenantId,
    write ? CRM_WRITERS : CRM_READERS
  );
  if (!canAccessOwned(auth.membership.role, auth.profile, quotation.ownerUserId)) {
    throw new ConvexError("Quotation not found.");
  }
  return { quotation, ...auth };
}

async function issuedRevision(ctx: Ctx, quotation: Doc<"quotations">) {
  const number = quotation.issuedRevision ?? quotation.currentRevision;
  const revision = await ctx.db
    .query("quotationRevisions")
    .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id).eq("revision", number))
    .unique();
  if (!revision) throw new ConvexError("Revision not found.");
  return revision;
}

async function outcomeFor(ctx: Ctx, quotationId: Id<"quotations">) {
  return await ctx.db
    .query("dealOutcomes")
    .withIndex("by_quotation", (q) => q.eq("quotationId", quotationId))
    .unique();
}

async function commissionRate(ctx: Ctx, tenantId: Id<"tenants">) {
  const row = await ctx.db
    .query("operationsSettings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  return row?.commissionBps ?? 0;
}

async function names(ctx: Ctx, ids: (Id<"userProfiles"> | undefined)[]) {
  const map = new Map<string, string>();
  for (const id of ids) {
    if (!id || map.has(id)) continue;
    const profile = await ctx.db.get(id);
    map.set(id, profile?.displayName ?? "Unknown");
  }
  return map;
}

async function holdsOf(ctx: Ctx, quotation: Doc<"quotations">) {
  const holds: Doc<"stockReservations">[] = [];
  for (const id of quotation.reservationIds ?? []) {
    const hold = await ctx.db.get(id);
    if (hold) holds.push(hold);
  }
  return holds;
}

async function releaseHolds(ctx: MutationCtx, quotation: Doc<"quotations">) {
  const now = Date.now();
  for (const hold of await holdsOf(ctx, quotation)) {
    if (hold.status === "active") await ctx.db.patch(hold._id, { status: "released", resolvedAt: now });
  }
  for (const id of quotation.supplierReservationIds ?? []) {
    const hold = await ctx.db.get(id);
    if (hold?.status === "active") await ctx.db.patch(id, { status: "released", resolvedAt: now });
  }
}

// ------------------------------------------------------------------ settings

export const getSettings = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    return {
      commissionBps: await commissionRate(ctx, args.tenantId),
      canEdit: (MANAGERS as readonly AppRole[]).includes(membership.role)
    };
  }
});

export const setCommissionRate = mutation({
  args: { tenantId: v.id("tenants"), commissionBps: v.number() },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, MANAGERS);
    const bps = validateCommissionBps(args.commissionBps);
    const existing = await ctx.db
      .query("operationsSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const before = existing?.commissionBps ?? 0;
    const row = { commissionBps: bps, updatedAt: Date.now(), updatedBy: profile.authSubject };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("operationsSettings", { tenantId: args.tenantId, ...row });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "operations.commission_rate_set",
      entityType: "operationsSettings",
      entityId: args.tenantId,
      summary: `Commission rate changed from ${before / 100}% to ${bps / 100}%. Applies to deals won from now on.`,
      metadata: { before, after: bps }
    });
    return { ok: true };
  }
});

// ------------------------------------------------------------------ deal outcome

/**
 * Records that a customer accepted (won) or declined (lost) an official
 * quotation. Winning opens an installation job, keeps the goods held and accrues
 * the commission at the rate in force today.
 */
export const recordOutcome = mutation({
  args: {
    quotationId: v.id("quotations"),
    outcome: v.union(v.literal("won"), v.literal("lost")),
    reason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadOwnedQuotation(ctx, args.quotationId, true);
    if (quotation.status !== "officially_issued") {
      throw new ConvexError("Only an officially issued quotation can be marked won or lost.");
    }
    if (await outcomeFor(ctx, quotation._id)) {
      throw new ConvexError("This quotation already has an outcome.");
    }
    const now = Date.now();
    const revision = await issuedRevision(ctx, quotation);
    const reason =
      args.outcome === "lost"
        ? requireText(args.reason ?? "", "A reason", 300)
        : optionalText(args.reason, "Note", 300);

    if (args.outcome === "won" && quotation.validUntil !== undefined && quotation.validUntil <= now) {
      throw new ConvexError("This quotation has passed its validity date. Issue a new quotation.");
    }

    const dealId = await ctx.db.insert("dealOutcomes", {
      tenantId: quotation.tenantId,
      quotationId: quotation._id,
      customerId: quotation.customerId,
      ownerUserId: quotation.ownerUserId,
      outcome: args.outcome,
      reason,
      revision: revision.revision,
      currency: revision.currency,
      subtotalMinor: revision.subtotalMinor,
      totalMinor: revision.totalMinor,
      decidedAt: now,
      decidedBy: profile.authSubject
    });

    let commissionMinor = 0;
    let installationId: Id<"installations"> | undefined;
    if (args.outcome === "lost") {
      await releaseHolds(ctx, quotation);
    } else {
      for (const hold of await holdsOf(ctx, quotation)) {
        if (hold.status === "active") await ctx.db.patch(hold._id, { expiresAt: Math.max(hold.expiresAt, now + WON_HOLD_DAYS * DAY_MS) });
      }
      for (const id of quotation.supplierReservationIds ?? []) {
        const hold = await ctx.db.get(id);
        if (hold?.status === "active") await ctx.db.patch(id, { expiresAt: Math.max(hold.expiresAt, now + WON_HOLD_DAYS * DAY_MS) });
      }
      const rateBps = await commissionRate(ctx, quotation.tenantId);
      if (rateBps > 0) {
        commissionMinor = applyBps(revision.subtotalMinor, rateBps);
        await ctx.db.insert("commissions", {
          tenantId: quotation.tenantId,
          dealId,
          quotationId: quotation._id,
          agentUserId: quotation.ownerUserId,
          currency: revision.currency,
          baseMinor: revision.subtotalMinor,
          rateBps,
          amountMinor: commissionMinor,
          status: "accrued",
          createdAt: now
        });
      }
      installationId = await ctx.db.insert("installations", {
        tenantId: quotation.tenantId,
        quotationId: quotation._id,
        customerId: quotation.customerId,
        siteId: quotation.siteId,
        ownerUserId: quotation.ownerUserId,
        status: "pending",
        createdAt: now,
        updatedAt: now
      });
    }

    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: `deal.${args.outcome}`,
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Quotation ${quotation.officialNumber} marked ${args.outcome}.`,
      metadata: { reason, commissionMinor, installationId }
    });
    return { dealId, installationId, commissionMinor };
  }
});

export const getOutcome = query({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const { quotation } = await loadOwnedQuotation(ctx, args.quotationId, false);
    const deal = await outcomeFor(ctx, quotation._id);
    const installation = await ctx.db
      .query("installations")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id))
      .first();
    return {
      outcome: deal ? { outcome: deal.outcome, reason: deal.reason, decidedAt: deal.decidedAt } : null,
      installationId: installation?._id ?? null
    };
  }
});

// ------------------------------------------------------------------ commissions

export const listCommissions = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, [
      "super_admin",
      "sales_manager",
      "sales_agent"
    ]);
    const manager = (MANAGERS as readonly AppRole[]).includes(membership.role);
    const rows = manager
      ? await ctx.db.query("commissions").withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId)).collect()
      : await ctx.db
          .query("commissions")
          .withIndex("by_tenant_agent", (q) => q.eq("tenantId", args.tenantId).eq("agentUserId", profile._id))
          .collect();
    const agents = await names(ctx, rows.map((r) => r.agentUserId));
    const out = [];
    for (const row of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const quotation = await ctx.db.get(row.quotationId);
      const customer = quotation ? await ctx.db.get(quotation.customerId) : null;
      out.push({
        id: row._id,
        quotationNumber: quotation?.officialNumber ?? "",
        customerName: customer?.name ?? "",
        agentName: agents.get(row.agentUserId) ?? "",
        currency: row.currency,
        baseMinor: row.baseMinor,
        rateBps: row.rateBps,
        amountMinor: row.amountMinor,
        status: row.status,
        createdAt: row.createdAt,
        paidAt: row.paidAt,
        paymentReference: row.paymentReference,
        cancelReason: row.cancelReason,
        // Nobody approves or pays their own commission.
        canDecide: manager && row.agentUserId !== profile._id
      });
    }
    return { commissions: out, canManage: manager };
  }
});

export const decideCommission = mutation({
  args: {
    commissionId: v.id("commissions"),
    action: v.union(v.literal("approve"), v.literal("pay"), v.literal("cancel")),
    paymentReference: v.optional(v.string()),
    reason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const commission = await ctx.db.get(args.commissionId);
    if (!commission) throw new ConvexError("Commission not found.");
    const { profile } = await requireTenantMembership(ctx, commission.tenantId, MANAGERS);
    if (commission.agentUserId === profile._id) {
      throw new ConvexError("You cannot approve, pay or cancel your own commission.");
    }
    const now = Date.now();
    if (args.action === "approve") {
      if (commission.status !== "accrued") throw new ConvexError("Only an accrued commission can be approved.");
      await ctx.db.patch(commission._id, { status: "approved", approvedAt: now, approvedBy: profile.authSubject });
    } else if (args.action === "pay") {
      if (commission.status !== "approved") throw new ConvexError("Approve the commission before paying it.");
      const paymentReference = requireText(args.paymentReference ?? "", "A payment reference", 80);
      await ctx.db.patch(commission._id, { status: "paid", paidAt: now, paidBy: profile.authSubject, paymentReference });
    } else {
      if (commission.status !== "accrued" && commission.status !== "approved") {
        throw new ConvexError("Only an unpaid commission can be cancelled.");
      }
      const reason = requireText(args.reason ?? "", "A reason", 300);
      await ctx.db.patch(commission._id, { status: "cancelled", cancelReason: reason });
    }
    await recordAudit(ctx, profile, {
      tenantId: commission.tenantId,
      action: `commission.${args.action}`,
      entityType: "commissions",
      entityId: commission._id,
      summary: `Commission ${args.action} (${commission.amountMinor} ${commission.currency} minor units).`,
      metadata: { reason: args.reason, paymentReference: args.paymentReference }
    });
    return { ok: true };
  }
});

// ------------------------------------------------------------------ installations

async function loadInstallation(ctx: Ctx, installationId: Id<"installations">) {
  const installation = await ctx.db.get(installationId);
  if (!installation) throw new ConvexError("Installation not found.");
  const auth = await requireTenantMembership(ctx, installation.tenantId, [
    ...FIELD_STAFF,
    "sales_agent"
  ]);
  if (!canAccessOwned(auth.membership.role, auth.profile, installation.ownerUserId)) {
    throw new ConvexError("Installation not found.");
  }
  return { installation, ...auth };
}

/** Managers always; a technician only for a job assigned to them. */
function canWork(role: AppRole, profile: Doc<"userProfiles">, installation: Doc<"installations">) {
  if ((MANAGERS as readonly AppRole[]).includes(role)) return true;
  return role === "technician" && installation.technicianUserId === profile._id;
}

export const listTechnicians = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, MANAGERS);
    const members = await ctx.db.query("memberships").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect();
    const out = [];
    for (const m of members) {
      if (m.status !== "active" || m.role !== "technician") continue;
      const profile = await ctx.db.get(m.userId);
      if (profile?.status === "active") out.push({ id: profile._id, name: profile.displayName });
    }
    return out;
  }
});

export const listInstallations = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, [
      ...FIELD_STAFF,
      "sales_agent"
    ]);
    const all = await ctx.db.query("installations").withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId)).collect();
    const visible = all.filter((i) => canAccessOwned(membership.role, profile, i.ownerUserId));
    const people = await names(ctx, visible.flatMap((i) => [i.technicianUserId, i.ownerUserId]));
    const out = [];
    for (const i of visible.sort((a, b) => b.createdAt - a.createdAt)) {
      const quotation = await ctx.db.get(i.quotationId);
      const customer = await ctx.db.get(i.customerId);
      const site = await ctx.db.get(i.siteId);
      out.push({
        id: i._id,
        quotationNumber: quotation?.officialNumber ?? "",
        customerName: customer?.name ?? "",
        siteName: site?.name ?? "",
        siteAddress: site?.address ?? "",
        status: i.status,
        scheduledFor: i.scheduledFor,
        completedAt: i.completedAt,
        technicianName: i.technicianUserId ? people.get(i.technicianUserId) : undefined,
        agentName: people.get(i.ownerUserId),
        notes: i.notes,
        cancelReason: i.cancelReason,
        canManage: (MANAGERS as readonly AppRole[]).includes(membership.role),
        canWork: canWork(membership.role, profile, i)
      });
    }
    return out;
  }
});

export const scheduleInstallation = mutation({
  args: {
    installationId: v.id("installations"),
    technicianUserId: v.id("userProfiles"),
    scheduledFor: v.number()
  },
  handler: async (ctx, args) => {
    const { installation, profile } = await loadInstallation(ctx, args.installationId);
    await requireTenantMembership(ctx, installation.tenantId, MANAGERS);
    assertInstallationMove(installation.status as InstallationStatus, "scheduled");
    const tech = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) => q.eq("userId", args.technicianUserId).eq("tenantId", installation.tenantId))
      .unique();
    if (!tech || tech.status !== "active" || tech.role !== "technician") {
      throw new ConvexError("Choose an active technician from this company.");
    }
    if (!Number.isFinite(args.scheduledFor) || args.scheduledFor < Date.now() - DAY_MS) {
      throw new ConvexError("Choose a date that is not in the past.");
    }
    await ctx.db.patch(installation._id, {
      status: "scheduled",
      technicianUserId: args.technicianUserId,
      scheduledFor: args.scheduledFor,
      updatedAt: Date.now()
    });
    await recordAudit(ctx, profile, {
      tenantId: installation.tenantId,
      action: "installation.scheduled",
      entityType: "installations",
      entityId: installation._id,
      summary: "Installation scheduled.",
      metadata: { technicianUserId: args.technicianUserId, scheduledFor: args.scheduledFor }
    });
    return { ok: true };
  }
});

export const startInstallation = mutation({
  args: { installationId: v.id("installations") },
  handler: async (ctx, args) => {
    const { installation, profile, membership } = await loadInstallation(ctx, args.installationId);
    if (!canWork(membership.role, profile, installation)) {
      throw new ConvexError("Only the assigned technician or a manager can start this installation.");
    }
    assertInstallationMove(installation.status as InstallationStatus, "in_progress");
    const now = Date.now();
    await ctx.db.patch(installation._id, { status: "in_progress", startedAt: now, updatedAt: now });
    await recordAudit(ctx, profile, {
      tenantId: installation.tenantId,
      action: "installation.started",
      entityType: "installations",
      entityId: installation._id,
      summary: "Installation started."
    });
    return { ok: true };
  }
});

/**
 * Completing an installation is the point where goods leave stock and warranties
 * begin: held units become real "issue" movements, and each quoted warranty
 * period starts today.
 */
export const completeInstallation = mutation({
  args: { installationId: v.id("installations"), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { installation, profile, membership } = await loadInstallation(ctx, args.installationId);
    if (!canWork(membership.role, profile, installation)) {
      throw new ConvexError("Only the assigned technician or a manager can complete this installation.");
    }
    assertInstallationMove(installation.status as InstallationStatus, "completed");
    const notes = optionalText(args.notes, "Notes", 1000);
    const quotation = await ctx.db.get(installation.quotationId);
    if (!quotation) throw new ConvexError("Quotation not found.");
    const revision = await issuedRevision(ctx, quotation);
    const now = Date.now();

    for (const hold of await holdsOf(ctx, quotation)) {
      if (hold.status !== "active") continue;
      const product = await ctx.db.get(hold.productId);
      const warehouse = await ctx.db.get(hold.warehouseId);
      if (!product || !warehouse) throw new ConvexError("A held product or warehouse is missing.");
      await postMovement(ctx, profile, {
        tenantId: installation.tenantId,
        product,
        warehouse,
        type: "issue",
        delta: -hold.quantity,
        reference: quotation.officialNumber,
        reason: "Installed for customer",
        protectReserved: false
      });
      await ctx.db.patch(hold._id, { status: "fulfilled", resolvedAt: now });
    }

    for (const id of quotation.supplierReservationIds ?? []) {
      const hold = await ctx.db.get(id);
      if (!hold || hold.status !== "active") continue;
      const offer = await ctx.db.get(hold.offerId);
      if (!offer || offer.availableQuantity < hold.quantity) throw new ConvexError("Reserved supplier stock is no longer available to fulfil this installation.");
      const balance = offer.availableQuantity - hold.quantity;
      await ctx.db.patch(offer._id,{availableQuantity:balance,updatedAt:now});
      await ctx.db.insert("supplierStockMovements",{
        tenantId:installation.tenantId,supplierId:hold.supplierId,offerId:offer._id,
        type:"issue",quantity:-hold.quantity,balanceAfter:balance,reference:quotation.officialNumber,
        reason:"Installed for customer",idempotencyKey:"install:"+String(installation._id)+":"+String(offer._id),
        actorUserId:profile._id,createdAt:now
      });
      await ctx.db.patch(hold._id,{status:"fulfilled",resolvedAt:now});
    }

    let warranties = 0;
    for (const line of revision.lines) {
      if (line.kind !== "product" || !line.warrantyMonths || line.warrantyMonths < 1) continue;
      await ctx.db.insert("warranties", {
        tenantId: installation.tenantId,
        installationId: installation._id,
        quotationId: quotation._id,
        customerId: installation.customerId,
        productId: line.productId,
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        months: line.warrantyMonths,
        startsAt: now,
        endsAt: addMonths(now, line.warrantyMonths)
      });
      warranties++;
    }

    await ctx.db.patch(installation._id, { status: "completed", completedAt: now, notes, updatedAt: now });
    await recordAudit(ctx, profile, {
      tenantId: installation.tenantId,
      action: "installation.completed",
      entityType: "installations",
      entityId: installation._id,
      summary: `Installation completed; ${warranties} warranty record(s) started.`,
      metadata: { warranties }
    });
    return { warranties };
  }
});

export const cancelInstallation = mutation({
  args: { installationId: v.id("installations"), reason: v.string() },
  handler: async (ctx, args) => {
    const { installation, profile } = await loadInstallation(ctx, args.installationId);
    await requireTenantMembership(ctx, installation.tenantId, MANAGERS);
    assertInstallationMove(installation.status as InstallationStatus, "cancelled");
    const reason = requireText(args.reason, "A reason", 300);
    const quotation = await ctx.db.get(installation.quotationId);
    if (quotation) await releaseHolds(ctx, quotation);
    await ctx.db.patch(installation._id, { status: "cancelled", cancelReason: reason, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: installation.tenantId,
      action: "installation.cancelled",
      entityType: "installations",
      entityId: installation._id,
      summary: "Installation cancelled; held stock released. Review any commission separately.",
      metadata: { reason }
    });
    return { ok: true };
  }
});

export const listWarranties = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const rows = await ctx.db.query("warranties").withIndex("by_tenant_end", (q) => q.eq("tenantId", args.tenantId)).collect();
    const now = Date.now();
    const out = [];
    for (const w of rows) {
      const customer = await ctx.db.get(w.customerId);
      if (!customer || !canAccessOwned(membership.role, profile, customer.ownerUserId)) continue;
      const quotation = await ctx.db.get(w.quotationId);
      out.push({
        id: w._id,
        customerName: customer.name,
        quotationNumber: quotation?.officialNumber ?? "",
        sku: w.sku,
        description: w.description,
        quantity: w.quantity,
        months: w.months,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        state: w.endsAt <= now ? ("expired" as const) : w.endsAt - now <= EXPIRING_SOON_DAYS * DAY_MS ? ("expiring" as const) : ("active" as const)
      });
    }
    return out;
  }
});

// ------------------------------------------------------------------ instalments

/**
 * An illustrative repayment schedule for a quotation. No lending policy exists
 * yet, so this is arithmetic for a conversation, never an offer or a contract.
 */
export const previewInstallments = query({
  args: {
    quotationId: v.id("quotations"),
    depositMinor: v.number(),
    termMonths: v.number(),
    annualRateBps: v.number(),
    method: v.union(v.literal("flat"), v.literal("reducing"))
  },
  handler: async (ctx, args) => {
    const { quotation } = await loadOwnedQuotation(ctx, args.quotationId, false);
    const revision = await issuedRevision(ctx, quotation);
    const plan = buildInstallmentPlan({
      priceMinor: revision.totalMinor,
      depositMinor: args.depositMinor,
      termMonths: args.termMonths,
      annualRateBps: args.annualRateBps,
      method: args.method
    });
    return { currency: revision.currency, priceMinor: revision.totalMinor, ...plan };
  }
});

// ------------------------------------------------------------------ manager dashboard

export const dashboard = query({
  args: { tenantId: v.id("tenants"), windowDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, MANAGERS);
    const windowDays = Math.min(Math.max(Math.floor(args.windowDays ?? 30), 1), 365);
    const now = Date.now();
    const since = now - windowDays * DAY_MS;

    const quotations = await ctx.db.query("quotations").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect();
    const byStatus: Record<string, number> = {};
    for (const q of quotations) byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;

    const deals = await ctx.db
      .query("dealOutcomes")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId).gte("decidedAt", since))
      .collect();
    const decided = new Set(
      (await ctx.db.query("dealOutcomes").withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId)).collect()).map((d) => d.quotationId)
    );

    // Open value is the issued, still-valid quotations that nobody has answered yet.
    const openByCurrency: Record<string, number> = {};
    for (const q of quotations) {
      if (q.status !== "officially_issued" || decided.has(q._id)) continue;
      const rev = await issuedRevision(ctx, q);
      openByCurrency[rev.currency] = (openByCurrency[rev.currency] ?? 0) + rev.totalMinor;
    }

    const wonByCurrency: Record<string, number> = {};
    const agents = new Map<string, { won: number; lost: number; wonValue: Record<string, number> }>();
    for (const d of deals) {
      const a = agents.get(d.ownerUserId) ?? { won: 0, lost: 0, wonValue: {} };
      if (d.outcome === "won") {
        a.won++;
        a.wonValue[d.currency] = (a.wonValue[d.currency] ?? 0) + d.totalMinor;
        wonByCurrency[d.currency] = (wonByCurrency[d.currency] ?? 0) + d.totalMinor;
      } else a.lost++;
      agents.set(d.ownerUserId, a);
    }
    const agentNames = await names(ctx, [...agents.keys()] as Id<"userProfiles">[]);
    const won = deals.filter((d) => d.outcome === "won").length;
    const lost = deals.length - won;

    const commissions = await ctx.db.query("commissions").withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId)).collect();
    const commissionOwed: Record<string, Record<string, number>> = {};
    for (const c of commissions) {
      const bucket = (commissionOwed[c.status] ??= {});
      bucket[c.currency] = (bucket[c.currency] ?? 0) + c.amountMinor;
    }

    const installations = await ctx.db.query("installations").withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId)).collect();
    const installationsByStatus: Record<string, number> = {};
    for (const i of installations) installationsByStatus[i.status] = (installationsByStatus[i.status] ?? 0) + 1;

    const expiringWarranties = (
      await ctx.db
        .query("warranties")
        .withIndex("by_tenant_end", (q) => q.eq("tenantId", args.tenantId).gt("endsAt", now).lte("endsAt", now + EXPIRING_SOON_DAYS * DAY_MS))
        .collect()
    ).length;

    return {
      windowDays,
      quotationsByStatus: byStatus,
      openValueByCurrency: openByCurrency,
      won,
      lost,
      // Of the quotations answered in the window, the share that were won.
      winRate: won + lost === 0 ? null : won / (won + lost),
      wonValueByCurrency: wonByCurrency,
      agents: [...agents.entries()]
        .map(([id, a]) => ({ agentName: agentNames.get(id) ?? "Unknown", ...a }))
        .sort((x, y) => y.won - x.won),
      commissionByStatus: commissionOwed,
      installationsByStatus,
      warrantiesExpiringSoon: expiringWarranties
    };
  }
});
