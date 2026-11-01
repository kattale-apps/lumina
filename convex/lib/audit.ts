import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Records an audit event attributed to the signed-in user. */
export async function recordAudit(
  ctx: MutationCtx,
  actor: Doc<"userProfiles">,
  event: {
    tenantId: Id<"tenants">;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: unknown;
  }
) {
  await ctx.db.insert("auditEvents", {
    ...event,
    actorUserId: actor._id,
    actorSubject: actor.authSubject,
    occurredAt: Date.now()
  });
}
