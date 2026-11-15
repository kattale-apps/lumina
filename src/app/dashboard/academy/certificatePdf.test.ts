import { describe, expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCertificatePdf } from "./certificatePdf";

// A 1 x 1 PNG, standing in for the photo and logos.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

const base = {
  academyName: "Solar Switch Sales Academy",
  number: "SSA-2026-1",
  holderName: "Isaac Tom",
  companyName: "Solar Switch",
  issuedAt: Date.UTC(2026, 10, 15),
  modules: [
    { title: "Solar and power basics", scorePercent: 100 },
    { title: "Finding and qualifying leads", scorePercent: 83 },
    { title: "Assessing needs with Solar Switch", scorePercent: 100 },
    { title: "Presenting, closing and selling ethically", scorePercent: 92 }
  ]
};

describe("certificate PDF", () => {
  test("builds a one-page landscape A4 certificate with photo, logos and QR code", async () => {
    const bytes = await buildCertificatePdf({
      ...base,
      photo: PNG,
      logo: PNG,
      tileLogo: PNG,
      verifyUrl: "https://lumina-xi-ochre-15.vercel.app/verify/2JS74AUQXTDM"
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
    expect(doc.getTitle()).toContain("SSA-2026-1");
  });

  test("still builds without a photo, logos or QR code, and with an unreadable photo", async () => {
    await expect(buildCertificatePdf(base)).resolves.toBeInstanceOf(Uint8Array);
    await expect(buildCertificatePdf({ ...base, photo: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) })).resolves.toBeInstanceOf(Uint8Array);
  });

  test("a very long name or characters outside the PDF fonts do not break it", async () => {
    const bytes = await buildCertificatePdf({
      ...base,
      holderName: "Nakato Namubiru Ssekandi Mukasa Kawooya Lubega Nalwanga Ssempijja",
      companyName: "Solar Switch “Uganda” – Kampala ✓"
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
