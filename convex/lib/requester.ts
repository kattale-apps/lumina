import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { validatePhone } from "./crm";
import { requireText } from "./validation";

/**
 * The customer account a signed-in person's energy check or upgrade request belongs to.
 *
 * Anyone signed in may ask for a recommendation, staff included (a technician can ask, and another
 * technician answers). Someone signed in without a customer account yet (usually staff) gets one
 * here from the name and phone they typed, so the recommendation reaches them under
 * "My recommendations" like any customer's. Returns null when nobody is signed in.
 */
export async function requesterAccount(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  profile: Doc<"userProfiles"> | null,
  typed: { name?: string; phone?: string }
): Promise<Doc<"customerAccounts"> | null> {
  if (!profile) return null;
  const existing = await ctx.db
    .query("customerAccounts")
    .withIndex("by_user", (q) => q.eq("userId", profile._id))
    .first();
  if (existing) return existing.tenantId === tenantId ? existing : null;

  const name = requireText(typed.name ?? profile.displayName ?? "", "Name", 100);
  if (!typed.phone?.trim()) throw new ConvexError("Enter your phone number so we can reach you about your recommendation.");
  const phone = validatePhone(typed.phone);
  const id = await ctx.db.insert("customerAccounts", { tenantId, userId: profile._id, name, phone, createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}
