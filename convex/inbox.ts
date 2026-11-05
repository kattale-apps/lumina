import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findViewerProfile } from "./lib/auth";
import { RESPONDERS } from "./responses";

/**
 * Unread counts behind the badge on the app icon.
 *
 * Customers: recommendations sent (or updated) since they last opened My recommendations.
 * Technicians and managers: new quote requests, and customers choosing an option, since they
 * last opened Quote requests.
 */

type Ctx = QueryCtx | MutationCtx;
type Kind = "customer" | "staff";

const MAX_DEVICES_PER_USER = 5;
// Without a "last seen" yet, only recent activity counts, so a first install does not light up with old items.
const FIRST_LOOK_BACK = 7 * 24 * 60 * 60 * 1000;
const CAP = 99;

async function seenAt(ctx: Ctx, userId: Id<"userProfiles">, kind: Kind) {
  const row = await ctx.db
    .query("inboxSeen")
    .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", kind))
    .unique();
  return row?.seenAt ?? Date.now() - FIRST_LOOK_BACK;
}

async function customerUnread(ctx: Ctx, profile: Doc<"userProfiles">) {
  const account = await ctx.db
    .query("customerAccounts")
    .withIndex("by_user", (q) => q.eq("userId", profile._id))
    .first();
  if (!account) return 0;
  const since = await seenAt(ctx, profile._id, "customer");
  const requests = await ctx.db
    .query("quoteRequests")
    .withIndex("by_customer_account", (q) => q.eq("customerAccountId", account._id))
    .order("desc")
    .take(50);
  let count = 0;
  for (const r of requests) {
    const response = await ctx.db
      .query("requestResponses")
      .withIndex("by_request", (q) => q.eq("requestId", r._id))
      .unique();
    if (response?.status === "sent" && (response.sentAt ?? 0) > since) count++;
  }
  return count;
}

async function staffUnread(ctx: Ctx, profile: Doc<"userProfiles">) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", profile._id))
    .collect();
  const tenants = memberships
    .filter((m) => m.status === "active" && (RESPONDERS as readonly string[]).includes(m.role))
    .map((m) => m.tenantId);
  if (tenants.length === 0) return null;
  const since = await seenAt(ctx, profile._id, "staff");
  let count = 0;
  for (const tenantId of tenants) {
    const fresh = await ctx.db
      .query("quoteRequests")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", tenantId).gt("createdAt", since))
      .take(CAP);
    const chosen = await ctx.db
      .query("requestResponses")
      .withIndex("by_tenant_chosen", (q) => q.eq("tenantId", tenantId).gt("chosenAt", since))
      .take(CAP);
    count += fresh.length + chosen.length;
  }
  return count;
}

async function inboxFor(ctx: Ctx, profile: Doc<"userProfiles">) {
  const staff = await staffUnread(ctx, profile);
  const customer = await customerUnread(ctx, profile);
  return {
    isStaff: staff !== null,
    staff: Math.min(staff ?? 0, CAP),
    customer: Math.min(customer, CAP)
  };
}

async function viewer(ctx: Ctx) {
  const found = await findViewerProfile(ctx);
  return found?.profile && found.profile.status === "active" ? found.profile : null;
}

/** Counts for the signed-in person, for the dots in the app's own menus. */
export const myInbox = query({
  args: {},
  handler: async (ctx) => {
    const profile = await viewer(ctx);
    if (!profile) return null;
    return { userId: profile._id, ...(await inboxFor(ctx, profile)) };
  }
});

/** Called when someone opens their messages, which clears the badge. */
export const markSeen = mutation({
  args: { kind: v.union(v.literal("customer"), v.literal("staff")) },
  handler: async (ctx, args) => {
    const profile = await viewer(ctx);
    if (!profile) return { changed: false };
    const row = await ctx.db
      .query("inboxSeen")
      .withIndex("by_user_kind", (q) => q.eq("userId", profile._id).eq("kind", args.kind))
      .unique();
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { seenAt: now });
    else await ctx.db.insert("inboxSeen", { userId: profile._id, kind: args.kind, seenAt: now });
    return { changed: true };
  }
});

export async function hashKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Gives this phone a secret key for background checks for the signed-in person.
 * The key only reveals how many unread messages there are, never their content.
 */
export const registerDevice = mutation({
  args: { previousKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await viewer(ctx);
    if (!profile) throw new ConvexError("Please sign in first.");
    // A phone holds one key: drop the one it had before, whoever it belonged to.
    if (args.previousKey && KEY_PATTERN.test(args.previousKey)) {
      const keyHash = await hashKey(args.previousKey);
      const old = await ctx.db
        .query("appDevices")
        .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
        .unique();
      if (old) await ctx.db.delete(old._id);
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("appDevices", { userId: profile._id, keyHash: await hashKey(key), createdAt: Date.now() });
    const devices = await ctx.db
      .query("appDevices")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .collect();
    for (const d of devices.sort((a, b) => b.createdAt - a.createdAt).slice(MAX_DEVICES_PER_USER)) {
      await ctx.db.delete(d._id);
    }
    return { key, userId: profile._id };
  }
});

/** What the phone's background check shows: a count, a short generic text and the page to open. */
export const forDevice = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("appDevices")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!device) return null;
    const profile = await ctx.db.get(device.userId);
    if (!profile || profile.status !== "active") return null;
    const inbox = await inboxFor(ctx, profile);
    const count = inbox.staff + inbox.customer;
    // Kept generic: the notification can be seen on a locked screen.
    if (inbox.staff > 0) {
      return {
        count,
        title: "Solar Switch",
        body: inbox.staff === 1 ? "1 new update on quote requests" : `${inbox.staff} new updates on quote requests`,
        path: "/dashboard/leads"
      };
    }
    return {
      count,
      title: "Solar Switch",
      body: count === 1 ? "Your solar recommendation is ready" : `${count} recommendations are ready`,
      path: "/my-requests"
    };
  }
});

export { KEY_PATTERN };
