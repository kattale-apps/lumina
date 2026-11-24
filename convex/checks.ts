/**
 * A record of every public check (energy, upgrade, budget) for the sales log, and whether the
 * person then sent a request. The check itself runs in a query or action, which cannot write,
 * so the page logs it right after showing the results.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { publicCompany } from "./estimator";
import { findViewerProfile } from "./lib/auth";

const HOUR = 60 * 60 * 1000;
/** Everyone together; keeps a runaway script from filling the log. */
const MAX_CHECKS_PER_HOUR = 3000;
const MAX_SUMMARY = 300;

export const logCheck = mutation({
  args: {
    kind: v.union(v.literal("energy"), v.literal("upgrade"), v.literal("budget")),
    summary: v.string()
  },
  handler: async (ctx, args): Promise<{ checkId: Id<"publicChecks"> | null }> => {
    const company = await publicCompany(ctx);
    if (!company) return { checkId: null };
    const summary = args.summary.trim().slice(0, MAX_SUMMARY);
    if (!summary) throw new ConvexError("Nothing to record.");
    const now = Date.now();
    const recent = await ctx.db
      .query("publicChecks")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", company.tenant._id).gte("createdAt", now - HOUR))
      .take(MAX_CHECKS_PER_HOUR);
    if (recent.length >= MAX_CHECKS_PER_HOUR) return { checkId: null };
    const viewer = await findViewerProfile(ctx);
    const checkId = await ctx.db.insert("publicChecks", {
      tenantId: company.tenant._id,
      kind: args.kind,
      summary,
      userId: viewer?.profile?._id,
      createdAt: now
    });
    return { checkId };
  }
});

/** Marks a check as having led to a request (once; a later request does not move it). */
export async function linkCheck(ctx: MutationCtx, checkId: Id<"publicChecks">, requestId: Id<"quoteRequests">) {
  const check = await ctx.db.get(checkId);
  if (check && !check.requestId) await ctx.db.patch(check._id, { requestId });
}
