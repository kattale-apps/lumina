import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { loadAssessment } from "./assessments";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { CRM_READERS, CRM_WRITERS, ownedRows, ownerScope } from "./lib/crm";
import { computeLoad, type LoadLine } from "./lib/load";

const MAX_OPERATIONS = 50;
const MAX_SNAPSHOT_ASSESSMENTS = 100;

const ref = v.object({ serverId: v.optional(v.string()), clientId: v.optional(v.string()) });

const operation = v.union(
  v.object({
    opId: v.string(),
    type: v.literal("customer.create"),
    clientId: v.string(),
    payload: v.any()
  }),
  v.object({
    opId: v.string(),
    type: v.literal("site.create"),
    clientId: v.string(),
    customer: ref,
    payload: v.any()
  }),
  v.object({
    opId: v.string(),
    type: v.literal("assessment.create"),
    clientId: v.string(),
    customer: ref,
    site: ref,
    payload: v.optional(v.any())
  }),
  v.object({
    opId: v.string(),
    type: v.literal("assessment.save"),
    assessment: ref,
    baseRevision: v.number(),
    payload: v.any()
  })
);

type Op = typeof operation.type;
export type SyncOutcome = {
  opId: string;
  status: "applied" | "conflict" | "rejected";
  duplicate: boolean;
  id?: string;
  revision?: number;
  conflictId?: string;
  message?: string;
};

function messageOf(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  if (error instanceof Error && error.name === "AuthorizationError") return error.message;
  return "This change could not be applied.";
}

/** Maps a device reference to a server id, using operations already processed for this company. */
async function resolveRef(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  r: { serverId?: string; clientId?: string }
): Promise<string> {
  if (r.serverId) return r.serverId;
  if (!r.clientId) throw new ConvexError("A reference is missing.");
  const made = await ctx.db
    .query("offlineOperations")
    .withIndex("by_tenant_client", (q) => q.eq("tenantId", tenantId).eq("entityClientId", r.clientId))
    .first();
  if (!made || made.status !== "applied" || !made.entityId) {
    throw new ConvexError("This depends on an earlier change that has not been applied.");
  }
  return made.entityId;
}

async function apply(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  profile: Doc<"userProfiles">,
  op: Op
): Promise<Omit<SyncOutcome, "opId" | "duplicate">> {
  switch (op.type) {
    case "customer.create": {
      const { customerId } = await ctx.runMutation(api.customers.createCustomer, { tenantId, ...op.payload });
      return { status: "applied", id: customerId };
    }
    case "site.create": {
      const customerId = (await resolveRef(ctx, tenantId, op.customer)) as Id<"customers">;
      const { siteId } = await ctx.runMutation(api.customers.createSite, { customerId, ...op.payload });
      return { status: "applied", id: siteId };
    }
    case "assessment.create": {
      const customerId = (await resolveRef(ctx, tenantId, op.customer)) as Id<"customers">;
      const siteId = (await resolveRef(ctx, tenantId, op.site)) as Id<"customerSites">;
      const { assessmentId } = await ctx.runMutation(api.assessments.createAssessment, { customerId, siteId });
      return { status: "applied", id: assessmentId, revision: 1 };
    }
    case "assessment.save": {
      const assessmentId = (await resolveRef(ctx, tenantId, op.assessment)) as Id<"assessments">;
      const { assessment } = await loadAssessment(ctx, assessmentId, true);

      const moved = assessment.currentRevision !== op.baseRevision;
      if (moved || assessment.status !== "draft") {
        const reason = moved
          ? "The assessment was changed on the server after this device last synced."
          : "The assessment was completed on the server after this device last synced.";
        const conflictId = await ctx.db.insert("syncConflicts", {
          tenantId,
          opId: op.opId,
          assessmentId,
          ownerUserId: assessment.ownerUserId,
          baseRevision: op.baseRevision,
          serverRevision: assessment.currentRevision,
          reason,
          clientInputs: op.payload,
          status: "open",
          createdAt: Date.now()
        });
        await recordAudit(ctx, profile, {
          tenantId,
          action: "sync.conflict",
          entityType: "assessments",
          entityId: assessmentId,
          summary: "An offline edit conflicted with the server copy and was held for review.",
          metadata: { baseRevision: op.baseRevision, serverRevision: assessment.currentRevision }
        });
        return { status: "conflict", id: assessmentId, conflictId, revision: assessment.currentRevision, message: reason };
      }

      const saved = await ctx.runMutation(api.assessments.saveAssessment, {
        assessmentId,
        expectedRevision: op.baseRevision,
        inputs: op.payload
      });
      return { status: "applied", id: assessmentId, revision: saved.revision };
    }
  }
}

