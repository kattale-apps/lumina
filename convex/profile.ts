import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { findViewerProfile } from "./lib/auth";
import { validatePhone } from "./lib/crm";
import { MAX_IMAGE_BYTES, sniffFile } from "./lib/files";
import { isLang } from "./lib/languages";

/**
 * Every account's own profile: the name to show (and print on certificates), a phone
 * number and a face photo. Staff and customers use the same page.
 */

type Ctx = QueryCtx | MutationCtx;
const HEAD_BYTES = 16;

export async function photoUrlOf(ctx: Ctx, profile: Doc<"userProfiles"> | null) {
  return profile?.photoStorageId ? await ctx.storage.getUrl(profile.photoStorageId) : null;
}

/** A profile counts as set up once the person saved it themselves and added a photo. */
export function profileComplete(profile: Doc<"userProfiles">) {
  return Boolean(profile.profileUpdatedAt && profile.photoStorageId);
}

async function activeViewer(ctx: Ctx) {
  const viewer = await findViewerProfile(ctx);
  return viewer?.profile && viewer.profile.status === "active" ? viewer.profile : null;
}

async function requireViewer(ctx: Ctx) {
  const profile = await activeViewer(ctx);
  if (!profile) throw new ConvexError("Please sign in first.");
  return profile;
}

export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const profile = await activeViewer(ctx);
    if (!profile) return null;
    const account = await ctx.db
      .query("customerAccounts")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .first();
    return {
      displayName: profile.displayName,
      email: profile.email ?? null,
      // Customers gave a phone when they signed up; show it until they set their own.
      phone: profile.phone ?? account?.phone ?? "",
      photoUrl: await photoUrlOf(ctx, profile),
      saved: Boolean(profile.profileUpdatedAt),
      language: profile.language ?? null,
      complete: profileComplete(profile)
    };
  }
});

export const updateProfile = mutation({
  args: { displayName: v.string(), phone: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireViewer(ctx);
    const displayName = args.displayName.trim().replace(/\s+/g, " ");
    if (displayName.length < 2) throw new ConvexError("Enter your full name.");
    if (displayName.length > 80) throw new ConvexError("Your name must be 80 characters or fewer.");
    const phone = args.phone.trim() ? validatePhone(args.phone) : undefined;
    const now = Date.now();
    await ctx.db.patch(profile._id, { displayName, phone, profileUpdatedAt: now, updatedAt: now });
    // Keep a customer account in step, so quote requests use the same details.
    const account = await ctx.db
      .query("customerAccounts")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .first();
    if (account) await ctx.db.patch(account._id, { name: displayName, ...(phone ? { phone } : {}) });
    return { saved: true };
  }
});

/** The language the person reads the public pages and the Academy in. */
export const setLanguage = mutation({
  args: { language: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireViewer(ctx);
    if (!isLang(args.language)) throw new ConvexError("Unknown language.");
    if (profile.language !== args.language) await ctx.db.patch(profile._id, { language: args.language, updatedAt: Date.now() });
    return { language: args.language };
  }
});

/** Step 1 of a photo upload. */
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireViewer(ctx);
    return await ctx.storage.generateUploadUrl();
  }
});

export const viewerForPhoto = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const profile = await requireViewer(ctx);
    const used = await ctx.db
      .query("userProfiles")
      .withIndex("by_photo", (q) => q.eq("photoStorageId", args.storageId))
      .first();
    if (used) throw new ConvexError("That photo is already in use.");
    return profile._id;
  }
});

export const recordPhoto = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const profile = await requireViewer(ctx);
    const old = profile.photoStorageId;
    await ctx.db.patch(profile._id, { photoStorageId: args.storageId, updatedAt: Date.now() });
    if (old && old !== args.storageId) await ctx.storage.delete(old);
  }
});

/** Step 2: checks the upload really is a photo of a sensible size, then makes it the profile photo. */
export const setPhoto = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError(message);
    };
    try {
      await ctx.runQuery(internal.profile.viewerForPhoto, args);
    } catch (error) {
      return await reject(error instanceof ConvexError ? String(error.data) : "Please sign in first.");
    }
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new ConvexError("The upload was not found. Please try again.");
    const sniffed = sniffFile(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()));
    if (!sniffed || sniffed.kind !== "image") return await reject("Use a JPEG, PNG or WebP photo.");
    if (blob.size > MAX_IMAGE_BYTES) return await reject(`Photos can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
    await ctx.runMutation(internal.profile.recordPhoto, args);
    return { ok: true };
  }
});

export const removePhoto = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireViewer(ctx);
    if (!profile.photoStorageId) return { changed: false };
    await ctx.storage.delete(profile.photoStorageId);
    await ctx.db.patch(profile._id, { photoStorageId: undefined, updatedAt: Date.now() });
    return { changed: true };
  }
});
