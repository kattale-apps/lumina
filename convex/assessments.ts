import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { canAccessOwned, CRM_READERS, CRM_WRITERS, optionalText, ownedRows, ownerScope } from "./lib/crm";
import { computeLoad, LOAD_ENGINE_VERSION, validateLine } from "./lib/load";
import { requireText, validateCurrency } from "./lib/validation";
import { assessmentInputs } from "./schema";

const MAX_LINES = 100;
type Inputs = Infer<typeof assessmentInputs>;

/** Loads an assessment and checks the caller may see it (and change it, when `write`). */
export async function loadAssessment(
  ctx: QueryCtx | MutationCtx,
  assessmentId: Doc<"assessments">["_id"],
  write: boolean
) {
  const assessment = await ctx.db.get(assessmentId);
  if (!assessment) throw new ConvexError("Assessment not found.");
  const { profile, membership, tenant } = await requireTenantMembership(
    ctx,
    assessment.tenantId,
    write ? CRM_WRITERS : CRM_READERS
  );
  if (!(await canAccessOwned(ctx, membership, profile, assessment.ownerUserId))) {
    throw new ConvexError("Assessment not found.");
  }
  return { assessment, profile, membership, tenant };
}

async function validateInputs(
  ctx: QueryCtx,
  tenant: Doc<"tenants">,
  raw: Inputs
): Promise<Inputs> {
  if (raw.lines.length > MAX_LINES) {
    throw new ConvexError(`An assessment can hold at most ${MAX_LINES} appliances.`);
  }
  if (raw.backupHours !== undefined && !(raw.backupHours >= 0 && raw.backupHours <= 720)) {
    throw new ConvexError("Backup hours must be between 0 and 720.");
  }
  if (raw.autonomyDays !== undefined && !(raw.autonomyDays >= 0 && raw.autonomyDays <= 14)) {
    throw new ConvexError("Autonomy days must be between 0 and 14.");
  }

  let budget = raw.budget;
  if (budget) {
    const currency = validateCurrency(budget.currency);
    if (!tenant.supportedCurrencies.includes(currency)) {
      throw new ConvexError(`${currency} is not a currency this company supports.`);
    }
    if (!Number.isInteger(budget.amountMinor) || budget.amountMinor < 0) {
      throw new ConvexError("Budget must be a non-negative amount.");
    }
    budget = { currency, amountMinor: budget.amountMinor };
  }

  const lines: Inputs["lines"] = [];
  for (const line of raw.lines) {
    const name = requireText(line.name, "Appliance name", 80);
    const problem = validateLine({ ...line, name });
    if (problem) throw new ConvexError(problem);

    let dutyJustification = optionalText(line.dutyJustification, "Duty justification", 300);
    if (line.dutyFactor !== undefined && line.dutyFactor < 1 && !dutyJustification) {
      throw new ConvexError(`${name}: explain why a duty factor below 1 is justified.`);
    }
    if (line.dutyFactor === undefined || line.dutyFactor === 1) dutyJustification = undefined;

    if (line.applianceId) {
      const appliance = await ctx.db.get(line.applianceId);
      if (!appliance || appliance.tenantId !== tenant._id) {
        throw new ConvexError(`${name}: library appliance not found.`);
      }
    }
    lines.push({ ...line, name, dutyJustification });
  }

  return {
    systemType: raw.systemType,
    backupHours: raw.backupHours,
    autonomyDays: raw.autonomyDays,
    criticalCircuits: optionalText(raw.criticalCircuits, "Critical circuits", 500),
    budget,
    notes: optionalText(raw.notes, "Notes", 1000),
    lines
  };
}

const EMPTY_INPUTS: Inputs = { systemType: "off_grid", lines: [] };

