/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { safePdfName } from "./pdfLinks";

const modules = import.meta.glob("./**/*.*s");
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF");

afterEach(() => vi.useRealTimers());

describe("PDF links for devices that cannot save from the page", () => {
  test("a PDF gets a private link that downloads it under its own name, for one hour", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const res = await t.fetch("/pdf-link", { method: "POST", headers: { "Content-Type": "application/pdf", "X-Filename": "Energy usage estimate.pdf" }, body: PDF });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const { url } = (await res.json()) as { url: string };
    const path = url.slice(url.indexOf("/pdf-link"));
    expect(path).toMatch(/^\/pdf-link\?id=[^&]+&k=[0-9a-f]{32}$/);

    const got = await t.fetch(path);
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("application/pdf");
    expect(got.headers.get("Content-Disposition")).toBe('attachment; filename="energy-usage-estimate.pdf"');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PDF);

    // A guessed key does not work.
    expect((await t.fetch(path.replace(/k=.*/, `k=${"0".repeat(32)}`))).status).toBe(404);

    // After an hour the file is gone.
    vi.advanceTimersByTime(61 * 60 * 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.fetch(path)).status).toBe(404);
    expect(await t.run((ctx) => ctx.db.query("pdfLinks").collect())).toHaveLength(0);
  });

  test("only PDFs are accepted, and the browser's check before uploading is answered", async () => {
    const t = convexTest(schema, modules);
    const bad = await t.fetch("/pdf-link", { method: "POST", body: new TextEncoder().encode("<html>not a pdf</html>") });
    expect(bad.status).toBe(400);
    const pre = await t.fetch("/pdf-link", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toMatch(/X-Filename/);
  });

  test("file names are kept plain", () => {
    expect(safePdfName("Solar recommendation — Kats.PDF")).toBe("solar-recommendation-kats.pdf");
    expect(safePdfName(null)).toBe("document.pdf");
    expect(safePdfName('a"; rm -rf /.pdf')).toMatch(/^[a-z0-9._-]+\.pdf$/);
  });
});
