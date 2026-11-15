import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { canAccessOwned, CRM_READERS, CRM_WRITERS, optionalText, seesAllCustomers } from "./lib/crm";
import { currentCost, priceFrom, resolveMarginRule } from "./lib/pricing";
import {
  assertTransition,
  belowFloor,
  computeTotals,
  EDITABLE,
  needsCommercialApproval,
  TECHNICIAN_CHECKLIST,
  validateLineInputs,
  type QuotationStatus
} from "./lib/quote";
import { buildQuotePdf, type QuotePdfData } from "./lib/quotePdf";
import { activeReserved, getBalance } from "./lib/stock";
import { optionsOf, type UpgradeReport } from "./lib/upgrade";
import { requireText } from "./lib/validation";
import { quotationLine } from "./schema";
import type { Infer } from "convex/values";

type Line = Infer<typeof quotationLine>;
type Ctx = QueryCtx | MutationCtx;

const TECHNICIANS = ["super_admin", "technician"] as const;
const MANAGERS = ["super_admin", "sales_manager"] as const;
const DAY_MS = 86_400_000;
const has = (roles: readonly string[], role: string) => roles.includes(role);

// ------------------------------------------------------------------ helpers

async function loadQuotation(ctx: Ctx, quotationId: Id<"quotations">, write: boolean) {
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

/** Loads a quotation for a role that reviews other people's work (not limited to ownership). */
async function loadForReview(ctx: Ctx, quotationId: Id<"quotations">, roles: readonly string[]) {
  const quotation = await ctx.db.get(quotationId);
  if (!quotation) throw new ConvexError("Quotation not found.");
  const auth = await requireTenantMembership(ctx, quotation.tenantId, roles as never);
  if (quotation.ownerUserId === auth.profile._id) {
    throw new ConvexError("You cannot review or approve your own quotation.");
  }
  return { quotation, ...auth };
}

async function getRevision(ctx: Ctx, quotationId: Id<"quotations">, revision: number) {
  const rev = await ctx.db
    .query("quotationRevisions")
    .withIndex("by_quotation", (q) => q.eq("quotationId", quotationId).eq("revision", revision))
    .unique();
  if (!rev) throw new ConvexError("Revision not found.");
  return rev;
}

/**
 * The technical basis of a quotation and whether it still holds. A quotation is
 * built either on a sizing configuration or on an upgrade study of an existing
 * system. For an upgrade study the one open item is the technician's recorded
 * verification of the ratings that were typed in.
 */
async function sizingState(ctx: Ctx, quotation: Doc<"quotations">) {
  if (quotation.upgradeStudyId) {
    const study = await ctx.db.get(quotation.upgradeStudyId);
    if (!study) throw new ConvexError("The upgrade study for this quotation is missing.");
    const chosen = new Set(quotation.upgradeOptionKeys ?? []);
    const options = optionsOf(study.report as UpgradeReport).filter((o) => chosen.has(o.key));
    const status =
      options.length === 0 || options.some((o) => o.status === "incompatible")
        ? "incompatible"
        : options.some((o) => o.status === "requires_review")
          ? "requires_review"
          : "compatible";
    return {
      basis: "upgrade" as const,
      candidate: { status } as { status: string } | undefined,
      stale: false,
      openReviews: study.verification ? 0 : 1
    };
  }
  const run = quotation.sizingRunId ? await ctx.db.get(quotation.sizingRunId) : null;
  const assessment = quotation.assessmentId ? await ctx.db.get(quotation.assessmentId) : null;
  if (!run || !assessment) throw new ConvexError("The sizing for this quotation is missing.");
  const outcome = run.outcome as {
    candidates: { status: string; checks: { id: string; state: string }[] }[];
  };
  const candidate = outcome.candidates[quotation.candidateIndex ?? -1];
  const resolutions = await ctx.db
    .query("sizingResolutions")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  const openReviews = (candidate?.checks ?? []).filter(
    (c) =>
      c.state === "review" &&
      !resolutions.some((r) => r.candidateIndex === quotation.candidateIndex && r.checkId === c.id)
  ).length;
  return {
    basis: "sizing" as const,
    candidate: candidate as { status: string } | undefined,
    stale: run.assessmentRevision !== assessment.currentRevision,
    openReviews
  };
}

/** Prices a catalogue product now: list and floor from the current cost and margin rule. */
async function priceProduct(ctx: QueryCtx, product: Doc<"products">) {
  const cost = await currentCost(ctx, product._id);
  const resolved = await resolveMarginRule(ctx, product);
  if (!cost || !resolved) {
    throw new ConvexError(`${product.sku} has no price yet: it needs a cost and a margin rule.`);
  }
  return priceFrom(cost, resolved.rule);
}

type LineInput =
  | { kind: "product"; productId: Id<"products">; quantity: number; unitPriceMinor?: number }
  | { kind: "service"; description: string; quantity: number; unitPriceMinor: number };

async function buildLines(ctx: QueryCtx, tenantId: Id<"tenants">, inputs: LineInput[]) {
  const lines: Line[] = [];
  let currency: string | undefined;
  for (const input of inputs) {
    if (input.kind === "service") {
      lines.push({
        kind: "service",
        description: requireText(input.description, "Service description", 120),
        quantity: input.quantity,
        unitListMinor: input.unitPriceMinor,
        unitPriceMinor: input.unitPriceMinor
      });
      continue;
    }
    const product = await ctx.db.get(input.productId);
    if (!product || product.tenantId !== tenantId) throw new ConvexError("Product not found.");
    if (product.status !== "active") throw new ConvexError(`${product.sku} is archived.`);
    const price = await priceProduct(ctx, product);
    if (currency && currency !== price.currency) {
      throw new ConvexError("All products in one quotation must be priced in the same currency.");
    }
    currency = price.currency;
    const unitPriceMinor = input.unitPriceMinor ?? price.listMinor;
    if (unitPriceMinor > price.listMinor) {
      throw new ConvexError(`${product.sku}: the price cannot be above the list price.`);
    }
    lines.push({
      kind: "product",
      productId: product._id,
      sku: product.sku,
      description: product.name,
      quantity: input.quantity,
      unitListMinor: price.listMinor,
      unitPriceMinor,
      floorUnitMinor: price.floorMinor,
      specSchemaVersion: product.specSchemaVersion,
      specValues: product.specValues,
      warrantyMonths: product.warrantyMonths
    });
  }
  if (!currency) throw new ConvexError("Add at least one product.");
  return { lines, currency };
}

function validateTerms(args: { taxBps: number; validityDays: number; customTerms?: string }) {
  if (!Number.isInteger(args.taxBps) || args.taxBps < 0 || args.taxBps > 5000) {
    throw new ConvexError("Tax must be between 0% and 50%.");
  }
  if (!Number.isInteger(args.validityDays) || args.validityDays < 1 || args.validityDays > 90) {
    throw new ConvexError("Validity must be between 1 and 90 days.");
  }
  return optionalText(args.customTerms, "Terms", 1000);
}

async function writeRevision(
  ctx: MutationCtx,
  quotation: Doc<"quotations">,
  revision: number,
  body: {
    lines: Line[];
    currency: string;
    taxBps: number;
    validityDays: number;
    customTerms?: string;
    reason?: string;
    createdBy: string;
  }
) {
  validateLineInputs(body.lines);
  const totals = computeTotals(body.lines, body.taxBps);
  const run = quotation.sizingRunId ? await ctx.db.get(quotation.sizingRunId) : null;
  await ctx.db.insert("quotationRevisions", {
    tenantId: quotation.tenantId,
    quotationId: quotation._id,
    revision,
    currency: body.currency,
    lines: body.lines,
    taxBps: body.taxBps,
    validityDays: body.validityDays,
    customTerms: body.customTerms,
    ...totals,
    requiresCommercialApproval: needsCommercialApproval(body.lines, body.customTerms),
    reason: body.reason,
    assessmentRevision: run?.assessmentRevision ?? 0,
    createdAt: Date.now(),
    createdBy: body.createdBy
  });
}

async function releaseReservations(ctx: MutationCtx, quotation: Doc<"quotations">) {
  const now = Date.now();
  for (const id of quotation.reservationIds ?? []) {
    const hold = await ctx.db.get(id);
    if (hold && hold.status === "active") {
      await ctx.db.patch(id, { status: "released", resolvedAt: now });
    }
  }
}

async function nextNumber(ctx: MutationCtx, tenantId: Id<"tenants">) {
  const seq = await ctx.db
    .query("numberSequences")
    .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId).eq("key", "quotation"))
    .unique();
  const n = seq?.next ?? 1;
  if (seq) await ctx.db.patch(seq._id, { next: n + 1 });
  else await ctx.db.insert("numberSequences", { tenantId, key: "quotation", next: 2 });
  return `Q-${new Date().getUTCFullYear()}-${String(n).padStart(5, "0")}`;
}

