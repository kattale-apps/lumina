/**
 * Nameplate photos added during the energy check and the upgrade check.
 *
 * The page uploads each photo as soon as it is chosen (camera or gallery), here, without an
 * account, and gets back an id and a secret token. When the request is sent, the photos are
 * attached to it; photos never attached are deleted after a few hours. Each photo keeps what it
 * shows (part + label) and room for details read from it later (`extracted`).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalMutation, type MutationCtx } from "./_generated/server";
import { MAX_IMAGE_BYTES, sniffFile } from "./lib/files";

export const MAX_PHOTOS_PER_REQUEST = 12;
const UNCLAIMED_LIFETIME_MS = 4 * 60 * 60 * 1000;
const MAX_RECENT_UPLOADS = 400;
const RECENT_MS = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

/** What a photo shows, as sent with the request. */
export const photoArg = v.object({
  photoId: v.string(),
  token: v.string(),
  // e.g. "appliance", "inverter", "panels", "batteries", "controller"
  part: v.string(),
  // e.g. "Fridge, Medium", "Inverter"
  label: v.string()
});

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const record = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("requestPhotos")
      .withIndex("by_created", (q) => q.gte("createdAt", now - RECENT_MS))
      .take(MAX_RECENT_UPLOADS);
    if (recent.length >= MAX_RECENT_UPLOADS) {
      await ctx.storage.delete(args.storageId);
      return null;
    }
    const token = newToken();
    const id = await ctx.db.insert("requestPhotos", { storageId: args.storageId, token, part: "", label: "", createdAt: now });
    await ctx.scheduler.runAfter(UNCLAIMED_LIFETIME_MS, internal.requestPhotos.expireIfUnclaimed, { id });
    return { id, token };
  }
});

export const expireIfUnclaimed = internalMutation({
  args: { id: v.id("requestPhotos") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.requestId) return;
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }
});

/** POST a JPEG, PNG or WebP photo (up to 5 MB); answers with its id and secret token. */
export const upload = httpAction(async (ctx, request) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const kind = sniffFile(bytes.subarray(0, 16));
  if (!kind || kind.kind !== "image" || bytes.length > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Send a photo (JPEG, PNG or WebP) of at most 5 MB." }, { status: 400, headers: CORS });
  }
  const storageId = await ctx.storage.store(new Blob([bytes], { type: kind.contentType }));
  const saved = await ctx.runMutation(internal.requestPhotos.record, { storageId });
  if (!saved) return Response.json({ error: "Too many photos right now. Please try again in a few minutes." }, { status: 429, headers: CORS });
  return Response.json({ photoId: saved.id, token: saved.token }, { headers: CORS });
});

export const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

/**
 * Attaches uploaded photos to a request. Photos that are unknown, expired, already used or sent
 * with the wrong token are skipped, so a slow phone never loses the request itself.
 */
export async function attachPhotos(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  requestId: Id<"quoteRequests">,
  photos: (typeof photoArg.type)[] | undefined
) {
  let attached = 0;
  for (const p of (photos ?? []).slice(0, MAX_PHOTOS_PER_REQUEST)) {
    const id = ctx.db.normalizeId("requestPhotos", p.photoId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.requestId || row.token !== p.token) continue;
    await ctx.db.patch(row._id, {
      tenantId,
      requestId,
      part: p.part.trim().slice(0, 40) || "other",
      label: p.label.trim().slice(0, 100) || "Nameplate",
      attachedAt: Date.now()
    });
    attached++;
  }
  return attached;
}