/**
 * Applies operations queued on a device, in order. Each operation is atomic and
 * recorded by its device-generated id, so sending the same batch twice changes
 * nothing. Nothing here completes an assessment or issues a quotation: offline
 * work only ever creates or saves drafts.
 */
export const push = mutation({
  args: { tenantId: v.id("tenants"), operations: v.array(operation) },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, CRM_WRITERS);
    if (args.operations.length > MAX_OPERATIONS) {
      throw new ConvexError(`Send at most ${MAX_OPERATIONS} changes at a time.`);
    }

    const outcomes: SyncOutcome[] = [];
    for (const op of args.operations) {
      if (!op.opId || op.opId.length > 64) {
        outcomes.push({ opId: op.opId.slice(0, 64), status: "rejected", duplicate: false, message: "Invalid change id." });
        continue;
      }
      const seen = await ctx.db
        .query("offlineOperations")
        .withIndex("by_tenant_op", (q) => q.eq("tenantId", args.tenantId).eq("opId", op.opId))
        .first();
      if (seen) {
        if (seen.userId !== profile._id) {
          outcomes.push({ opId: op.opId, status: "rejected", duplicate: false, message: "Invalid change id." });
          continue;
        }
        outcomes.push({
          opId: op.opId,
          status: seen.status,
          duplicate: true,
          id: seen.entityId,
          revision: seen.revision,
          conflictId: seen.conflictId,
          message: seen.message
        });
        continue;
      }

      let result: Omit<SyncOutcome, "opId" | "duplicate">;
      try {
        result = await apply(ctx, args.tenantId, profile, op);
      } catch (error) {
        result = { status: "rejected", message: messageOf(error) };
      }
      await ctx.db.insert("offlineOperations", {
        tenantId: args.tenantId,
        opId: op.opId,
        userId: profile._id,
        type: op.type,
        status: result.status,
        entityClientId: "clientId" in op && result.status === "applied" ? op.clientId : undefined,
        entityId: result.id,
        message: result.message,
        revision: result.revision,
        conflictId: result.conflictId as Id<"syncConflicts"> | undefined,
        createdAt: Date.now()
      });
      outcomes.push({ opId: op.opId, duplicate: false, ...result });
    }
    return { outcomes };
  }
});

/** Everything a device keeps so it can keep working without a connection. */
export const snapshot = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile, membership, tenant } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const scope = await ownerScope(ctx, membership, profile);
    const all = scope.all;

    const customers = await ownedRows(
      scope,
      () => ctx.db.query("customers").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect(),
      (owner) => ctx.db.query("customers").withIndex("by_tenant_owner", (q) => q.eq("tenantId", args.tenantId).eq("ownerUserId", owner)).collect()
    );
    const visible = customers.filter((c) => c.status === "active");

    const sites: Doc<"customerSites">[] = [];
    for (const c of visible) {
      const rows = await ctx.db.query("customerSites").withIndex("by_customer", (q) => q.eq("customerId", c._id)).collect();
      sites.push(...rows.filter((s) => s.status === "active"));
    }

    const appliances = (
      await ctx.db.query("appliances").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect()
    ).filter((a) => a.status === "active");

    const owned = all
      ? await ctx.db.query("assessments").withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId)).collect()
      : await ctx.db
          .query("assessments")
          .withIndex("by_tenant_owner", (q) => q.eq("tenantId", args.tenantId).eq("ownerUserId", profile._id))
          .collect();
    // Only the person's own open drafts are worth carrying; others stay online-only.
    const drafts = owned
      .filter((a) => a.status === "draft" && a.ownerUserId === profile._id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SNAPSHOT_ASSESSMENTS);
    const assessments = [];
    for (const a of drafts) {
      const rev = await ctx.db
        .query("assessmentRevisions")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id).eq("revision", a.currentRevision))
        .unique();
      if (rev) {
        assessments.push({
          id: a._id,
          customerId: a.customerId,
          siteId: a.siteId,
          revision: a.currentRevision,
          inputs: rev.inputs
        });
      }
    }

    return {
      takenAt: Date.now(),
      profileId: profile._id,
      displayName: profile.displayName,
      company: {
        tenantId: tenant._id,
        name: tenant.name,
        defaultCurrency: tenant.defaultCurrency,
        role: membership.role
      },
      customers: visible.map((c) => ({ id: c._id, name: c.name, phone: c.phone, type: c.type })),
      sites: sites.map((s) => ({
        id: s._id,
        customerId: s.customerId,
        name: s.name,
        address: s.address,
        region: s.region,
        gridAvailability: s.gridAvailability
      })),
      appliances: appliances.map((a) => ({
        id: a._id,
        name: a.name,
        category: a.category,
        powerW: a.powerW,
        surgeW: a.surgeW ?? null,
        powerFactor: a.powerFactor ?? null,
        typicalHoursPerDay: a.typicalHoursPerDay,
        currentType: a.currentType
      })),
      assessments
    };
  }
});