const lineInputArg = v.union(
  v.object({
    kind: v.literal("product"),
    productId: v.id("products"),
    quantity: v.number(),
    unitPriceMinor: v.optional(v.number())
  }),
  v.object({
    kind: v.literal("service"),
    description: v.string(),
    quantity: v.number(),
    unitPriceMinor: v.number()
  })
);

// ------------------------------------------------------------------ creating and revising

export const createQuotation = mutation({
  args: {
    sizingRunId: v.id("sizingRuns"),
    candidateIndex: v.number(),
    validityDays: v.optional(v.number()),
    taxBps: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.sizingRunId);
    if (!run) throw new ConvexError("Sizing run not found.");
    const { profile, membership } = await requireTenantMembership(ctx, run.tenantId, CRM_WRITERS);
    const assessment = await ctx.db.get(run.assessmentId);
    if (!assessment || !canAccessOwned(membership.role, profile, assessment.ownerUserId)) {
      throw new ConvexError("Assessment not found.");
    }
    if (run.assessmentRevision !== assessment.currentRevision) {
      throw new ConvexError("The assessment changed after this sizing run. Run sizing again.");
    }
    const candidate = (
      run.outcome as { candidates: { inverterId: string; batteryId: string | null; panelId: string | null; counts: { panels: number; batteries: number } }[] }
    ).candidates[args.candidateIndex];
    if (!candidate) throw new ConvexError("That configuration does not exist.");

    const inputs: LineInput[] = [
      { kind: "product", productId: candidate.inverterId as Id<"products">, quantity: 1 }
    ];
    if (candidate.panelId) {
      inputs.push({ kind: "product", productId: candidate.panelId as Id<"products">, quantity: candidate.counts.panels });
    }
    if (candidate.batteryId) {
      inputs.push({ kind: "product", productId: candidate.batteryId as Id<"products">, quantity: candidate.counts.batteries });
    }

    const taxBps = args.taxBps ?? 0;
    const validityDays = args.validityDays ?? 14;
    validateTerms({ taxBps, validityDays });
    const { lines, currency } = await buildLines(ctx, run.tenantId, inputs);

    const now = Date.now();
    const quotationId = await ctx.db.insert("quotations", {
      tenantId: run.tenantId,
      customerId: assessment.customerId,
      siteId: assessment.siteId,
      assessmentId: assessment._id,
      sizingRunId: run._id,
      candidateIndex: args.candidateIndex,
      ownerUserId: assessment.ownerUserId,
      status: "draft",
      currentRevision: 1,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    const quotation = (await ctx.db.get(quotationId))!;
    await writeRevision(ctx, quotation, 1, {
      lines, currency, taxBps, validityDays, createdBy: profile.authSubject, reason: "Created from sizing"
    });
    await recordAudit(ctx, profile, {
      tenantId: run.tenantId,
      action: "quotation.created",
      entityType: "quotations",
      entityId: quotationId,
      summary: "Quotation created from a sizing configuration."
    });
    return { quotationId };
  }
});

/**
 * Starts a quotation from options chosen on an upgrade study. It then follows
 * the normal workflow: illustrative until a technician has verified the
 * existing system and approved the revision.
 */
export const createFromUpgradeStudy = mutation({
  args: {
    studyId: v.id("upgradeStudies"),
    optionKeys: v.array(v.string()),
    validityDays: v.optional(v.number()),
    taxBps: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const study = await ctx.db.get(args.studyId);
    if (!study) throw new ConvexError("Upgrade study not found.");
    const { profile, membership } = await requireTenantMembership(ctx, study.tenantId, CRM_WRITERS);
    if (!canAccessOwned(membership.role, profile, study.ownerUserId)) {
      throw new ConvexError("Upgrade study not found.");
    }
    const keys = [...new Set(args.optionKeys)];
    if (keys.length === 0) throw new ConvexError("Choose at least one option to quote.");
    const all = new Map(optionsOf(study.report as UpgradeReport).map((o) => [o.key, o]));
    const areas = new Set<string>();
    const inputs: LineInput[] = [];
    for (const key of keys) {
      const option = all.get(key);
      if (!option) throw new ConvexError("That option is not part of this study.");
      if (option.status === "incompatible") throw new ConvexError(`"${option.title}" has a technical blocker.`);
      if (areas.has(option.area)) {
        throw new ConvexError("Choose one option for each part of the system (batteries, panels, inverter, controller).");
      }
      areas.add(option.area);
      if (option.requires && !keys.includes(option.requires)) {
        const partner = all.get(option.requires);
        throw new ConvexError(`"${option.title}" only works together with "${partner?.title ?? "its partner option"}". Choose both.`);
      }
      inputs.push({ kind: "product", productId: option.productId as Id<"products">, quantity: option.quantity });
    }

    const taxBps = args.taxBps ?? 0;
    const validityDays = args.validityDays ?? 14;
    validateTerms({ taxBps, validityDays });
    const { lines, currency } = await buildLines(ctx, study.tenantId, inputs);

    const now = Date.now();
    const quotationId = await ctx.db.insert("quotations", {
      tenantId: study.tenantId,
      customerId: study.customerId,
      siteId: study.siteId,
      upgradeStudyId: study._id,
      upgradeOptionKeys: keys,
      ownerUserId: study.ownerUserId,
      status: "draft",
      currentRevision: 1,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    const quotation = (await ctx.db.get(quotationId))!;
    await writeRevision(ctx, quotation, 1, {
      lines, currency, taxBps, validityDays, createdBy: profile.authSubject, reason: "Created from an upgrade study"
    });
    await recordAudit(ctx, profile, {
      tenantId: study.tenantId,
      action: "quotation.created",
      entityType: "quotations",
      entityId: quotationId,
      summary: "Quotation created from an upgrade study of an existing system.",
      metadata: { upgradeStudyId: study._id, optionKeys: keys }
    });
    return { quotationId };
  }
});

export const reviseQuotation = mutation({
  args: {
    quotationId: v.id("quotations"),
    expectedRevision: v.number(),
    lines: v.array(lineInputArg),
    taxBps: v.number(),
    validityDays: v.number(),
    customTerms: v.optional(v.string()),
    reason: v.string()
  },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadQuotation(ctx, args.quotationId, true);
    const status = quotation.status as QuotationStatus;
    if (!EDITABLE.includes(status)) {
      throw new ConvexError("This quotation can no longer be changed. Withdraw it and start a new one.");
    }
    if (quotation.currentRevision !== args.expectedRevision) {
      throw new ConvexError("This quotation was changed elsewhere. Reload it to see the latest revision.");
    }
    const reason = requireText(args.reason, "Reason for the change", 300);
    const customTerms = validateTerms(args);
    validateLineInputs(
      args.lines.map((l) => ({
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor ?? 0,
        description: l.kind === "service" ? l.description : "Product"
      }))
    );
    const { lines, currency } = await buildLines(ctx, quotation.tenantId, args.lines);

    const revision = quotation.currentRevision + 1;
    await writeRevision(ctx, quotation, revision, {
      lines, currency, taxBps: args.taxBps, validityDays: args.validityDays, customTerms, reason,
      createdBy: profile.authSubject
    });
    // A new revision voids any earlier review: approvals belong to one revision only.
    if (status !== "draft") assertTransition(status, "draft");
    await ctx.db.patch(quotation._id, { currentRevision: revision, status: "draft", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.revised",
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Quotation revised to revision ${revision}: ${reason}`,
      metadata: { revision, previous: quotation.currentRevision, reason }
    });
    return { revision };
  }
});

// ------------------------------------------------------------------ workflow

export const submitForReview = mutation({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadQuotation(ctx, args.quotationId, true);
    assertTransition(quotation.status as QuotationStatus, "submitted_for_technical_review");
    const sizing = await sizingState(ctx, quotation);
    if (sizing.stale) {
      throw new ConvexError("The assessment changed after sizing. Run sizing again and create a new quotation.");
    }
    await ctx.db.patch(quotation._id, { status: "submitted_for_technical_review", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.submitted",
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Revision ${quotation.currentRevision} submitted for technical review.`
    });
    return { ok: true };
  }
});

export const startReview = mutation({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadForReview(ctx, args.quotationId, TECHNICIANS);
    assertTransition(quotation.status as QuotationStatus, "under_technical_review");
    await ctx.db.patch(quotation._id, { status: "under_technical_review", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.review_started",
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Technical review of revision ${quotation.currentRevision} started.`
    });
    return { ok: true };
  }
});

export const decideTechnical = mutation({
  args: {
    quotationId: v.id("quotations"),
    revision: v.number(),
    outcome: v.union(v.literal("approved"), v.literal("revision_required"), v.literal("rejected")),
    checklist: v.array(v.object({ key: v.string(), confirmed: v.boolean() })),
    reason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadForReview(ctx, args.quotationId, TECHNICIANS);
    if (quotation.status !== "under_technical_review") {
      throw new ConvexError("Start the review before deciding.");
    }
    if (args.revision !== quotation.currentRevision) {
      throw new ConvexError("This decision is for an older revision. Reload the quotation.");
    }
    const revision = await getRevision(ctx, quotation._id, args.revision);

    let reason = optionalText(args.reason, "Reason", 500);
    let next: QuotationStatus;
    if (args.outcome === "approved") {
      const confirmed = new Set(args.checklist.filter((c) => c.confirmed).map((c) => c.key));
      const missing = TECHNICIAN_CHECKLIST.filter((c) => !confirmed.has(c.key));
      if (missing.length > 0) {
        throw new ConvexError(`Confirm every checklist item before approving (${missing.length} outstanding).`);
      }
      const sizing = await sizingState(ctx, quotation);
      if (sizing.stale) throw new ConvexError("The assessment changed after sizing, so this cannot be approved.");
      if (!sizing.candidate || sizing.candidate.status === "incompatible") {
        throw new ConvexError("This configuration has a technical blocker.");
      }
      if (sizing.openReviews > 0) {
        throw new ConvexError(
          sizing.basis === "upgrade"
            ? "Record that the existing system's ratings were verified, on the upgrade study, before approving."
            : `${sizing.openReviews} sizing check(s) still need a recorded resolution before this can be approved.`
        );
      }
      next = revision.requiresCommercialApproval ? "pending_commercial_approval" : "ready_for_official_issue";
    } else {
      reason = requireText(reason ?? "", "A reason", 500);
      next = args.outcome === "rejected" ? "rejected" : "revision_required";
    }

    assertTransition("under_technical_review", next);
    await ctx.db.insert("technicalReviews", {
      tenantId: quotation.tenantId,
      quotationId: quotation._id,
      revision: args.revision,
      outcome: args.outcome,
      checklist: args.checklist,
      reason,
      reviewerUserId: profile._id,
      createdAt: Date.now()
    });
    await ctx.db.patch(quotation._id, { status: next, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: `quotation.technical_${args.outcome}`,
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Technical review of revision ${args.revision}: ${args.outcome}.`,
      metadata: { revision: args.revision, reason, next }
    });
    return { status: next };
  }
});

export const decideCommercial = mutation({
  args: {
    quotationId: v.id("quotations"),
    revision: v.number(),
    outcome: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string()
  },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadForReview(ctx, args.quotationId, MANAGERS);
    if (quotation.status !== "pending_commercial_approval") {
      throw new ConvexError("This quotation is not waiting for commercial approval.");
    }
    if (args.revision !== quotation.currentRevision) {
      throw new ConvexError("This decision is for an older revision. Reload the quotation.");
    }
    const reason = requireText(args.reason, "A reason", 500);
    const next: QuotationStatus = args.outcome === "approved" ? "ready_for_official_issue" : "revision_required";
    assertTransition("pending_commercial_approval", next);

    await ctx.db.insert("commercialApprovals", {
      tenantId: quotation.tenantId,
      quotationId: quotation._id,
      revision: args.revision,
      outcome: args.outcome,
      reason,
      approverUserId: profile._id,
      createdAt: Date.now()
    });
    await ctx.db.patch(quotation._id, { status: next, updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: `quotation.commercial_${args.outcome}`,
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Commercial review of revision ${args.revision}: ${args.outcome}.`,
      metadata: { revision: args.revision, reason }
    });
    return { status: next };
  }
});

export const withdrawQuotation = mutation({
  args: { quotationId: v.id("quotations"), reason: v.string() },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadQuotation(ctx, args.quotationId, true);
    const reason = requireText(args.reason, "A reason", 300);
    assertTransition(quotation.status as QuotationStatus, "withdrawn");
    await releaseReservations(ctx, quotation);
    await ctx.db.patch(quotation._id, { status: "withdrawn", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.withdrawn",
      entityType: "quotations",
      entityId: quotation._id,
      summary: "Quotation withdrawn.",
      metadata: { reason }
    });
    return { ok: true };
  }
});

/**
 * Official issue. Every control is re-checked here against the stored records,
 * not against the status field alone, so no path skips an approval.
 */
export const issueQuotation = mutation({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadQuotation(ctx, args.quotationId, true);
    assertTransition(quotation.status as QuotationStatus, "officially_issued");
    const revision = await getRevision(ctx, quotation._id, quotation.currentRevision);

    const reviews = await ctx.db
      .query("technicalReviews")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id).eq("revision", revision.revision))
      .collect();
    if (!reviews.some((r) => r.outcome === "approved")) {
      throw new ConvexError("This exact revision has no technician approval.");
    }
    const commercial = await ctx.db
      .query("commercialApprovals")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id).eq("revision", revision.revision))
      .collect();
    const commerciallyApproved = commercial.some((c) => c.outcome === "approved");
    if (revision.requiresCommercialApproval && !commerciallyApproved) {
      throw new ConvexError("This revision needs a manager's commercial approval.");
    }

    const sizing = await sizingState(ctx, quotation);
    if (sizing.stale || sizing.openReviews > 0 || !sizing.candidate || sizing.candidate.status === "incompatible") {
      throw new ConvexError("The technical basis for this quotation is out of date or unresolved.");
    }

    // Prices and stock are checked now, not as they were when the quote was drafted.
    const now = Date.now();
    const holds: { product: Doc<"products">; warehouse: Id<"warehouses">; quantity: number }[] = [];
    const warehouses = (
      await ctx.db.query("warehouses").withIndex("by_tenant", (q) => q.eq("tenantId", quotation.tenantId)).collect()
    ).filter((w) => w.status === "active");

    for (const line of revision.lines) {
      if (line.kind !== "product" || !line.productId) continue;
      const product = await ctx.db.get(line.productId);
      if (!product || product.status !== "active") {
        throw new ConvexError(`${line.sku} is no longer available. Revise the quotation.`);
      }
      const price = await priceProduct(ctx, product);
      if (price.currency !== revision.currency) {
        throw new ConvexError(`The currency for ${product.sku} has changed. Revise the quotation.`);
      }
      if (line.unitPriceMinor < price.floorMinor && !commerciallyApproved) {
        throw new ConvexError(`The price for ${product.sku} is now below its floor price. Revise the quotation.`);
      }

      let remaining = line.quantity;
      for (const warehouse of warehouses) {
        if (remaining === 0) break;
        const onHand = (await getBalance(ctx, product._id, warehouse._id))?.onHand ?? 0;
        const held = await activeReserved(ctx, product._id, warehouse._id, now);
        const alreadyPlanned = holds
          .filter((h) => h.product._id === product._id && h.warehouse === warehouse._id)
          .reduce((s, h) => s + h.quantity, 0);
        const free = onHand - held - alreadyPlanned;
        if (free <= 0) continue;
        const take = Math.min(free, remaining);
        holds.push({ product, warehouse: warehouse._id, quantity: take });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new ConvexError(`Not enough stock of ${product.sku}: ${remaining} short.`);
      }
    }

    const validUntil = now + revision.validityDays * DAY_MS;
    const reservationIds: Id<"stockReservations">[] = [];
    const officialNumber = await nextNumber(ctx, quotation.tenantId);
    for (const h of holds) {
      reservationIds.push(
        await ctx.db.insert("stockReservations", {
          tenantId: quotation.tenantId,
          productId: h.product._id,
          warehouseId: h.warehouse,
          quantity: h.quantity,
          expiresAt: validUntil,
          status: "active",
          reference: officialNumber,
          createdAt: now,
          createdBy: profile.authSubject
        })
      );
    }

    await ctx.db.patch(quotation._id, {
      status: "officially_issued",
      officialNumber,
      issuedRevision: revision.revision,
      issuedAt: now,
      validUntil,
      reservationIds,
      updatedAt: now
    });
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.issued",
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Quotation ${officialNumber} issued (revision ${revision.revision}).`,
      metadata: { officialNumber, revision: revision.revision, validUntil, reservations: reservationIds.length }
    });
    await ctx.scheduler.runAfter(0, internal.quotations.renderOfficialPdf, {
      quotationId: quotation._id,
      revision: revision.revision
    });
    return { officialNumber };
  }
});

