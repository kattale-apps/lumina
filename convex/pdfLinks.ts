/**
 * Short-lived download links for PDFs made in the browser.
 *
 * Most devices save a PDF straight from the page. Some cannot: older builds of the Android app,
 * the browsers inside WhatsApp, Facebook and Instagram, and iPhone home-screen apps. For those, the
 * page uploads the PDF here and gets a private link that opens or downloads it like any web file.
 * Links work for LINK_LIFETIME_MS and the file is then deleted.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";

export const LINK_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
// A ceiling on links made in ten minutes, so the upload cannot be used as free file hosting.
const MAX_RECENT_LINKS = 300;
const RECENT_MS = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Filename",
  "Access-Control-Max-Age": "86400"
};

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keeps file names plain so they are safe in a download header: "Energy report.pdf" -> "energy-report.pdf". */
export function safePdfName(raw: string | null) {
  const base = (raw ?? "")
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "document"}.pdf`;
}

export const record = internalMutation({
  args: { storageId: v.id("_storage"), filename: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("pdfLinks")
      .withIndex("by_created", (q) => q.gte("createdAt", now - RECENT_MS))
      .take(MAX_RECENT_LINKS);
    if (recent.length >= MAX_RECENT_LINKS) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("busy");
    }
    const token = newToken();
    const id = await ctx.db.insert("pdfLinks", { storageId: args.storageId, filename: args.filename, token, createdAt: now, expiresAt: now + LINK_LIFETIME_MS });
    await ctx.scheduler.runAfter(LINK_LIFETIME_MS, internal.pdfLinks.expire, { id });
    return { id, token };
  }
});

export const find = internalQuery({
  args: { id: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("pdfLinks", args.id);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.token !== args.token || row.expiresAt < Date.now()) return null;
    return { storageId: row.storageId, filename: row.filename };
  }
});

export const expire = internalMutation({
  args: { id: v.id("pdfLinks") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }
});

/** POST the PDF bytes (with an X-Filename header); answers with a link that opens it. */
export const upload = httpAction(async (ctx, request) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const isPdf = bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  if (!isPdf || bytes.length > MAX_PDF_BYTES) {
    return Response.json({ error: "Send a PDF of at most 8 MB." }, { status: 400, headers: CORS });
  }
  const filename = safePdfName(request.headers.get("X-Filename"));
  const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
  try {
    const { id, token } = await ctx.runMutation(internal.pdfLinks.record, { storageId, filename });
    const url = `${new URL(request.url).origin}/pdf-link?id=${id}&k=${token}`;
    return Response.json({ url, expiresInMinutes: LINK_LIFETIME_MS / 60000 }, { headers: CORS });
  } catch {
    return Response.json({ error: "Too many PDFs right now. Please try again in a few minutes." }, { status: 429, headers: CORS });
  }
});

export const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

/** Opens a PDF uploaded above. The browser downloads it under its own name. */
export const download = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const found = await ctx.runQuery(internal.pdfLinks.find, { id: params.get("id") ?? "", token: params.get("k") ?? "" });
  const blob = found ? await ctx.storage.get(found.storageId) : null;
  if (!found || !blob) {
    return new Response("This PDF link has expired. Go back and download the PDF again.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(blob, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${found.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