function dailyWh(inputs: { lines?: LoadLine[] } | undefined) {
  try {
    return computeLoad(inputs?.lines ?? []).dailyEnergyWh;
  } catch {
    return null;
  }
}

export const listConflicts = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile, membership } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const open = await ctx.db
      .query("syncConflicts")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "open"))
      .collect();

    const scope = await ownerScope(ctx, membership, profile);
    const out = [];
    for (const c of open) {
      if (!scope.can(c.ownerUserId)) continue;
      const assessment = await ctx.db.get(c.assessmentId);
      if (!assessment) continue;
      const customer = await ctx.db.get(assessment.customerId);
      const serverRev = await ctx.db
        .query("assessmentRevisions")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", c.assessmentId).eq("revision", assessment.currentRevision))
        .unique();
      out.push({
        id: c._id,
        assessmentId: c.assessmentId,
        customerName: customer?.name ?? "Unknown customer",
        reason: c.reason,
        serverStatus: assessment.status,
        createdAt: c.createdAt,
        mine: { lines: (c.clientInputs?.lines ?? []).length, dailyEnergyWh: dailyWh(c.clientInputs) },
        server: {
          revision: assessment.currentRevision,
          lines: serverRev?.inputs.lines.length ?? 0,
          dailyEnergyWh: dailyWh(serverRev?.inputs)
        }
      });
    }
    return { conflicts: out.sort((a, b) => b.createdAt - a.createdAt) };
  }
});

/** A person decides what happens to an offline edit that could not be applied automatically. */
export const resolveConflict = mutation({
  args: { conflictId: v.id("syncConflicts"), choice: v.union(v.literal("use_mine"), v.literal("use_server")) },
  handler: async (ctx, args) => {
    const conflict = await ctx.db.get(args.conflictId);
    if (!conflict) throw new ConvexError("Conflict not found.");
    const { assessment, profile } = await loadAssessment(ctx, conflict.assessmentId, true);
    if (conflict.status !== "open") throw new ConvexError("This conflict has already been resolved.");

    if (args.choice === "use_mine") {
      if (assessment.status !== "draft") {
        throw new ConvexError("The assessment is completed on the server. Reopen it first, then use your version.");
      }
      await ctx.runMutation(api.assessments.saveAssessment, {
        assessmentId: assessment._id,
        expectedRevision: assessment.currentRevision,
        inputs: conflict.clientInputs
      });
    }
    await ctx.db.patch(conflict._id, {
      status: args.choice === "use_mine" ? "applied_mine" : "kept_server",
      resolvedAt: Date.now(),
      resolvedBy: profile.authSubject
    });
    await recordAudit(ctx, profile, {
      tenantId: conflict.tenantId,
      action: "sync.conflict_resolved",
      entityType: "assessments",
      entityId: assessment._id,
      summary: args.choice === "use_mine" ? "Offline version applied over the server copy." : "Server copy kept; offline version discarded.",
      metadata: { choice: args.choice, baseRevision: conflict.baseRevision, serverRevision: conflict.serverRevision }
    });
    return { ok: true };
  }
});