/** Expires issued quotations past their validity and frees the stock they were holding. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    for (const tenant of await ctx.db.query("tenants").collect()) {
      const issued = await ctx.db
        .query("quotations")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenant._id).eq("status", "officially_issued"))
        .collect();
      for (const quotation of issued) {
        if (quotation.validUntil !== undefined && quotation.validUntil <= now) {
          // An accepted quotation stays valid: its goods are held for installation.
          const deal = await ctx.db
            .query("dealOutcomes")
            .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id))
            .unique();
          if (deal?.outcome === "won") continue;
          await releaseReservations(ctx, quotation);
          await ctx.db.patch(quotation._id, { status: "expired", updatedAt: now });
          await ctx.db.insert("auditEvents", {
            tenantId: tenant._id,
            actorSubject: "system",
            action: "quotation.expired",
            entityType: "quotations",
            entityId: quotation._id,
            occurredAt: now,
            summary: `Quotation ${quotation.officialNumber} expired.`
          });
          expired++;
        }
      }
    }
    return { expired };
  }
});

// ------------------------------------------------------------------ PDFs

/** Everything a PDF shows. `official` documents may only be produced for an issued revision. */
async function pdfData(ctx: Ctx, quotation: Doc<"quotations">, revision: Doc<"quotationRevisions">, mode: "illustrative" | "official"): Promise<QuotePdfData> {
  const tenant = await ctx.db.get(quotation.tenantId);
  const customer = await ctx.db.get(quotation.customerId);
  const site = await ctx.db.get(quotation.siteId);
  const notes = [
    quotation.upgradeStudyId
      ? "Based on an upgrade study of the existing system, using the ratings reported for it; suitability is indicative until a technician has verified them."
      : `Based on assessment revision ${revision.assessmentRevision}; system sizing is indicative until a technician has reviewed it.`
  ];
  if (revision.customTerms) notes.push(`Terms: ${revision.customTerms}`);
  if (mode === "illustrative") notes.push("Prices, availability and terms are subject to verification and may change.");
  return {
    mode,
    companyName: tenant?.name ?? "",
    customerName: customer?.name ?? "",
    siteName: site?.name ?? "",
    officialNumber: quotation.officialNumber,
    revision: revision.revision,
    currency: revision.currency,
    lines: revision.lines.map((l) => ({
      description: l.description,
      sku: l.sku,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor
    })),
    subtotalMinor: revision.subtotalMinor,
    taxBps: revision.taxBps,
    taxMinor: revision.taxMinor,
    totalMinor: revision.totalMinor,
    validUntil: mode === "official" ? quotation.validUntil : undefined,
    notes
  };
}

