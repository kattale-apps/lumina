/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { cleanFileName, sniffFile } from "./lib/files";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

function bytes(header: number[], size = 64) {
  const data = new Uint8Array(Math.max(size, header.length));
  data.set(header);
  return data;
}

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active",
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const agent = await registerUser(t, "agent@acme.ug");
  await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "agent@acme.ug", role: "sales_agent" });

  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const panel = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories.find((c) => c.key === "pv_panel")!;
  const specs = { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 };
  const { productId } = await asOwner.mutation(api.products.createProduct, {
    tenantId, categoryId: panel.id, name: "Panel", brand: "B", model: "M", sku: "PV-1", specValues: specs
  });

  const store = (data: Uint8Array) => t.run((ctx) => ctx.storage.store(new Blob([data as BlobPart])));
  const stored = (id: Awaited<ReturnType<typeof store>>) =>
    t.run((ctx) => ctx.storage.getUrl(id));
  const attach = (data: Uint8Array, fileName = "file.bin", who = asOwner, pid = productId, tid = tenantId) =>
    store(data).then(async (storageId) => ({
      storageId,
      result: await who.action(api.files.attachFile, { tenantId: tid, productId: pid, storageId, fileName })
    }));
  const attachRaw = async (data: Uint8Array, fileName = "file.bin", who = asOwner) => {
    const storageId = await store(data);
    return {
      storageId,
      run: () => who.action(api.files.attachFile, { tenantId, productId, storageId, fileName })
    };
  };
  return {
    t, tenantId, productId, asOwner, specs, panel, store, stored, attach, attachRaw,
    asAgent: t.withIdentity({ subject: agent.subject })
  };
}