/** JSON with sorted keys, so stored and freshly validated inputs compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );
}

export const listAssessments = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const rows = await ownedRows(
      await ownerScope(ctx, membership, profile),
      () => ctx.db.query("assessments").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect(),
      (owner) => ctx.db.query("assessments").withIndex("by_tenant_owner", (q) => q.eq("tenantId", args.tenantId).eq("ownerUserId", owner)).collect()
    );

    const items = [];
    for (const a of rows) {
      const customer = await ctx.db.get(a.customerId);
      const site = await ctx.db.get(a.siteId);
      items.push({
        id: a._id,
        customerName: customer?.name ?? "Unknown customer",
        siteName: site?.name ?? "Unknown site",
        status: a.status,
        currentRevision: a.currentRevision,
        updatedAt: a.updatedAt
      });
    }
    return {
      canWrite: (CRM_WRITERS as readonly string[]).includes(membership.role),
      assessments: items.sort((a, b) => b.updatedAt - a.updatedAt)
    };
  }
});

export const getAssessment = query({
  args: { assessmentId: v.id("assessments"), revision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { assessment, membership } = await loadAssessment(ctx, args.assessmentId, false);
    const revisions = await ctx.db
      .query("assessmentRevisions")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessment._id))
      .collect();
    const wanted = args.revision ?? assessment.currentRevision;
    const shown = revisions.find((r) => r.revision === wanted);
    if (!shown) throw new ConvexError("Revision not found.");

    const customer = await ctx.db.get(assessment.customerId);
    const site = await ctx.db.get(assessment.siteId);
    return {
      canWrite: (CRM_WRITERS as readonly string[]).includes(membership.role),
      assessment: {
        id: assessment._id,
        status: assessment.status,
        currentRevision: assessment.currentRevision,
        customerName: customer?.name ?? "Unknown customer",
        siteName: site?.name ?? "Unknown site",
        gridAvailability: site?.gridAvailability ?? null
      },
      shown: {
        revision: shown.revision,
        isCurrent: shown.revision === assessment.currentRevision,
        inputs: shown.inputs,
        results: shown.results,
        engineVersion: shown.engineVersion,
        createdAt: shown.createdAt
      },
      history: revisions
        .map((r) => ({ revision: r.revision, createdAt: r.createdAt }))
        .sort((a, b) => b.revision - a.revision)
    };
  }
});

export const createAssessment = mutation({
  args: { customerId: v.id("customers"), siteId: v.id("customerSites") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new ConvexError("Customer not found.");
    const { profile, membership } = await requireTenantMembership(
      ctx,
      customer.tenantId,
      CRM_WRITERS
    );
    if (!(await canAccessOwned(ctx, membership, profile, customer.ownerUserId))) {
      throw new ConvexError("Customer not found.");
    }
    const site = await ctx.db.get(args.siteId);
    if (!site || site.customerId !== customer._id) {
      throw new ConvexError("That site does not belong to this customer.");
    }
    if (customer.status !== "active" || site.status !== "active") {
      throw new ConvexError("Archived customers and sites cannot be assessed.");
    }

    const now = Date.now();
    const assessmentId = await ctx.db.insert("assessments", {
      tenantId: customer.tenantId,
      customerId: customer._id,
      siteId: site._id,
      ownerUserId: profile._id,
      status: "draft",
      currentRevision: 1,
      createdAt: now,
      createdBy: profile.authSubject,
      updatedAt: now
    });
    await ctx.db.insert("assessmentRevisions", {
      tenantId: customer.tenantId,
      assessmentId,
      revision: 1,
      inputs: EMPTY_INPUTS,
      results: computeLoad([]),
      engineVersion: LOAD_ENGINE_VERSION,
      createdAt: now,
      createdBy: profile.authSubject
    });
    await recordAudit(ctx, profile, {
      tenantId: customer.tenantId,
      action: "assessment.created",
      entityType: "assessments",
      entityId: assessmentId,
      summary: `Assessment started for ${customer.name} at ${site.name}.`
    });
    return { assessmentId };
  }
});

/**
 * Saves a new revision. `expectedRevision` guards against two people (or two
 * tabs) overwriting each other: a stale save is rejected rather than merged.
 */
export const saveAssessment = mutation({
  args: {
    assessmentId: v.id("assessments"),
    expectedRevision: v.number(),
    inputs: assessmentInputs
  },
  handler: async (ctx, args) => {
    const { assessment, profile, tenant } = await loadAssessment(ctx, args.assessmentId, true);
    if (assessment.status !== "draft") {
      throw new ConvexError("This assessment is completed. Reopen it to make changes.");
    }
    if (assessment.currentRevision !== args.expectedRevision) {
      throw new ConvexError(
        "This assessment was changed elsewhere. Reload it to see the latest revision."
      );
    }

    const inputs = await validateInputs(ctx, tenant, args.inputs);
    const current = await ctx.db
      .query("assessmentRevisions")
      .withIndex("by_assessment", (q) =>
        q.eq("assessmentId", assessment._id).eq("revision", assessment.currentRevision)
      )
      .unique();
    if (current && canonical(current.inputs) === canonical(inputs)) {
      return { revision: assessment.currentRevision, changed: false };
    }

    const revision = assessment.currentRevision + 1;
    const now = Date.now();
    const results = computeLoad(inputs.lines);
    await ctx.db.insert("assessmentRevisions", {
      tenantId: assessment.tenantId,
      assessmentId: assessment._id,
      revision,
      inputs,
      results,
      engineVersion: LOAD_ENGINE_VERSION,
      createdAt: now,
      createdBy: profile.authSubject
    });
    await ctx.db.patch(assessment._id, { currentRevision: revision, updatedAt: now });
    await recordAudit(ctx, profile, {
      tenantId: assessment.tenantId,
      action: "assessment.saved",
      entityType: "assessments",
      entityId: assessment._id,
      summary: `Assessment saved as revision ${revision}.`,
      metadata: { revision, lines: inputs.lines.length, dailyEnergyWh: results.dailyEnergyWh }
    });
    return { revision, changed: true };
  }
});

export const completeAssessment = mutation({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, args) => {
    const { assessment, profile } = await loadAssessment(ctx, args.assessmentId, true);
    if (assessment.status === "completed") return { changed: false };

    const current = await ctx.db
      .query("assessmentRevisions")
      .withIndex("by_assessment", (q) =>
        q.eq("assessmentId", assessment._id).eq("revision", assessment.currentRevision)
      )
      .unique();
    if (!current || current.inputs.lines.length === 0) {
      throw new ConvexError("Add at least one appliance before completing the assessment.");
    }
    const { systemType, backupHours, autonomyDays } = current.inputs;
    if (systemType === "backup_only" && backupHours === undefined) {
      throw new ConvexError("A backup-only system needs the backup hours required.");
    }
    if (systemType === "off_grid" && autonomyDays === undefined) {
      throw new ConvexError("An off-grid system needs the days of autonomy required.");
    }

    await ctx.db.patch(assessment._id, { status: "completed", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: assessment.tenantId,
      action: "assessment.completed",
      entityType: "assessments",
      entityId: assessment._id,
      summary: `Assessment completed at revision ${assessment.currentRevision}.`
    });
    return { changed: true };
  }
});

export const reopenAssessment = mutation({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, args) => {
    const { assessment, profile } = await loadAssessment(ctx, args.assessmentId, true);
    if (assessment.status === "draft") return { changed: false };
    await ctx.db.patch(assessment._id, { status: "draft", updatedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: assessment.tenantId,
      action: "assessment.reopened",
      entityType: "assessments",
      entityId: assessment._id,
      summary: "Assessment reopened for changes."
    });
    return { changed: true };
  }
});