export const illustrativePdfData = internalQuery({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const { quotation } = await loadQuotation(ctx, args.quotationId, false);
    const revision = await getRevision(ctx, quotation._id, quotation.currentRevision);
    return { data: await pdfData(ctx, quotation, revision, "illustrative"), revision: revision.revision };
  }
});

export const attachIllustrative = internalMutation({
  args: { quotationId: v.id("quotations"), revision: v.number(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { quotation, profile } = await loadQuotation(ctx, args.quotationId, false);
    const revision = await getRevision(ctx, quotation._id, args.revision);
    if (revision.illustrativePdf) await ctx.storage.delete(revision.illustrativePdf);
    await ctx.db.patch(revision._id, { illustrativePdf: args.storageId });
    if (quotation.status === "draft" && quotation.currentRevision === args.revision) {
      await ctx.db.patch(quotation._id, { status: "illustrative", updatedAt: Date.now() });
    }
    await recordAudit(ctx, profile, {
      tenantId: quotation.tenantId,
      action: "quotation.illustrative_generated",
      entityType: "quotations",
      entityId: quotation._id,
      summary: `Illustrative PDF generated for revision ${args.revision}.`
    });
  }
});

/** Generates the watermarked, unverified copy an agent can show a customer. */
export const generateIllustrativePdf = action({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const { data, revision }: { data: QuotePdfData; revision: number } = await ctx.runQuery(
      internal.quotations.illustrativePdfData,
      { quotationId: args.quotationId }
    );
    const bytes = await buildQuotePdf(data);
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    await ctx.runMutation(internal.quotations.attachIllustrative, {
      quotationId: args.quotationId,
      revision,
      storageId
    });
    return { url: await ctx.storage.getUrl(storageId) };
  }
});