describe("file type detection", () => {
  test("recognises PNG, JPEG, WebP and PDF by their bytes", () => {
    expect(sniffFile(bytes(PNG))).toEqual({ kind: "image", contentType: "image/png" });
    expect(sniffFile(bytes(JPEG))).toEqual({ kind: "image", contentType: "image/jpeg" });
    expect(sniffFile(bytes(WEBP))).toEqual({ kind: "image", contentType: "image/webp" });
    expect(sniffFile(bytes(PDF))).toEqual({ kind: "datasheet", contentType: "application/pdf" });
  });

  test("rejects everything else, however it is named", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(sniffFile(html)).toBeNull();
    expect(sniffFile(new Uint8Array(0))).toBeNull();
    expect(sniffFile(bytes([0x4d, 0x5a, 0x90]))).toBeNull(); // Windows executable
    expect(sniffFile(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // WAV, not WebP
    expect(sniffFile(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // truncated PNG signature
  });

  test("cleans file names", () => {
    expect(cleanFileName("C:\\Users\\me\\panel.png")).toBe("panel.png");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("  my \t datasheet\u0000.pdf ")).toBe("my datasheet.pdf");
    expect(cleanFileName("x".repeat(300)).length).toBe(120);
    expect(() => cleanFileName("   ")).toThrow(/needs a name/);
    expect(() => cleanFileName("folder/")).toThrow(/needs a name/);
  });
});

describe("attaching files", () => {
  test("attaches an image and a datasheet, naming the kind from the bytes not the name", async () => {
    const c = await setup();
    const img = await c.attach(bytes(PNG), "front.jpg"); // wrong extension on purpose
    const pdf = await c.attach(bytes(PDF), "spec.pdf");
    expect(img.result.kind).toBe("image");
    expect(pdf.result.kind).toBe("datasheet");

    const files = await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId });
    expect(files.map((f) => [f.kind, f.fileName, f.contentType])).toEqual([
      ["image", "front.jpg", "image/png"],
      ["datasheet", "spec.pdf", "application/pdf"]
    ]);
    expect(files.every((f) => typeof f.url === "string")).toBe(true);

    const actions = (await c.t.run((ctx) => ctx.db.query("auditEvents").collect())).map((e) => e.action);
    expect(actions.filter((a) => a === "product.file_added")).toHaveLength(2);
  });

  test("rejects disguised files and deletes the upload", async () => {
    const c = await setup();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const { storageId, run } = await c.attachRaw(html, "logo.png");
    await expect(run()).rejects.toThrow(/Only PNG, JPEG and WebP/);
    expect(await c.stored(storageId)).toBeNull();
    expect(await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toEqual([]);
  });

  test("enforces size limits per kind", async () => {
    const c = await setup();
    const big = await c.attachRaw(bytes(PNG, 5 * 1024 * 1024 + 1), "huge.png");
    await expect(big.run()).rejects.toThrow(/at most 5 MB/);
    expect(await c.stored(big.storageId)).toBeNull();

    // Exactly at the limit is fine.
    const ok = await c.attach(bytes(PNG, 5 * 1024 * 1024), "max.png");
    expect(ok.result.kind).toBe("image");
  });

  test("limits files per product and cleans up the extra upload", async () => {
    const c = await setup();
    for (let i = 0; i < 8; i++) await c.attach(bytes(JPEG), `p${i}.jpg`);
    const extra = await c.attachRaw(bytes(JPEG), "p9.jpg");
    await expect(extra.run()).rejects.toThrow(/at most 8 images/);
    expect(await c.stored(extra.storageId)).toBeNull();
    // Datasheets have their own allowance.
    expect((await c.attach(bytes(PDF), "d.pdf")).result.kind).toBe("datasheet");
  });

  test("a file cannot be attached twice", async () => {
    const c = await setup();
    const { storageId } = await c.attach(bytes(PNG), "a.png");
    await expect(
      c.asOwner.action(api.files.attachFile, { tenantId: c.tenantId, productId: c.productId, storageId, fileName: "b.png" })
    ).rejects.toThrow(/already attached/);
    // The original is untouched by the failed attempt.
    expect(await c.stored(storageId)).not.toBeNull();
    expect(await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toHaveLength(1);
  });

  test("another company cannot attach or destroy a file it does not own", async () => {
    const c = await setup();
    const { storageId } = await c.attach(bytes(PNG), "a.png");

    const rival = await registerUser(c.t, "rival@other.ug");
    const { tenantId: otherTenant } = await c.t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    const asRival = c.t.withIdentity({ subject: rival.subject });

    await expect(
      asRival.action(api.files.attachFile, { tenantId: c.tenantId, productId: c.productId, storageId, fileName: "x.png" })
    ).rejects.toThrow(/access/);
    await expect(
      asRival.action(api.files.attachFile, { tenantId: otherTenant, productId: c.productId, storageId, fileName: "x.png" })
    ).rejects.toThrow(/Product not found/);
    expect(await c.stored(storageId)).not.toBeNull();
    await expect(asRival.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).rejects.toThrow(/access/);
  });
});

describe("file permissions", () => {
  test("only pricing administrators can upload, attach or remove", async () => {
    const c = await setup();
    const { storageId } = await c.attach(bytes(PNG), "a.png");
    const [file] = await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId });

    await expect(c.asAgent.mutation(api.files.generateUploadUrl, { tenantId: c.tenantId, productId: c.productId })).rejects.toThrow(/role does not permit/);
    const extra = await c.attachRaw(bytes(PNG), "b.png", c.asAgent);
    await expect(extra.run()).rejects.toThrow(/role does not permit/);
    expect(await c.stored(extra.storageId)).not.toBeNull(); // unauthorised callers never trigger deletion
    await expect(c.asAgent.mutation(api.files.removeFile, { fileId: file.id })).rejects.toThrow(/role does not permit/);
    expect(await c.stored(storageId)).not.toBeNull();

    expect(typeof (await c.asOwner.mutation(api.files.generateUploadUrl, { tenantId: c.tenantId, productId: c.productId }))).toBe("string");
  });

  test("agents can view files of active products only", async () => {
    const c = await setup();
    await c.attach(bytes(PNG), "a.png");
    expect(await c.asAgent.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toHaveLength(1);

    await c.asOwner.mutation(api.products.updateProduct, {
      productId: c.productId, name: "Panel", brand: "B", model: "M", sku: "PV-1", specValues: c.specs, status: "archived"
    });
    expect(await c.asAgent.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toEqual([]);
    expect(await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toHaveLength(1);
  });

  test("removing a file deletes the stored copy and audits it", async () => {
    const c = await setup();
    const { storageId } = await c.attach(bytes(PDF), "spec.pdf");
    const [file] = await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId });

    await c.asOwner.mutation(api.files.removeFile, { fileId: file.id });
    expect(await c.stored(storageId)).toBeNull();
    expect(await c.asOwner.query(api.files.listFiles, { tenantId: c.tenantId, productId: c.productId })).toEqual([]);
    const actions = (await c.t.run((ctx) => ctx.db.query("auditEvents").collect())).map((e) => e.action);
    expect(actions).toContain("product.file_removed");
    await expect(c.asOwner.mutation(api.files.removeFile, { fileId: file.id })).rejects.toThrow(/not found/);
  });
});
