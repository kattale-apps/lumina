import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query
} from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import {
  MAX_DATASHEETS_PER_PRODUCT,
  MAX_IMAGES_PER_PRODUCT,
  cleanFileName,
  maxBytesFor,
  sniffFile,
  type FileKind
} from "./lib/files";
import { PRICING_ADMINS } from "./lib/pricing";

const HEAD_BYTES = 16;

async function loadProduct(
  ctx: Parameters<typeof requireTenantMembership>[0],
  tenantId: Id<"tenants">,
  productId: Id<"products">
) {
  const product = await ctx.db.get(productId);
  if (!product || product.tenantId !== tenantId) throw new ConvexError("Product not found.");
  return product;
}

/** Step 1 of an upload: a short-lived URL the browser can POST the file to. */
export const generateUploadUrl = mutation({
  args: { tenantId: v.id("tenants"), productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);
    await loadProduct(ctx, args.tenantId, args.productId);
    return await ctx.storage.generateUploadUrl();
  }
});

/** Checks, before the file is read, that the caller may attach another file. */
export const authorizeAttach = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storageId: v.id("_storage")
  },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);
    await loadProduct(ctx, args.tenantId, args.productId);
    const used = await ctx.db
      .query("productFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (used) throw new ConvexError("That file is already attached.");
    return true;
  }
});

export const recordFile = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("image"), v.literal("datasheet")),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number()
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, PRICING_ADMINS);
    const product = await loadProduct(ctx, args.tenantId, args.productId);

    const existing = await ctx.db
      .query("productFiles")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    const sameKind = existing.filter((f) => f.kind === args.kind).length;
    const limit = args.kind === "image" ? MAX_IMAGES_PER_PRODUCT : MAX_DATASHEETS_PER_PRODUCT;
    if (sameKind >= limit) {
      throw new ConvexError(
        `A product can have at most ${limit} ${args.kind === "image" ? "images" : "datasheets"}.`
      );
    }
    if (existing.some((f) => f.storageId === args.storageId)) {
      throw new ConvexError("That file is already attached.");
    }

    const fileId = await ctx.db.insert("productFiles", {
      tenantId: args.tenantId,
      productId: product._id,
      storageId: args.storageId,
      kind: args.kind,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      createdAt: Date.now(),
      createdBy: profile.authSubject
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "product.file_added",
      entityType: "products",
      entityId: product._id,
      summary: `${args.kind === "image" ? "Image" : "Datasheet"} "${args.fileName}" added to ${product.sku}.`,
      metadata: { after: { fileId, kind: args.kind, size: args.size, contentType: args.contentType } }
    });
    return fileId;
  }
});

/** Step 2 of an upload: verifies the stored bytes really are an allowed file, then attaches it. */
export const attachFile = action({
  args: {
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storageId: v.id("_storage"),
    fileName: v.string()
  },
  handler: async (ctx, args): Promise<{ fileId: Id<"productFiles">; kind: FileKind }> => {
    // Authorisation first, so a stranger cannot make us read or delete anything.
    await ctx.runQuery(internal.files.authorizeAttach, {
      tenantId: args.tenantId,
      productId: args.productId,
      storageId: args.storageId
    });

    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError(message);
    };

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new ConvexError("The upload was not found. Please try again.");

    const sniffed = sniffFile(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()));
    if (!sniffed) return await reject("Only PNG, JPEG and WebP images and PDF datasheets are allowed.");
    if (blob.size > maxBytesFor(sniffed.kind)) {
      const mb = maxBytesFor(sniffed.kind) / (1024 * 1024);
      return await reject(`${sniffed.kind === "image" ? "Images" : "Datasheets"} can be at most ${mb} MB.`);
    }

    let fileName: string;
    try {
      fileName = cleanFileName(args.fileName);
    } catch (error) {
      return await reject(error instanceof ConvexError ? String(error.data) : "Invalid file name.");
    }

    try {
      const fileId: Id<"productFiles"> = await ctx.runMutation(internal.files.recordFile, {
        tenantId: args.tenantId,
        productId: args.productId,
        storageId: args.storageId,
        kind: sniffed.kind,
        fileName,
        contentType: sniffed.contentType,
        size: blob.size
      });
      return { fileId, kind: sniffed.kind };
    } catch (error) {
      // Over the per-product limit or similar: do not leave an orphan behind.
      await ctx.storage.delete(args.storageId);
      throw error;
    }
  }
});

/** Files for one product. Any member of the company may view them. */
export const listFiles = query({
  args: { tenantId: v.id("tenants"), productId: v.id("products") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const admin = (PRICING_ADMINS as readonly string[]).includes(membership.role);
    if (!admin && product.status !== "active") return [];

    const files = await ctx.db
      .query("productFiles")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();

    const out = [];
    for (const file of files) {
      out.push({
        id: file._id,
        kind: file.kind,
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
        url: await ctx.storage.getUrl(file.storageId)
      });
    }
    return out.sort((a, b) =>
      a.kind === b.kind ? a.fileName.localeCompare(b.fileName) : a.kind === "image" ? -1 : 1
    );
  }
});

export const removeFile = mutation({
  args: { fileId: v.id("productFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new ConvexError("File not found.");
    const { profile } = await requireTenantMembership(ctx, file.tenantId, PRICING_ADMINS);
    const product = await ctx.db.get(file.productId);

    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
    await recordAudit(ctx, profile, {
      tenantId: file.tenantId,
      action: "product.file_removed",
      entityType: "products",
      entityId: file.productId,
      summary: `${file.kind === "image" ? "Image" : "Datasheet"} "${file.fileName}" removed from ${product?.sku ?? "product"}.`,
      metadata: { before: { kind: file.kind, fileName: file.fileName, size: file.size } }
    });
    return { removed: true };
  }
});
