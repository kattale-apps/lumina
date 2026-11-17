import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { loadAssessment } from "./assessments";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { CRM_WRITERS } from "./lib/crm";
import {
  buildCandidates,
  computeRequirements,
  SIZING_ENGINE_VERSION,
  validateAssumptions,
  type CatalogueItem,
  type SystemType
} from "./lib/sizing";
import { withSafeEstimates } from "./lib/specEstimate";
import { requireText } from "./lib/validation";

/** Only technicians (and the company owner) may clear checks that need review. */
const TECHNICIAN_ROLES = ["super_admin", "technician"] as const;

const assumptionsArg = v.object({
  peakSunHours: v.number(),
  solarResourceSource: v.string(),
  performanceRatio: v.number(),
  defaultDod: v.number(),
  dischargeEfficiency: v.number(),
  roundTripEfficiency: v.number(),
  inverterEfficiency: v.number(),
  inverterHeadroom: v.number(),
  minCellTempC: v.number(),
  maxCellTempC: v.number(),
  gridTiedOffset: v.number()
});

export const runSizing = mutation({
  args: { assessmentId: v.id("assessments"), assumptions: assumptionsArg },
  handler: async (ctx, args) => {
    const { assessment, profile } = await loadAssessment(ctx, args.assessmentId, false);
    if (assessment.status !== "completed") {
      throw new ConvexError("Complete the assessment before sizing a system.");
    }
    const assumptions = {
      ...args.assumptions,
      solarResourceSource: requireText(args.assumptions.solarResourceSource, "Solar resource source", 200)
    };
    const problem = validateAssumptions(assumptions);
    if (problem) throw new ConvexError(problem);

    const revision = await ctx.db
      .query("assessmentRevisions")
      .withIndex("by_assessment", (q) =>
        q.eq("assessmentId", assessment._id).eq("revision", assessment.currentRevision)
      )
      .unique();
    if (!revision) throw new ConvexError("Assessment revision not found.");

    const categories = await ctx.db
      .query("productCategories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", assessment.tenantId))
      .collect();
    const keyOf = new Map(categories.map((c) => [c._id, c.key]));
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", assessment.tenantId))
      .collect();
    const catalogue: CatalogueItem[] = withSafeEstimates(products
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p._id,
        sku: p.sku,
        name: p.name,
        categoryKey: keyOf.get(p.categoryId) ?? "",
        specSchemaVersion: p.specSchemaVersion,
        specValues: p.specValues
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)));

    const inputs = {
      systemType: revision.inputs.systemType as SystemType,
      backupHours: revision.inputs.backupHours,
      autonomyDays: revision.inputs.autonomyDays,
      lines: revision.inputs.lines
    };
    const requirements = computeRequirements(inputs, assumptions);
    const outcome = buildCandidates(inputs, requirements, assumptions, catalogue);

    const used = new Set<string>();
    for (const c of outcome.candidates) {
      used.add(c.inverterId);
      if (c.batteryId) used.add(c.batteryId);
      if (c.panelId) used.add(c.panelId);
    }
    for (const r of outcome.rejected) {
      used.add(r.inverterId);
      if (r.batteryId) used.add(r.batteryId);
      if (r.panelId) used.add(r.panelId);
    }
    const productSnapshots = catalogue.filter((c) => used.has(c.id));

    const now = Date.now();
    const runId = await ctx.db.insert("sizingRuns", {
      tenantId: assessment.tenantId,
      assessmentId: assessment._id,
      assessmentRevision: assessment.currentRevision,
      assumptions,
      engineVersion: SIZING_ENGINE_VERSION,
      requirements,
      outcome,
      productSnapshots,
      createdAt: now,
      createdBy: profile.authSubject,
      actorUserId: profile._id
    });
    await recordAudit(ctx, profile, {
      tenantId: assessment.tenantId,
      action: "sizing.run",
      entityType: "sizingRuns",
      entityId: runId,
      summary: `Sizing run for assessment revision ${assessment.currentRevision}: ${outcome.status}.`,
      metadata: { candidates: outcome.candidates.length, engineVersion: SIZING_ENGINE_VERSION }
    });
    return { runId, status: outcome.status };
  }
});

export const getSizing = query({
  args: { assessmentId: v.id("assessments"), runId: v.optional(v.id("sizingRuns")) },
  handler: async (ctx, args) => {
    const { assessment, membership } = await loadAssessment(ctx, args.assessmentId, false);
    const runs = await ctx.db
      .query("sizingRuns")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessment._id))
      .collect();
    runs.sort((a, b) => b.createdAt - a.createdAt);

    const shown = args.runId ? runs.find((r) => r._id === args.runId) : runs[0];
    if (args.runId && !shown) throw new ConvexError("Sizing run not found.");

    const resolutions = shown
      ? await ctx.db
          .query("sizingResolutions")
          .withIndex("by_run", (q) => q.eq("runId", shown._id))
          .collect()
      : [];

    return {
      assessmentStatus: assessment.status,
      currentRevision: assessment.currentRevision,
      canResolve: (TECHNICIAN_ROLES as readonly string[]).includes(membership.role),
      canQuote: (CRM_WRITERS as readonly string[]).includes(membership.role),
      runs: runs.map((r) => ({
        id: r._id,
        createdAt: r.createdAt,
        assessmentRevision: r.assessmentRevision,
        status: (r.outcome as { status: string }).status
      })),
      run: shown
        ? {
            id: shown._id,
            assessmentRevision: shown.assessmentRevision,
            stale: shown.assessmentRevision !== assessment.currentRevision,
            engineVersion: shown.engineVersion,
            createdAt: shown.createdAt,
            assumptions: shown.assumptions,
            requirements: shown.requirements,
            outcome: shown.outcome,
            products: shown.productSnapshots as CatalogueItem[],
            resolutions: resolutions.map((r) => ({
              candidateIndex: r.candidateIndex,
              checkId: r.checkId,
              note: r.note,
              createdAt: r.createdAt
            }))
          }
        : null
    };
  }
});

export const resolveCheck = mutation({
  args: {
    runId: v.id("sizingRuns"),
    candidateIndex: v.number(),
    checkId: v.string(),
    note: v.string()
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("Sizing run not found.");
    const { profile } = await requireTenantMembership(ctx, run.tenantId, TECHNICIAN_ROLES);

    const candidate = (run.outcome as { candidates: { checks: { id: string; state: string }[] }[] })
      .candidates[args.candidateIndex];
    const check = candidate?.checks.find((c) => c.id === args.checkId);
    if (!check) throw new ConvexError("That check does not exist on this configuration.");
    if (check.state !== "review") throw new ConvexError("Only checks that need review can be resolved.");

    const existing = await ctx.db
      .query("sizingResolutions")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    if (existing.some((r) => r.candidateIndex === args.candidateIndex && r.checkId === args.checkId)) {
      throw new ConvexError("This check has already been resolved.");
    }

    const note = requireText(args.note, "Resolution note", 500);
    await ctx.db.insert("sizingResolutions", {
      tenantId: run.tenantId,
      runId: run._id,
      candidateIndex: args.candidateIndex,
      checkId: args.checkId,
      note,
      createdAt: Date.now(),
      createdBy: profile.authSubject,
      actorUserId: profile._id
    });
    await recordAudit(ctx, profile, {
      tenantId: run.tenantId,
      action: "sizing.check_resolved",
      entityType: "sizingRuns",
      entityId: run._id,
      summary: `Check "${args.checkId}" resolved on configuration ${args.candidateIndex + 1}.`,
      metadata: { note }
    });
    return { ok: true };
  }
});