export const officialPdfData = internalQuery({
  args: { quotationId: v.id("quotations"), revision: v.number() },
  handler: async (ctx, args) => {
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.status === "draft" || quotation.issuedRevision !== args.revision) return null;
    const revision = await getRevision(ctx, quotation._id, args.revision);
    if (revision.officialPdf) return null;
    return await pdfData(ctx, quotation, revision, "official");
  }
});

export const attachOfficial = internalMutation({
  args: { quotationId: v.id("quotations"), revision: v.number(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const revision = await getRevision(ctx, args.quotationId, args.revision);
    // Write once: an issued document is never replaced.
    if (revision.officialPdf) {
      await ctx.storage.delete(args.storageId);
      return;
    }
    await ctx.db.patch(revision._id, { officialPdf: args.storageId });
  }
});

export const renderOfficialPdf = internalAction({
  args: { quotationId: v.id("quotations"), revision: v.number() },
  handler: async (ctx, args) => {
    const data: QuotePdfData | null = await ctx.runQuery(internal.quotations.officialPdfData, args);
    if (!data) return;
    const bytes = await buildQuotePdf(data);
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    await ctx.runMutation(internal.quotations.attachOfficial, { ...args, storageId });
  }
});

// ------------------------------------------------------------------ reading

function effectiveStatus(q: Doc<"quotations">, now: number): QuotationStatus {
  if (q.status === "officially_issued" && q.validUntil !== undefined && q.validUntil <= now) return "expired";
  return q.status as QuotationStatus;
}

export const listQuotations = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const rows = seesAllCustomers(membership.role)
      ? await ctx.db.query("quotations").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect()
      : await ctx.db
          .query("quotations")
          .withIndex("by_tenant_owner", (q) => q.eq("tenantId", args.tenantId).eq("ownerUserId", profile._id))
          .collect();

    const now = Date.now();
    const items = [];
    for (const q of rows) {
      const customer = await ctx.db.get(q.customerId);
      const rev = await getRevision(ctx, q._id, q.currentRevision);
      items.push({
        id: q._id,
        customerName: customer?.name ?? "Unknown customer",
        officialNumber: q.officialNumber ?? null,
        status: effectiveStatus(q, now),
        revision: q.currentRevision,
        currency: rev.currency,
        totalMinor: rev.totalMinor,
        updatedAt: q.updatedAt
      });
    }
    return { quotations: items.sort((a, b) => b.updatedAt - a.updatedAt) };
  }
});

export const getQuotation = query({
  args: { quotationId: v.id("quotations"), revision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { quotation, profile, membership } = await loadQuotation(ctx, args.quotationId, false);
    const now = Date.now();
    const status = effectiveStatus(quotation, now);
    const shown = await getRevision(ctx, quotation._id, args.revision ?? quotation.currentRevision);
    const revisions = await ctx.db
      .query("quotationRevisions")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id))
      .collect();
    const technical = await ctx.db
      .query("technicalReviews")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id))
      .collect();
    const commercial = await ctx.db
      .query("commercialApprovals")
      .withIndex("by_quotation", (q) => q.eq("quotationId", quotation._id))
      .collect();
    const sizing = await sizingState(ctx, quotation);
    const customer = await ctx.db.get(quotation.customerId);
    const site = await ctx.db.get(quotation.siteId);

    const role = membership.role;
    const isOwner = quotation.ownerUserId === profile._id;
    const canWrite = has(CRM_WRITERS, role);
    const current = shown.revision === quotation.currentRevision;
    const idsOf = <T extends { revision: number }>(rows: T[]) => rows.filter((r) => r.revision === shown.revision);

    return {
      quotation: {
        id: quotation._id,
        status,
        statusStored: quotation.status,
        currentRevision: quotation.currentRevision,
        officialNumber: quotation.officialNumber ?? null,
        issuedRevision: quotation.issuedRevision ?? null,
        validUntil: quotation.validUntil ?? null,
        customerName: customer?.name ?? "",
        siteName: site?.name ?? "",
        assessmentId: quotation.assessmentId ?? null,
        upgradeStudyId: quotation.upgradeStudyId ?? null
      },
      shown: {
        revision: shown.revision,
        isCurrent: current,
        currency: shown.currency,
        // The floor price itself never leaves the server; only whether a line is below it.
        lines: shown.lines.map((l) => ({
          kind: l.kind,
          productId: l.productId ?? null,
          sku: l.sku ?? null,
          description: l.description,
          quantity: l.quantity,
          unitListMinor: l.unitListMinor,
          unitPriceMinor: l.unitPriceMinor,
          belowFloor: belowFloor(l)
        })),
        taxBps: shown.taxBps,
        validityDays: shown.validityDays,
        customTerms: shown.customTerms ?? "",
        subtotalMinor: shown.subtotalMinor,
        taxMinor: shown.taxMinor,
        totalMinor: shown.totalMinor,
        requiresCommercialApproval: shown.requiresCommercialApproval,
        reason: shown.reason ?? "",
        createdAt: shown.createdAt,
        illustrativePdfUrl: shown.illustrativePdf ? await ctx.storage.getUrl(shown.illustrativePdf) : null,
        officialPdfUrl: shown.officialPdf ? await ctx.storage.getUrl(shown.officialPdf) : null
      },
      revisions: revisions
        .map((r) => ({ revision: r.revision, createdAt: r.createdAt, reason: r.reason ?? "" }))
        .sort((a, b) => b.revision - a.revision),
      technicalReviews: idsOf(technical).map((r) => ({
        outcome: r.outcome, reason: r.reason ?? "", createdAt: r.createdAt
      })),
      commercialApprovals: idsOf(commercial).map((r) => ({
        outcome: r.outcome, reason: r.reason, createdAt: r.createdAt
      })),
      sizing: {
        basis: sizing.basis,
        stale: sizing.stale,
        openReviews: sizing.openReviews,
        candidateStatus: sizing.candidate?.status ?? null
      },
      checklist: TECHNICIAN_CHECKLIST,
      can: {
        edit: canWrite && current && EDITABLE.includes(status),
        submit: canWrite && status !== "expired" && ["draft", "illustrative"].includes(status),
        startReview: has(TECHNICIANS, role) && !isOwner && status === "submitted_for_technical_review",
        decideTechnical: has(TECHNICIANS, role) && !isOwner && status === "under_technical_review",
        decideCommercial: has(MANAGERS, role) && !isOwner && status === "pending_commercial_approval",
        issue: canWrite && status === "ready_for_official_issue",
        withdraw:
          canWrite &&
          !["rejected", "expired", "withdrawn"].includes(status) &&
          (isOwner || has(MANAGERS, role))
      }
    };
  }
});
